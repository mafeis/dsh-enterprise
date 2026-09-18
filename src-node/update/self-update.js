/**
 * 企业插件自动更新：网关插件仓库发新版本 → 心跳检测 → 后台静默安装 → 重启生效。
 *
 *  - 检测：心跳响应 pluginLatest['dsh-enterprise'] > 本机 VERSION 即触发（heartbeat.js）
 *  - 安装：下载仓库 tgz 到 profile 内 .ent-plugin-cache/ → dsh plugin add file:<tgz>
 *    （与插件市场自助安装同一条 runPluginCli 通道，manifest 写权互斥防并发）
 *  - 生效：装完仅记录状态，当前会话仍跑旧代码；UI 提示重启，重启后加载新版本
 *  - 防抖：同版本 6 小时内只试一次；安装中互斥；绝不降级
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
    const profileDir = findProfileRoot()
    if (!profileDir) return { ok: false, error: '无法定位 profile 目录' }
    const base = (readState().gateway ?? '').replace(/\/$/, '')
    if (!base) return { ok: false, error: '网关地址为空' }
    const cacheDir = join(profileDir, '.ent-plugin-cache')
    await mkdir(cacheDir, { recursive: true })
    const tgz = join(cacheDir, `dsh-enterprise-${latest}.tgz`)
    const res = await fetch(`${base}/plugin-packages/dsh-enterprise/${encodeURIComponent(latest)}`, { signal: AbortSignal.timeout(60000) })
    if (!res.ok) return { ok: false, error: `仓库下载失败 HTTP ${res.status}` }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 1024) return { ok: false, error: `仓库包异常（${buf.length}B）` }
    await writeFile(tgz, buf)
    // ② 与插件市场同一条安装通道（desktop-cli → pnpm；manifest 写权互斥）
    const r = await runPluginCli(['add', `file:${tgz}`])
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
