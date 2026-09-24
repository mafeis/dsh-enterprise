/**
 * 本地清场登出：清 provider 配置 + 凭证 + 登录态，保留网关地址（登录页预填用）。
 * 两个入口共用：
 *   - /api/enterprise/logout 路由（用户主动登出，先远程吊销再调这里）
 *   - 心跳 401 自动清场（账号被网关停用/凭证被吊销，票已无效不再调远程）
 */
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { writeTextAtomic, readJsonSafe } from '../shared/fs-utils.js'
import { dshSettingsFile, entSettingsFile, credentialsFile } from '../shared/paths.js'
import { pluginLog } from '../shared/log.js'
import { saveState, readState } from '../state/state.js'
import { removeProviderFromSettingsYaml, clearEnterpriseProfilePatches } from '../settings/yaml-edit.js'
import { GATEWAY_KEY_REF } from '../settings/provider-config.js'

/**
 * 清空本地企业配置与凭证，回到未登录状态（网关地址保留）。
 * @param {string} reason 日志用原因（如 '用户登出' / '网关停用账号'）
 */
export function logoutLocal(reason = '用户登出') {
  // 1. enterprise-settings.yaml：移除 ent-gateway provider 与默认模型
  const settingsPath = entSettingsFile()
  const s = readJsonSafe(settingsPath)
  if (s) { delete s.providers?.['ent-gateway']; delete s.providers?.['ent-gateway-responses']; delete s['agent-default-model']; writeTextAtomic(settingsPath, JSON.stringify(s, null, 2)) }
  // 2. 主 settings.yaml：移除 ent-gateway；企业管控模式下进一步把模型配置整个清空（providers: {} + 删默认模型）——
  //    不登录不能用：登出后 DSH 无任何可用模型，登录遮罩挡住全部操作
  const mainSettings = dshSettingsFile()
  if (existsSync(mainSettings)) {
    const raw = readFileSync(mainSettings, 'utf8')
    let cleaned = removeProviderFromSettingsYaml(raw, 'ent-gateway')
    cleaned = removeProviderFromSettingsYaml(cleaned, 'ent-gateway-responses')
    // 顶层 agent-default-model 若指向 ent-gateway，一并移除（否则 DSH 找不到 provider 启动报错）
    if (/^agent-default-model:\s*\n(\s+provider:\s*ent-gateway[^\n]*\n)/m.test(cleaned)) {
      cleaned = cleaned.replace(/^(agent-default-model:\s*)\n\s+provider:\s*ent-gateway[^\n]*\n\s+model:[^\n]*\n/m, '')
    }
    // 企业管控：清空所有模型（用户要求登出后模型配置清空）
    const admMatch = cleaned.match(/^agent-default-model:\s*\n\s+provider:\s*([^\n]+)\n/m)
    const admProvider = admMatch?.[1]?.trim()
    if (!admProvider || admProvider === 'ent-gateway') {
      // 无其他默认模型（或默认就是企业网关）→ 连 agent-default-model 一起删
      cleaned = cleaned.replace(/^agent-default-model:\s*\n(\s+.*\n?)+/m, '')
    }
    // ⚠ 停止条件必须包含顶层键（列 0 的非空白）：llm-deepseek: 紧跟在 llm-pi-ai 段后时，
    //    旧正则会把它当作 providers 块的续行吞掉——块头被删但 `  models: []` 残留，
    //    随后屏蔽段兜底检测"看不到 llm-deepseek"又插一份 → 重复键，Desktop 启动即崩（2026-09-18 Mac 实测）
    cleaned = cleaned.replace(/(^llm-pi-ai:\s*\n)\s+providers:[^\n]*\n(?:(?!  [a-zA-Z]|\n)(?![^\s])[^\n]*\n)*/m, '$1  providers: {}\n')
    // 确保 llm-deepseek 屏蔽段存在：DSH 内置官方 deepseek provider 自带一整套 v4 模型目录，
    // 不屏蔽会在会话模型下拉里冒出来，绕过企业网关统一管控
    if (!/^llm-deepseek:\s*$/m.test(cleaned)) {
      cleaned = cleaned.replace(/(^llm-pi-ai:\s*\n\s+providers: \{\}\n)/m, '$1llm-deepseek:\n  models: []\n')
    }
    if (cleaned !== raw) writeTextAtomic(mainSettings, cleaned)
  }
  // 2.5 新版 DSH（0.1.7+）profile patch：清理企业网关配置
  clearEnterpriseProfilePatches()

  // 3. .credentials.yaml：移除网关凭证（新旧两个引用名都清）
  const credPath = credentialsFile()
  if (existsSync(credPath)) {
    const raw = readFileSync(credPath, 'utf8')
      .replace(/^\s*ENT_GATEWAY_TOKEN:\s*.*\r?\n?/m, '')
      .replace(new RegExp('^\\s*' + GATEWAY_KEY_REF + ':\\s*.*\\r?\\n?', 'm'), '')
    writeTextAtomic(credPath, raw)
  }
  // 3.5 清宿主进程 env 与用户级注册表环境变量：宿主 credentials-local 的 inherited 层
  //     （启动时冻结的 env 快照）优先于文件层——注册表残留票会在下次启动时重新遮蔽文件里的新票。
  //     （本进程内的 process.env 同步删；HKCU 的删掉后下个新实例的快照就干净了。）
  try { delete process.env.ENT_GATEWAY_TOKEN } catch { /* 尽力而为 */ }
  try { delete process.env[GATEWAY_KEY_REF] } catch { /* 尽力而为 */ }
  if (process.platform === 'win32') {
    try {
      execFileSync('reg', ['delete', 'HKCU\\Environment', '/v', 'ENT_GATEWAY_TOKEN', '/f'], { stdio: 'ignore' })
    } catch { /* 值本就不存在，忽略 */ }
  }
  // 4. 清 state 里的令牌与登录痕迹（gateway 保留：登录页预填"上次使用的网关"）
  const st = readState()
  saveState({ token: null, tokenPreview: null, user: null, loginAt: null })
  pluginLog(`本地清场完成（原因=${reason}，原账号=${st.user ?? '未知'}，网关地址保留=${st.gateway ?? ''}）`)
}
