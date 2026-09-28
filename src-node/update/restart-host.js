/**
 * 「立即重启」的真后端：重启宿主 App（官方 DeepSeek Harness）。
 *
 * 为什么必须我们自己动手：官方 App 的重启只存在于 **dev 构建**的应用菜单
 * （app.asar → lib/main.js：`...development ? [restartAppHostMenu]`，点击后
 * `app.relaunch(); quitWithoutConfirmation()`）。生产包既没有这个菜单项，也没有
 * 任何可调用的 HTTP/IPC 面 —— 老 DSH Desktop(Electron) 时代的 /api/desktop/restart
 * 在官方包里 grep 全量无此路由，点了必然 404。企业侧纪律是不改官方代码，
 * 所以由本插件（跑在宿主 Host 子进程里）起一个**脱离父进程组的辅助进程**：
 * 先请 App 优雅退出，等它真的退场后再重新拉起。
 *
 * 顺序很关键：官方 App 有单实例锁（main.js `requestSingleInstanceLock`），
 * 老进程还在时 `open` 只会把老窗口拉到前台 → 必须「先退干净，再拉起」。
 *
 * 优雅退出优先走 Apple Event quit（等价于 ⌘Q，会跑 before-quit 让 App 自己
 * 收尾 Host 子进程）；osascript 放后台并限时，卡住就退化为 SIGTERM → SIGKILL。
 * App 被硬杀时 Host 子进程可能变孤儿并占着 web 端口，收尾时一并清掉。
 *
 * 三个实测才踩得到的坑（0.9.20 就是这么磨出来的，别再退回去）：
 *   ① 见 sanitizeSpawnEnv —— 不带 ELECTRON_RUN_AS_NODE 的净化环境去 open，App 才会真的起来；
 *   ② 见 posixRestartScript —— open 的退出码不代表新实例存在，必须用进程存在性复核 + 重试；
 *   ③ 全程写 restart-trace.txt，现场「点了没反应」时先看它，别靠猜。
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from '../shared/paths.js'

/** 拉起前再剥一次 ELECTRON_RUN_AS_NODE：spawn 处已洗过环境，这里防的是「脚本被人从别处调起」 */
const ENV_FREE = 'env -u ELECTRON_RUN_AS_NODE '

/** 辅助进程的自检轨迹（排查现场用：macOS 上「点了没反应」到底是没退、没杀、还是没拉起来） */
export function restartTraceFile() {
  return join(process.env.LOCALAPPDATA ?? dshHome(), 'DSH-Enterprise', 'restart-trace.txt')
}

/** 起辅助进程前洗掉 Electron 注入的环境变量。
 *
 *  这条是被实测咬出来的、也是「mac 点重启没反应」的真正根因：本插件跑在宿主 Host 子进程里，
 *  那个进程是官方 App 用自己的 Electron 可执行文件以 ELECTRON_RUN_AS_NODE=1 拉起来的
 *  （ps eww 一看便知）。辅助进程继承这份环境，而 open 会把调用者的环境传给被启动的 App ——
 *  于是「重启」后的新实例也带着 ELECTRON_RUN_AS_NODE=1，Electron 直接退化成一枚普通 node
 *  解释器，起来不到 1 秒自己就退了：进程闪现一下、没有崩溃报告、页面永远停在「正在重启…」。
 *  spawn 处洗一次，脚本里拉起前再用 env -u 兜一层。 */
export function sanitizeSpawnEnv(env = process.env) {
  const out = {}
  for (const [k, v] of Object.entries(env ?? {})) {
    if (/^ELECTRON_/i.test(k)) continue
    out[k] = v
  }
  return out
}

/** 同一进程内只放行一次重启（防连点/重复请求排队出多个辅助进程） */
let started = null
const RESTART_DEDUPE_MS = 15000

/** 从 execPath/argv 里找出宿主 App bundle 路径（…/Foo.app）；非 App 内运行返回 null。
 *  官方 Host 子进程的 execPath 与 argv 都带着 bundle 内的绝对路径（含 app.asar 形式）。 */
export function resolveAppPath(paths = [process.execPath, ...(process.argv ?? [])]) {
  for (const raw of paths) {
    const s = String(raw ?? '')
    const i = s.indexOf('.app/')
    if (i === -1) continue
    const sep = s.lastIndexOf('/', i)
    if (sep <= 0) continue
    const candidate = s.slice(0, i + 4)
    if (candidate.startsWith('/')) return candidate
  }
  return null
}

/** 读 bundle 的 CFBundleIdentifier（AppleScript 按 bundle id 指挥，不受显示名/本地化影响）。 */
export function readBundleId(appPath, readFile = readFileSync) {
  try {
    const xml = readFile(join(appPath, 'Contents', 'Info.plist'), 'utf8')
    const m = xml.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/)
    return m ? m[1] : null
  } catch { return null }
}

/** shell 单引号安全包裹（路径里有空格/引号也不炸） */
function sq(v) { return `'${String(v).replace(/'/g, `'\\''`)}'` }

/** PowerShell 单引号字面量：内部单引号翻倍 */
function psQuote(v) { return `'${String(v).replace(/'/g, "''")}'` }

/** 拉起前静置 / 要求新实例至少活多久 / 每轮重试间隔（秒）——都写成可单测的常量 */
export const SETTLE_S = 2
export const STAY_S = 4
export const RETRY_S = 3

/** POSIX（macOS/Linux）辅助脚本：优雅退出 → 限时等待 → TERM → KILL → 清残留 → 拉起。
 *
 *  两个必须踩准的坑（都是实测踩出来的）：
 *   1. pkill 的模式写成 `dsh-desktop[-]host`：辅助脚本自己的命令行里含这个字符串，
 *      写成原样会让 pkill 把辅助进程自己杀掉；
 *   2. `open` 的退出码不能当「新实例起来了」用 —— App 正在退出的那一下，
 *      LaunchServices 认为它还在，`open` 直接回 0（等价于「唤到前台」）却什么都不拉起，
 *      于是 App 就这么没了。所以拉起必须「重试 + 用进程存在性复核」，最后一发用 open -n 强开。 */
export function posixRestartScript({ mainPid, appPath, bundleId, launcher, launchers = null, probe = null, traceFile = null }) {
  const bin = `'dsh-desktop[-]host/lib/index.js'`
  const trace = traceFile ? [
    `T=${sq(traceFile)}`,
    `trace() { mkdir -p "$(dirname "$T")" 2>/dev/null; printf '[%s] pid=%s %s\\n' "$(date -u +%FT%TZ)" "$$" "$*" >> "$T" 2>/dev/null; }`,
  ] : [`trace() { :; }`]
  const tries = launchers ?? [launcher]
  // 有探针 → 「拉起」是一段带复核的重试循环；没探针（Linux 直接 exec 自身）→ 发一发就完事
  const relaunch = probe ? [
    `up() { ${probe} >/dev/null 2>&1; }`,
    // 现场快照：新实例是「没起来」还是「起来了又自己退了」，以及它是谁家的孩子（ppid）
    `snap() { ps -eo pid,ppid,stat,comm | grep -i "DeepSeek Harness" | head -6 | tr '\n' '|'; }`,
    `sleep ${SETTLE_S}`,
    `k=0; ok=0`,
    `while [ "$k" -lt ${tries.length} ]; do`,
    `  if [ "$k" -eq 0 ]; then ${tries[0]}; else ${tries[tries.length - 1]}; fi; RC=$?`,
    `  wait_for 100 up`,
    `  trace "seen: $(snap)"`,
    `  if up; then`,
    `    # 「出现过」不等于「起来了」：老进程刚退那一下 Electron 的单实例锁还没释放，`,
    `    # 新实例发现自己不是第一个 → 把老窗口唤到前台就自己退了（实测 App 就这么消失的）。`,
    `    # 所以还要确认它留得住（活过 ${STAY_S}s），没留住就换 open -n 再过一轮。`,
    `    sleep ${STAY_S}`,
    `    if up; then ok=1; trace "app-up attempt=$k rc=$RC"; break; fi`,
    `    trace "app-died-after-start attempt=$k rc=$RC"`,
    `  else`,
    `    trace "app-not-up attempt=$k rc=$RC"`,
    `  fi`,
    `  k=$((k+1)); sleep ${RETRY_S}`,
    `done`,
    `[ $ok -eq 1 ] || trace relaunch-gave-up`,
  ] : [`sleep 0.4`, `trace relaunch; ${launcher} >/dev/null 2>&1 || true`]
  // AppleScript 句子整体用单引号包住，里面的双引号是 AppleScript 语法（不是 shell 的）
  const sentence = bundleId ? `tell application id "${bundleId}" to quit` : `tell application "${appPath}" to quit`
  const quit = `osascript -e ${sq(sentence)} >/dev/null 2>&1 & OSA=$!`
  // 优雅退出最多等 20s：官方 before-quit 有「任务仍在运行」确认框（main.js quitConfirmation.confirm），
  // 留出足够时间让人回答；超时说明这条路走不通（权限被拒/卡住），再按 TERM→KILL 升级。
  return [
    ...trace,
    `P=${sq(mainPid)}`,
    `A=${sq(appPath)}`,
    `alive() { case "$(ps -p "$P" -o stat= 2>/dev/null)" in ''|Z*) return 1 ;; *) return 0 ;; esac; }`,
    `wait_gone() { i=0; while [ "$i" -lt "$1" ] && alive; do sleep 0.1; i=$((i+1)); done; }`,
    `wait_for() { i=0; while [ "$i" -lt "$1" ] && ! "$2"; do sleep 0.1; i=$((i+1)); done; }`,
    `trace begin app="$A" main=$P`,
    `sleep 0.6`,
    `if alive; then`,
    `  ${quit}`,
    `  trace quit-sent`,
    `  wait_gone 200`,
    `  kill "$OSA" >/dev/null 2>&1`,
    `  alive && trace quit-blocked-20s || trace main-gone`,
    `fi`,
    `if alive; then trace escalate-TERM; kill -TERM "$P" >/dev/null 2>&1; wait_gone 60; fi`,
    `if alive; then trace escalate-KILL; kill -KILL "$P" >/dev/null 2>&1; wait_gone 40; fi`,
    `trace cleared-host-children`,
    `pkill -KILL -f ${bin} >/dev/null 2>&1`,
    ...relaunch,
  ].join('\n')
}

/** win32 辅助脚本（PowerShell）：CloseMainWindow ≈ 优雅退出，超时再 Stop-Process -Force。 */
export function windowsRestartScript({ mainPid, exePath }) {
  return [
    `$ErrorActionPreference='SilentlyContinue'`,
    `$p=${Number(mainPid) || 0}`,
    `Start-Sleep -Milliseconds 600`,
    `$proc=Get-Process -Id $p`,
    `if ($proc) { $null=$proc.CloseMainWindow(); $null=$proc.WaitForExit(12000) }`,
    `if (Get-Process -Id $p) { Stop-Process -Id $p -Force }`,
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'dsh-desktop-host' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
    `Start-Sleep -Milliseconds 400`,
    `if (Test-Path Env:\\ELECTRON_RUN_AS_NODE) { Remove-Item Env:\\ELECTRON_RUN_AS_NODE }`,
    `Start-Process -FilePath ${psQuote(exePath)}`,
  ].join('; ')
}

/** PowerShell -EncodedCommand：UTF-16LE + Base64，绕开 cmd 的一切引号地狱。 */
export function toEncodedCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/** 纯决策：给定运行期事实，算出该怎么重启（或为什么重启不了）。可单测，不碰进程。 */
export function planRestart({ platform = process.platform, ppid = process.ppid, execPath = process.execPath, argv = process.argv, appPath = null, bundleId = null, traceFile = null } = {}) {
  if (platform === 'darwin') {
    const app = appPath ?? resolveAppPath([execPath, ...(argv ?? [])])
    if (!app) return { ok: false, error: '当前 Host 不在 .app 里运行（命令行实例），请重启该命令：dsh stop && dsh start' }
    return {
      ok: true, mode: 'mac', app: app,
      command: '/bin/sh', args: ['-c', posixRestartScript({
        mainPid: ppid, appPath: app, bundleId: bundleId ?? readBundleId(app),
        // 探针认 App 自己的 MacOS/ 目录：主进程和 Host 子进程都用 bundle 内的可执行文件，起没起来一眼就知道
        probe: `pgrep -f "$A/Contents/MacOS/"`,
        launchers: [ENV_FREE + `open "$A" >/dev/null 2>>"$T"`, ENV_FREE + `open "$A" >/dev/null 2>>"$T"`, ENV_FREE + `open -n "$A" >/dev/null 2>>"$T"`],
        traceFile: traceFile ?? restartTraceFile(),
      })],
    }
  }
  if (platform === 'win32') {
    const exe = String(execPath ?? '')
    if (!/\.exe$/i.test(exe)) return { ok: false, error: '无法定位宿主 App 可执行文件，请手动重启' }
    const script = windowsRestartScript({ mainPid: ppid, exePath: exe })
    return { ok: true, mode: 'windows', app: exe, command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', toEncodedCommand(script)] }
  }
  const exe = String(execPath ?? '')
  if (!exe || !exe.startsWith('/')) return { ok: false, error: '当前平台无法自动重启，请手动退出后重新打开' }
  return {
    ok: true, mode: 'linux', app: exe,
    command: '/bin/sh', args: ['-c', posixRestartScript({ mainPid: ppid, appPath: exe, bundleId: null, launcher: `setsid "$A" >/dev/null 2>&1 &` })],
  }
}

/** 执行重启（detached + stdio ignore + 净化环境：App 退场时辅助进程不受牵连，
 *  也不能把 ELECTRON_RUN_AS_NODE 传染给被拉起的 App）。永远返回，不抛。
 *  opts.dedupeMs 仅供测试收紧防连点窗口。 */
export async function restartHost(opts = {}) {
  const spawnImpl = opts.spawn ?? spawn
  try {
    const window = Number.isFinite(opts.dedupeMs) ? opts.dedupeMs : RESTART_DEDUPE_MS
    if (started && Date.now() - started < window) {
      return { ok: true, started: false, note: '重启已在进行中' }
    }
    const plan = planRestart(opts)
    if (!plan.ok) return plan
    const child = spawnImpl(plan.command, plan.args, {
      detached: true, stdio: 'ignore', env: sanitizeSpawnEnv(opts.env ?? process.env),
    })
    if (!child || typeof child.unref === 'function') child?.unref?.()
    started = Date.now()
    return { ok: true, started: true, mode: plan.mode, app: plan.app }
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) }
  }
}
