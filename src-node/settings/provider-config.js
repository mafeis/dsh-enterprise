/** 企业托管 provider / 凭证的写入与清理 */
import { existsSync, readFileSync, chmodSync } from 'node:fs'
import { writeTextAtomic, readJsonSafe } from '../shared/fs-utils.js'
import { entSettingsFile, credentialsFile, dshSettingsFile } from '../shared/paths.js'
import { pluginLog } from '../shared/log.js'
import { syncMainSettingsProvider, profilePatchSettingsPaths } from './yaml-edit.js'
import { ensureDefaultWorkspace } from './default-workspace.js'
import { readToken } from '../state/state.js'

/** 写 enterprise-settings.yaml（插件托管层）+ 同步主 settings.yaml（llm-pi-ai 运行时解析处） */
export function writeProviderConfig(base, models) {
  const settingsPath = entSettingsFile()
  const settings = readJsonSafe(settingsPath) ?? {}
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
  // 双协议并存：Responses API 通道（/v1/responses），默认仍走 completions
  settings.providers['ent-gateway-responses'] = {
    displayName: '企业统一模型网关 Responses',
    api: 'openai-responses',
    apiKeyEnv: GATEWAY_KEY_REF,
    baseUrl: base,
    models,
  }
  writeTextAtomic(settingsPath, JSON.stringify(settings, null, 2))
  // 同步主 settings.yaml（llm-pi-ai 运行时从这里解析 provider）——与 logout 的清理对称
  syncMainSettingsProvider(base, models)
  // 新装机首次登录：自动注册默认工作目录（已有 workspace 则不动）
  ensureDefaultWorkspace()
}

/**
 * 聊天链路凭证引用名（v2）。
 * 宿主 credentials-local 解析 ref 的优先级：启动时冻结的 env 快照 > .credentials.yaml 文件。
 * 历史版本曾 reg add 把 ENT_GATEWAY_TOKEN 写进用户环境变量——此后每台机器的
 * DSH 进程树（含常驻的实例管理器）都带着启动时冻结的旧票，网关换密钥后
 * 新票永远被快照层遮蔽，对话持续 401「API 密钥无效」。
 * 换一个从未进过任何 env/注册表的引用名：快照层查不到 → 文件层（watch 热重载）
 * 永远生效，无需重启任何进程。旧引用名仍写入凭证文件，兼容外部读取。
 */
export const GATEWAY_KEY_REF = 'ENT_GATEWAY_TOKEN_V2'

/** 把凭证同步进宿主进程环境变量（新旧两个引用名都同步）。
 *  快照层查不到的 ref（V2）本同步是兜底；快照里只有旧名的存量机器靠 V2 文件层生效。 */
export function syncCredentialEnv(token) {
  try {
    for (const name of [GATEWAY_KEY_REF, 'ENT_GATEWAY_TOKEN']) {
      if (token && process.env[name] !== token) process.env[name] = token
    }
    if (token) pluginLog(`[enterprise] 已同步 ${GATEWAY_KEY_REF}/ENT_GATEWAY_TOKEN 到宿主进程环境`)
  } catch { /* env 不可写不影响文件写入流程 */ }
}

/** 写凭证：.credentials.yaml 同时落新引用名（聊天链路用）与旧引用名（兼容） */
export function writeCredential(token) {
  const credPath = credentialsFile()
  let credRaw = existsSync(credPath) ? readFileSync(credPath, 'utf8') : 'refs:\n'
  if (!/^refs:/m.test(credRaw)) credRaw = 'refs:\n' + credRaw
  for (const ref of [GATEWAY_KEY_REF, 'ENT_GATEWAY_TOKEN']) {
    if (new RegExp(`^\\s*${ref}:`, 'm').test(credRaw)) {
      credRaw = credRaw.replace(new RegExp(`^(\\s*${ref}:\\s*).*$`, 'm'), `$1${token}`)
    } else {
      credRaw = credRaw.replace(/^(refs:\s*)$/m, `$1\n  ${ref}: ${token}`)
      if (!credRaw.includes(ref)) credRaw += `\n  ${ref}: ${token}`
    }
  }
  writeTextAtomic(credPath, credRaw)
  // 同步宿主进程环境变量（见 syncCredentialEnv 注释）
  syncCredentialEnv(token)
  // POSIX：凭证文件必须 owner-only（600）。首次新建时原子写按 umask 落成 644，
  // 下次启动宿主 credentials-local 会直接拒绝加载（Mac 实测）。
  if (process.platform !== 'win32') {
    try { chmodSync(credPath, 0o600) } catch { /* 尽力而为 */ }
  }
}

/** DeepSeek 官方占位 key：全新机器 .credentials.yaml 没有 DEEPSEEK_API_KEY 时，
 *  主界面首启（登录框出现的同时）会弹官方"配置 API key"引导框。塞一个随机占位
 *  key 让其判定为已配置、永不弹；企业登录同步后官方卡片被隐藏，占位 key 不会被用到。
 */
export function ensurePlaceholderDeepseekKey() {
  try {
    const credPath = credentialsFile()
    let raw = existsSync(credPath) ? readFileSync(credPath, 'utf8') : 'version: 1\nrefs:\n'
    if (!/^\s*DEEPSEEK_API_KEY:/m.test(raw)) {
      if (!/^refs:/m.test(raw)) {
        // 文件已有 `version: 1` 头（新版 credentials-local 布局）时，把 refs: 插在
        // version 行之后；绝不能再前插一份 `version: 1`（DUPLICATE_KEY 会炸掉整个
        // credentials 服务，插件树加载失败）。老扁平布局才在文件头补 version+refs。
        if (/^version:\s*1\s*$/m.test(raw)) raw = raw.replace(/^(version:\s*1\s*)$/m, '$1\nrefs:')
        else raw = 'version: 1\nrefs:\n' + raw
      }
      const rnd = Array.from({ length: 24 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('')
      raw = raw.replace(/^(refs:\s*)$/m, `$1\n  DEEPSEEK_API_KEY: sk-${rnd}`)
      writeTextAtomic(credPath, raw)
      pluginLog('已写入 DeepSeek 官方占位 key（阻止首启"配置 API key"弹窗）')
    }
  } catch { /* 占位失败不影响其他功能 */ }
}

/** 一次性迁移：存量机器从旧引用名 ENT_GATEWAY_TOKEN 切到 V2。
 *  settings.yaml 各目标里 ent-gateway 的 apiKeyEnv 改为 V2（这些文件由本插件托管，
 *  全文替换该精确字段安全——其他 provider 的引用名不同）；
 *  .credentials.yaml 由 writeCredential 补上 V2 ref（值同旧 ref）。
 *  幂等：已是 V2 的文件原样跳过。激活时调用，配合启动对账保证老机器无需任何手工操作。 */
export function migrateGatewayKeyRef() {
  try {
    let touched = 0
    const targets = new Set([dshSettingsFile(), entSettingsFile()])
    for (const p of profilePatchSettingsPaths()) targets.add(p)
    for (const file of targets) {
      if (!existsSync(file)) continue
      const raw = readFileSync(file, 'utf8')
      // (?![_\w]) 防前缀误匹配：ENT_GATEWAY_TOKEN 是 ENT_GATEWAY_TOKEN_V2 的前缀，
      // 二次迁移不得把 V2 又改成 V2_V2
      if (!/(apiKeyEnv:\s*)ENT_GATEWAY_TOKEN(?![_\w])/.test(raw)) continue   // 无旧引用名（未配置或已迁移）
      const next = raw.replace(/(apiKeyEnv:\s*)ENT_GATEWAY_TOKEN(?![_\w])/g, `$1${GATEWAY_KEY_REF}`)
      writeTextAtomic(file, next)
      touched++
      pluginLog(`[enterprise] 凭证引用名迁移 ENT_GATEWAY_TOKEN → ${GATEWAY_KEY_REF}: ${file}`)
    }
    // 凭证文件补 V2 ref（值与旧 ref 相同——旧 ref 里存的就是当前有效票）
    const tok = readToken()
    if (tok) writeCredential(tok)
    if (touched) pluginLog(`[enterprise] 引用名迁移完成（${touched} 个文件），聊天链路即刻改走文件层新票`)
    return touched
  } catch (e) {
    pluginLog(`[enterprise] 引用名迁移失败（不影响登录，下次激活重试）: ${String(e?.message ?? e).slice(0, 120)}`)
    return 0
  }
}
