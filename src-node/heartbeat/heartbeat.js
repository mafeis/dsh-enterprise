/**
 * 心跳：定时向网关上报在线状态。
 *  - 增量上报：device 只在变化时发送（网关 deviceAccepted=false 时下次强制全量）
 *  - 令牌滑动续期：跟随心跳每 10 次调一次 /auth/refresh，活跃使用永不过期
 *  - modelFingerprint 联动：网关模型目录指纹变化 → 自动 repairConfigure
 */
import { writeCredential } from '../settings/provider-config.js'
import { saveState, readState } from '../state/state.js'
import { collectDeviceInfo } from '../device/device-info.js'
import { pluginLog, ctxLoggerInfoSafe } from '../shared/log.js'
import { repairConfigure } from '../auth/login.js'
import { enforcePluginAllowlist, PROTECTED_PLUGINS, retryPendingPluginEntities } from '../enforce/plugin-enforce.js'

let heartbeatTimer = null
let heartbeatState = { lastOk: false, lastAt: '', lastLatencyMs: -1, lastError: '' }
let lastModelFingerprint = null
let hbFailStreak = 0

/** 最近一次实际发送成功的 device JSON / 网关缺快照时置 true，下次发全量 */
let lastSentDeviceJson = null
let forceFullDevice = true

/** 续期计数：每 10 次心跳续一次 */
let hbCounter = 0

/** 当前心跳状态快照（/status 路由用） */
export function currentHeartbeatState() { return heartbeatState }

/** 停止心跳定时器（插件卸载 effect disposer 调用） */
export function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
}

/** ============ 心跳增量上报：device 只在变化时发送 ============
 * - 每次心跳都重新采集动态字段（memFreeGb / uptimeH / disks），与上次上报做比较
 * - 无变化：不发送 device 字段（网关沿用库里该设备最新一条的 device 快照）
 * - 有变化：发送完整 device（网关覆盖更新快照）
 * - 网关返回 res.deviceAccepted=false 时说明网关没有快照（如库被清/首次），下次强制全量
 */
function diffDeviceChanged(dev) {
  if (forceFullDevice) return true
  if (!lastSentDeviceJson) return true
  // 动态字段单独比较：memFreeGb 变动 <0.5GB 视为噪声不重发；uptimeH 按小时粒度
  try {
    const prev = JSON.parse(lastSentDeviceJson)
    const dyn = (a, b) => Math.abs((a ?? 0) - (b ?? 0))
    const noisy = dyn(dev.memFreeGb, prev.memFreeGb) < 0.5
    const stable = ['hostname', 'platform', 'osRelease', 'osVersion', 'cpuModel', 'cpuCores', 'memTotalGb', 'dshVersion', 'pluginVersion', 'ips', 'plugins']
      .every((k) => JSON.stringify(dev[k] ?? null) === JSON.stringify(prev[k] ?? null))
    const disksSame = JSON.stringify(dev.disks ?? []) === JSON.stringify(prev.disks ?? [])
    const uptimeSame = dev.uptimeH === prev.uptimeH
    return !(stable && disksSame && uptimeSame && noisy)
  } catch { return true }
}

/** ============ 令牌滑动续期：跟随登录状态，活跃使用则永不过期 ============
 * 每 10 次心跳（约 5~10 分钟）调一次 /auth/refresh：
 * - 服务端校验旧票仍有效（未被登出/改密吊销、账号未停用）
 * - 剩余寿命 > 15 天：返回原票，不换
 * - 剩余寿命 ≤ 15 天：换发新 30 天票，插件写回凭证文件
 * 这样长期在线的设备永不掉线；登出/改密后旧票立即失效，续期自然失败
 */
async function refreshTokenIfNeeded(state, st) {
  hbCounter++
  if (hbCounter % 10 !== 1) return // 每 10 次心跳续一次
  if (!st.token) return
  try {
    const res = await fetch(`${state.gateway}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${st.token}` },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return // 已吊销/停用：心跳本身会失败并上报，不在这里处理
    const b = await res.json().catch(() => ({}))
    if (b.refreshed && b.token) {
      // 写回新凭证（.credentials.yaml + 环境变量 + state 预览）
      writeCredential(b.token)
      saveState({ tokenPreview: b.token.slice(0, 24) + '…' })
    }
  } catch { /* 网络抖动忽略，下轮再试 */ }
}

export async function runHeartbeatOnce(state) {
  const started = Date.now()
  try {
    const st = readState()
    await refreshTokenIfNeeded(state, st)
    const cur = readState()
    const dev = await collectDeviceInfo()
    const body = {
      profile: 'web', env: 'dsh-plugin', policyVersion: 'enterprise-0.2', node: process.version,
      account: cur.user ?? '',
    }
    if (diffDeviceChanged(dev)) {
      body.device = dev
    }
    const res = await fetch(`${state.gateway}/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cur.token ?? ''}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    })
    if (res.ok) {
      const rb = await res.json().catch(() => ({}))
      if (rb.deviceAccepted === false) {
        // 网关没有该设备的快照（首次/库被清），下次强制全量
        forceFullDevice = true
        lastSentDeviceJson = null
      } else {
        if (body.device) lastSentDeviceJson = JSON.stringify(dev)
        forceFullDevice = false
      }
      // 插件管控：网关判定安装了允许清单之外的插件——自动清理（manifest 移除，重启后不再加载），不再仅告警
      // 保护名单（本插件自身 / DSH 必装组件）由客户端兜底保留，不因网关清单漏配而每拍空转清理
      // 注意：必须先算好 pluginViolations 再赋值 heartbeatState（const TDZ——先引用后声明会让每次心跳必抛 ReferenceError）
      const gwViolations = Array.isArray(rb.pluginViolations) ? rb.pluginViolations : []
      const pluginViolations = gwViolations.filter((n) => !PROTECTED_PLUGINS.includes(n))
      heartbeatState = {
        lastOk: true,
        lastAt: new Date().toISOString(),
        lastLatencyMs: Date.now() - started,
        lastError: '',
        deviceSent: Boolean(body.device),
        pluginViolations,
      }
      if (pluginViolations.length) {
        void enforcePluginAllowlist('heartbeat').catch(() => { /* 清理失败不影响心跳 */ })
      } else {
        // retryPendingPluginEntities 是同步函数（队列空时返回 undefined），不能挂 .catch——用 try/catch 兜底
        try { retryPendingPluginEntities() } catch { /* 残留实体重试失败不影响心跳 */ }
      }
      // 模型目录指纹：管理员在网关增删模型后（响应带 modelFingerprint），
      // 与本地记录不一致即自动重配 provider——无需用户手动"一键配置"或重新登录
      if (rb.modelFingerprint && rb.modelFingerprint !== lastModelFingerprint) {
        const prev = lastModelFingerprint
        lastModelFingerprint = rb.modelFingerprint
        if (prev !== null) {
          // 跳过首次（首次只是记录基线）；变化时静默重配
          repairConfigure().then((r) => {
            if (r?.ok) ctxLoggerInfoSafe(`[enterprise] 检测到网关模型变化（指纹 ${prev.slice(0, 8)} → ${rb.modelFingerprint.slice(0, 8)}），已自动更新本地模型配置`)
            else ctxLoggerInfoSafe(`[enterprise] 网关模型变化但自动重配失败: ${r?.error ?? '未知'}`)
          }).catch(() => {})
        }
      }
    } else {
      heartbeatState = { lastOk: false, lastAt: new Date().toISOString(), lastLatencyMs: Date.now() - started, lastError: `HTTP ${res.status}` }
    }
  } catch (e) {
    heartbeatState = { lastOk: false, lastAt: new Date().toISOString(), lastLatencyMs: -1, lastError: String(e?.message ?? e).slice(0, 120) }
    // 异常心跳带堆栈落插件日志（首拍必记，之后每 3 连错记一次），避免只有 message 定位不到行号
    if (hbFailStreak === 0 || (hbFailStreak + 1) % 3 === 0) {
      pluginLog(`[enterprise] 心跳异常: ${String(e?.stack ?? e).slice(0, 600)}`)
    }
  }
  // 状态落盘自吞错：磁盘满/状态文件被锁（AV、备份）时写失败不能让 rejection 冲出
  // 定时器回调——Node ≥15 未处理 rejection 会直接终止 DSH 宿主进程
  try {
    saveState({ heartbeat: heartbeatState })
  } catch { /* 状态文件写失败不影响心跳流程，下轮再试 */ }
  // 心跳失败只在连错达到 3 次时记一条（避免网关抖动刷屏），恢复时也记一条
  if (!heartbeatState.lastOk) {
    hbFailStreak = (hbFailStreak ?? 0) + 1
    if (hbFailStreak === 3) pluginLog(`心跳连续失败 ×3（最近原因: ${heartbeatState.lastError}）——网关可能不可达`)
  } else if (hbFailStreak >= 3) {
    pluginLog(`心跳恢复（此前连错 ${hbFailStreak} 次，延迟 ${heartbeatState.lastLatencyMs}ms）`)
    hbFailStreak = 0
  }
  return heartbeatState
}

export function syncHeartbeatTimer(ctx) {
  const state = readState()
  const hb = state.heartbeatConfig ?? { enabled: true, intervalSec: 60 }
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
  if (hb.enabled && state.gateway) {
    const ms = Math.max(15, hb.intervalSec) * 1000
    // .catch 兜底：定时器里的 rejection 若无人接就是未处理 rejection → 崩宿主进程
    heartbeatTimer = setInterval(() => { runHeartbeatOnce(state).catch(() => {}) }, ms)
    runHeartbeatOnce(state).catch(() => {})
  }
  ctx?.logger?.info?.(`[enterprise] 心跳 ${hb.enabled ? `已启动（${hb.intervalSec}s）` : '已停止'}`)
}
