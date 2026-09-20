/**
 * 登录并自动配置：网关换 JWT → 写 provider 配置 → 写凭证 → 记状态。
 * 另含「一键修复」repairConfigure（用已存 token 重写 provider，不要求重新输密码）。
 */
import { existsSync, copyFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeTextAtomic, readJsonSafe } from '../shared/fs-utils.js'
import { dshHome, entSettingsFile, credentialsFile } from '../shared/paths.js'
import { writeCredential, writeProviderConfig, GATEWAY_KEY_REF } from '../settings/provider-config.js'
import { syncMainSettingsProvider } from '../settings/yaml-edit.js'
// readState 必须导入：repairConfigure 首行就要用——漏导入会让"一键配置"和心跳指纹
// 自动重配每次都抛 ReferenceError（被 catch 包装成"网关不可达"静默失败），模型永不跟随网关更新
import { readState, saveState, readToken } from '../state/state.js'

/** 网关 /v1/models → DSH provider 模型定义（登录与修复共用同一映射） */
export function mapGatewayModels(data) {
  return (data ?? []).map((m) => ({
    id: m.id,
    // DSH 选择器显示用：网关 displayName 优先，缺失回退 id
    ...(m.display_name ? { name: m.display_name } : {}),
    contextWindow: m.context_window ?? 128000,
    maxTokens: m.max_tokens ?? 32768,
    // DSH llm-pi-ai 的 input schema 只接受 text/image（MODALITIES 白名单）；
    // 写入 audio/video 等其他模态会让整个 llm-pi-ai 段校验失败、命名空间不注册、
    // 所有企业模型从选择器消失——必须过滤到白名单内。
    input: (Array.isArray(m.input_modes) && m.input_modes.length ? m.input_modes : ['text'])
      .filter((x) => x === 'text' || x === 'image'),
    input_modes: m.input_modes,
    thinking_levels: m.thinking_levels,
  }))
}

/** 登录并写配置的核心逻辑 */
export async function loginAndConfigure({ server, username, password }) {
  const base = server.replace(/\/$/, '')
  // 1. 调网关登录（换 JWT）
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(8000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.token) {
    return { ok: false, error: body?.error?.message ?? `登录失败（HTTP ${res.status}）` }
  }
  const token = body.token
  const user = body.user?.username ?? username

  // 2. 拉模型清单（带元数据；带票 → 网关按用户所在分组过滤模型可见性）
  const modelsRes = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) })
  const modelsBody = await modelsRes.json().catch(() => ({ data: [] }))
  const models = mapGatewayModels(modelsBody.data)
  if (!models.length) return { ok: false, error: '网关无可用模型' }

  // 3. 写 enterprise-settings.yaml（JSON 宽容格式）
  const settingsPath = entSettingsFile()
  const settings = readJsonSafe(settingsPath) ?? {}
  // 备份首次配置前的文件
  if (existsSync(settingsPath) && !existsSync(settingsPath + '.bak-pre-login')) {
    copyFileSync(settingsPath, settingsPath + '.bak-pre-login')
  }
  settings['agent-default-model'] = { provider: 'ent-gateway', model: models[0].id, reasoningEffort: 'low' }
  settings.providers = settings.providers ?? {}
  settings.providers['ent-gateway'] = {
    displayName: '企业统一模型网关',
    api: 'openai-completions',
    apiKeyEnv: GATEWAY_KEY_REF,
    baseUrl: base,
    compat: { thinkingFormat: 'openai' },
    models,
  }
  writeTextAtomic(settingsPath, JSON.stringify(settings, null, 2))
  // 同步主 settings.yaml（llm-pi-ai 运行时从这里解析 provider 定义）
  syncMainSettingsProvider(base, models)

  // 4. 写 .credentials.yaml（ENT_GATEWAY_TOKEN → JWT，插件内同步宿主 process.env）
  writeCredential(token)

  // 5. 绝不写 HKCU\Environment：宿主启动时冻结 env 快照（launchEnvironment "process" 层），
  //    credentials-local 解析 ref 时 inherited 快照永远压过 .credentials.yaml 文件层——
  //    注册表里的过期票（网关换密钥/出厂重置后）会让登录后的新票对聊天链路不可见，
  //    对话持续 401「API 密钥无效」。反之注册表里已有旧票的存量机器：登录时顺手清掉，
  //    让文件层（watch 热重载）接管，下个心跳周期聊天即恢复。
  if (process.platform === 'win32') {
    try {
      const { execFileSync } = await import('node:child_process')
      execFileSync('reg', ['delete', 'HKCU\\Environment', '/v', 'ENT_GATEWAY_TOKEN', '/f'], { stdio: 'ignore' })
    } catch { /* 值本就不存在，忽略 */ }
  }

  // 6. 记录会话信息（供设置页显示 + 心跳用）
  saveState({ user, gateway: base, tokenPreview: token.slice(0, 24) + '…', loginAt: new Date().toISOString(), models: models.map((m) => m.id) })

  return { ok: true, user, models: models.map((m) => m.id), gateway: base }
}

/** 一键修复 provider 配置：用已存 token 重写 provider 定义（不要求重新输密码） */
export async function repairConfigure() {
  const state = readState()
  if (!state.gateway) return { ok: false, error: '从未登录过，请先登录' }
  const base = state.gateway
  const token = readToken()
  if (!token) return { ok: false, error: '凭证已丢失，请重新登录' }
  try {
    // 1. token 仍有效？——/v1/models 是公开端点探不出吊销，必须用 /auth/verify（完整 authenticate 链：吊销/停用都拦截）
    const probe = await fetch(`${base}/auth/verify`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) })
    const pv = await probe.json().catch(() => ({ valid: false }))
    if (!pv.valid) return { ok: false, error: '凭证已失效（已登出或被重置），请重新登录' }
    const modelsRes = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) })
    const modelsBody = await modelsRes.json().catch(() => ({ data: [] }))
    const models = mapGatewayModels(modelsBody.data)
    if (!models.length) return { ok: false, error: '网关无可用模型' }
    // 2. 重写配置（复用 login 的 3、4 步逻辑，但不重新认证）
    writeProviderConfig(base, models)
    writeCredential(token)
    saveState({ models: models.map((m) => m.id) })
    return { ok: true, models: models.map((m) => m.id), gateway: base }
  } catch (e) {
    return { ok: false, error: '网关不可达：' + String(e?.message ?? e).slice(0, 120) }
  }
}
