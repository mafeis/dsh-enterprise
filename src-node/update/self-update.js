/**
 * 企业插件自动更新：网关插件仓库发新版本 → 心跳检测 → 后台静默安装 → 重启生效。
 *
 *  - 检测：心跳响应 pluginLatest['dsh-enterprise'] > 本机 VERSION 即触发（heartbeat.js）
 *  - 安装：下载仓库 tgz 到 profile 内 .ent-plugin-cache/ → dsh plugin add file:<tgz>
 *    （与插件市场自助安装同一条 runPluginCli 通道，manifest 写权互斥防并发）
 *  - 生效：装完仅记录状态，当前会话仍跑旧代码；UI 提示重启，重启后加载新版本
 *  - 防抖：同版本 6 小时内只试一次；安装中互斥；绝不降级
 *
 * 仓库里其它插件（dsh-context / dsh-mnemon / @scope/… 等）不自动装：企业侧「不允许终端自助
 * 安装」，但仓库里该装哪一版是管理员定的，所以对**本机已装且在允许清单内**的插件开放
 * 「更新」按钮（routes.js → /api/enterprise/plugin-update），下载与安装共用本文件的
 * installFromRepo —— 一条通道，缓存路径、错误口径、宿主 CLI 调用完全一致。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeTextAtomic, readJsonSafe } from '../shared/fs-utils.js'
import { findProfileRoot, runPluginCli } from '../policy/policy.js'
import { readState, saveState } from '../state/state.js'
import { pluginLog } from '../shared/log.js'
import { VERSION } from '../shared/version.js'

/** 插件更新状态键（enterprise-state.json） */
const STATE_KEY = 'selfUpdate'
/** 同版本尝试冷却：6 小时 */
const COOLDOWN_MS = 6 * 60 * 60 * 1000

/** 模块级互斥：一次只跑一个安装流程 */
let updating = false

/** 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等 0。非数字段按字符串比，带预发布号视为较低。 */
export function compareSemver(a, b) {
  const pa = String(a ?? '').split('.')
  const pb = String(b ?? '').split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0'
    const y = pb[i] ?? '0'
    if (x === y) continue
    const nx = parseInt(x, 10)
    const ny = parseInt(y, 10)
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx > ny ? 1 : -1
    return x > y ? 1 : -1
  }
  return 0
}

/** 企业仓库 → profile 缓存 → 宿主插件 CLI 安装（自更新与「更新」按钮共用同一条通道）。
 *  URL 里包名要逐段 encodeURIComponent：@scope/name 的 '@' 需转义，且必须分成两段拼，
 *  否则网关 /plugin-packages/ 会把 scope 当成包名（坑见网关 repo-store 的 parsePackagePath）。 */
export async function installFromRepo(name, version) {
  const pkg = String(name ?? '').trim()
  const ver = String(version ?? '').trim()
  if (!pkg || !ver) return { ok: false, error: '缺少包名或版本号' }
  const profileDir = findProfileRoot()
  if (!profileDir) return { ok: false, error: '无法定位 profile 目录' }
  const base = (readState().gateway ?? '').replace(/\/+$/, '')
  if (!base) return { ok: false, error: '网关地址为空' }
  const cacheDir = join(profileDir, '.ent-plugin-cache')
  await mkdir(cacheDir, { recursive: true })
  const tgz = join(cacheDir, `${pkg.replace('/', '-')}-${ver}.tgz`)   // 固定名：同包重装即覆盖，deps 引用恒定
  const url = `${base}/plugin-packages/${pkg.split('/').map(encodeURIComponent).join('/')}/${encodeURIComponent(ver)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!res.ok) return { ok: false, error: `企业仓库下载失败 HTTP ${res.status}（${pkg}@${ver}）` }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 1024) return { ok: false, error: `仓库包异常（${buf.length}B）` }
  await writeFile(tgz, buf)
  const r = await runPluginCli(['add', `file:${tgz}`])
  if (!r.ok) return { ok: false, error: r.error ?? '宿主插件安装失败', tgz }
  return { ok: true, tgz, version: ver }
}

/** 其它插件「已装待重启」记录（本插件自身用 selfUpdate 键，两份在 pendingUpdates 里汇总给 UI） */
const UPDATES_KEY = 'pluginUpdates'

export function notePluginUpdateInstalled(name, version) {
  const cur = readState()?.[UPDATES_KEY] ?? {}
  saveState({ [UPDATES_KEY]: { ...cur, [name]: { version, at: new Date().toISOString() } } })
}

/** 本次进程启动之后完成的插件更新（含本插件自身）：UI 据此提示「重启后生效」 */
export function pendingUpdates() {
  const since = Date.now() - process.uptime() * 1000
  const out = []
  const own = readState()?.[STATE_KEY]
  if (own?.installedVersion && new Date(own.installedAt).getTime() > since) {
    out.push({ name: 'dsh-enterprise', version: own.installedVersion })
  }
  const others = readState()?.[UPDATES_KEY] ?? {}
  for (const [n, rec] of Object.entries(others)) {
    if (n === 'dsh-enterprise' || !rec?.version) continue
    if (new Date(rec.at).getTime() > since) out.push({ name: n, version: rec.version })
  }
  return out
}

/** 当前待生效的更新（UI 提示用）：仅本次进程启动之后安装成功的才算「待重启」 */
export function pendingUpdateRestart() {
  const rec = readState()?.[STATE_KEY]
  if (!rec?.installedVersion || !rec?.installedAt) return null
  if (new Date(rec.installedAt) <= new Date(Date.now() - process.uptime() * 1000)) return null
  return { version: rec.installedVersion, at: rec.installedAt }
}

/** 检测到仓库新版本时的入口（heartbeat 调用，fire-and-forget）。返回 { ok, skipped?, error? } */
export async function maybeSelfUpdate(latestVersion, trigger = 'heartbeat') {
  const latest = String(latestVersion ?? '').trim()
  if (!latest || updating) return { ok: false, skipped: 'busy-or-empty' }
  if (compareSemver(latest, VERSION) <= 0) return { ok: true, skipped: 'up-to-date' }
  // 冷却：同版本短时间内不反复拉（安装失败也冷却，避免每拍心跳都打一轮）
  const prev = readState()?.[STATE_KEY]
  if (prev?.attemptedVersion === latest && prev?.attemptedAt
      && Date.now() - new Date(prev.attemptedAt).getTime() < COOLDOWN_MS) {
    return { ok: false, skipped: 'cooldown' }
  }
  updating = true
  try {
    saveState({ [STATE_KEY]: { ...prev, attemptedVersion: latest, attemptedAt: new Date().toISOString() } })
    // ① 下载仓库 tgz（默认版本 = 最新；路径与 /plugin-packages 下载端点一致）
    // ①② 下载 + 安装走通用通道（与「更新」按钮同一份实现，不再各写一遍）
    const r = await installFromRepo('dsh-enterprise', latest)
    if (!r.ok) {
      pluginLog(`[enterprise] 自动更新 ${VERSION} → ${latest} 安装失败: ${r.error ?? '未知'}`)
      return { ok: false, error: r.error ?? 'pnpm 安装失败' }
    }
    // ③ 记录待重启（UI 轮询 /status 弹提示）；运行中实例继续跑旧代码，重启后加载新版本
    saveState({ [STATE_KEY]: { ...(readState()?.[STATE_KEY] ?? {}), installedVersion: latest, installedAt: new Date().toISOString() } })
    pluginLog(`[enterprise] 自动更新完成：${VERSION} → ${latest}（重启 DSH 后生效）`)
    return { ok: true, version: latest }
  } catch (e) {
    const msg = String(e?.message ?? e).slice(0, 200)
    pluginLog(`[enterprise] 自动更新异常: ${msg}`)
    return { ok: false, error: msg }
  } finally {
    updating = false
  }
}
