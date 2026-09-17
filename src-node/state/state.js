/** 插件状态持久化（设置页 + 心跳用）+ 企业网关凭证读取 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeTextAtomic, readJsonSafe } from '../shared/fs-utils.js'
import { statePath, credentialsFile, dshHome, gatewayUrlFile } from '../shared/paths.js'

/** v0.5.x 及更早的状态文件名（插件还叫 dsh-ent-login 的时代） */
const LEGACY_STATE_PATH = join(dshHome(), 'enterprise', 'ent-login-state.json')

export function readState() {
  let s = readJsonSafe(statePath())
  if (!s) {
    // v0.6.0 插件改名（dsh-ent-login → dsh-enterprise）一次性迁移：
    // 老状态文件里存着网关地址/账号/心跳配置，直接沿用，避免升级后被当成未登录
    const legacy = readJsonSafe(LEGACY_STATE_PATH)
    if (legacy) {
      writeTextAtomic(statePath(), JSON.stringify(legacy, null, 2))
      s = legacy
    }
  }
  return s ?? {}
}

export function saveState(patch) {
  const next = { ...readState(), ...patch }
  writeTextAtomic(statePath(), JSON.stringify(next, null, 2))
  return next
}

/** 读当前 ENT_GATEWAY_TOKEN（.credentials.yaml 的 refs 段） */
export function readToken() {
  try {
    return (readFileSync(credentialsFile(), 'utf8').match(/^\s*ENT_GATEWAY_TOKEN:\s*(\S+)/m) ?? [])[1] ?? null
  } catch { return null }
}

/** 出厂网关地址：ENT_GATEWAY_URL 环境变量 → gateway-url.txt（IT 部署预置，一行 URL）→ 空。
 *  登录页预填兜底：用户新机器零输入（优先级低于上次使用的 state.gateway）。 */
export function readFactoryGateway() {
  const env = String(process.env.ENT_GATEWAY_URL ?? '').trim()
  if (env) return env.replace(/\/+$/, '')
  try {
    const raw = readFileSync(gatewayUrlFile(), 'utf8').trim()
    return raw ? raw.replace(/\/+$/, '') : ''
  } catch { return '' }
}
