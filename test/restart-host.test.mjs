/** 「立即重启」的插件侧后端（update/restart-host.js）。
 *  不真起进程：只验「算出来的重启方案对不对」——macOS 上顺序错了（先 open 后退）
 *  或 pkill 模式写漏了防自杀括号，都是现场翻车但单测不报错的那类 bug。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { planRestart, resolveAppPath, readBundleId, posixRestartScript, toEncodedCommand, restartHost, sanitizeSpawnEnv } from '../src-node/update/restart-host.js'

const HOST_ARGV = [
  '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness',
  '--expose-internals',
  '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js',
  '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh',
  '/Users/mac/.dsh/profiles/desktop',
]
const EXE = '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'

test('resolveAppPath：从 app.asar 形态的 argv 里取出 .app 根目录', () => {
  assert.equal(resolveAppPath([EXE, ...HOST_ARGV]), '/Applications/DeepSeek Harness.app')
  assert.equal(resolveAppPath(['/opt/homebrew/bin/node', '/usr/local/lib/dsh/cli.js']), null, '命令行实例不该假装自己是 App')
})

test('readBundleId：读 Info.plist 的 CFBundleIdentifier（拿它指挥 App，不受显示名影响）', () => {
  const xml = '<?xml version="1.0"?><plist><dict><key>CFBundleName</key><string>DeepSeek Harness</string><key>CFBundleIdentifier</key><string>com.deepseek.dsh</string></dict></plist>'
  assert.equal(readBundleId('/Applications/DeepSeek Harness.app', () => xml), 'com.deepseek.dsh')
  assert.equal(readBundleId('/nope', () => { throw new Error('ENOENT') }), null)
})

test('macOS 重启方案：先优雅退出 → TERM → KILL → 清残留 → 最后才 open（单实例锁决定了这个顺序）', () => {
  const p = planRestart({ platform: 'darwin', ppid: 58353, execPath: EXE, argv: HOST_ARGV, bundleId: 'com.deepseek.dsh' })
  assert.equal(p.ok, true)
  assert.equal(p.mode, 'mac')
  assert.equal(p.app, '/Applications/DeepSeek Harness.app')
  assert.deepEqual(p.args.slice(0, 1), ['-c'])
  const sh = p.args[1]
  const at = (needle) => sh.indexOf(needle)
  assert.ok(at('tell application id "com.deepseek.dsh" to quit') > 0, 'AppleScript 的双引号必须还在（那是 AppleScript 语法）')
  assert.ok(at('osascript') < at('kill -TERM'), '优雅退出要在硬杀之前')
  assert.ok(at('kill -TERM') < at('kill -KILL'), 'TERM 先于 KILL')
  assert.ok(at('pkill') < at('open "$A"'), '残留 Host 子进程要在拉起新实例之前清干净（否则占着 web 端口）')
  // open 的退出码不算数：App 正在退的那一下 LaunchServices 认为它还在，open 回 0 却什么都不拉起
  assert.ok(sh.includes('pgrep -f "$A/Contents/MacOS/"'), '拉起后要用进程存在性复核')
  assert.ok(sh.includes('open -n "$A"'), '复核没起来要重试，最后一发 open -n 强开')
  assert.ok(!/while \[ "\$n" -lt 3 \]; do open/.test(sh), '不能再用「open 返回 0 就当成功」的老写法')
  assert.ok(at('sleep 0.6') < at('osascript'), '先让 HTTP 响应发完再动手杀')
  assert.ok(sh.includes('wait_gone 200'), '优雅退出至少等 20s：官方 before-quit 有「任务仍在运行」确认框，得留够回答时间')
})

test('pkill 模式必须写成 dsh-desktop[-]host：辅助脚本自己的命令行里含原串，写原串等于自杀', () => {
  const sh = posixRestartScript({ mainPid: 1, appPath: '/Applications/A.app', bundleId: 'a.b', launcher: 'open "$A"' })
  assert.ok(sh.includes("'dsh-desktop[-]host/lib/index.js'"), '正则要有防自杀的字符类')
  assert.ok(!sh.includes('dsh-desktop-host/lib/index.js'), '脚本里不能出现原样可被 -f 命中的串')
})

test('路径带空格/单引号也不能被 shell 拆开或逃逸（真起 sh 回读，不做字符串比划）', () => {
  const weird = "/Applications/My 'Weird'.app"
  const sh = posixRestartScript({ mainPid: 42, appPath: weird, bundleId: "a'b", launcher: 'open "$A"' })
  // 把脚本里的变量赋值行单独交给 /bin/sh 执行，回读出来的必须和原值一字不差
  const line = sh.split('\n').find((l) => l.startsWith('A='))
  const back = execFileSync('/bin/sh', ['-c', `${line}; printf %s "$A"`], { encoding: 'utf8' })
  assert.equal(back, weird)
  const osa = sh.split('\n').find((l) => l.includes('osascript'))
  const cmd = execFileSync('/bin/sh', ['-c', osa.replace('osascript -e', 'printf %s').replace(' >/dev/null 2>&1 & OSA=$!', '')], { encoding: 'utf8' })
  assert.equal(cmd, `tell application id "a'b" to quit`)
})

test('命令行 Host（dsh web/tui）不硬来：给出可执行的手工指引', () => {
  const p = planRestart({ platform: 'darwin', ppid: 1, execPath: '/opt/homebrew/bin/node', argv: ['/opt/homebrew/lib/node_modules/dsh/bin/dsh.js', 'web'] })
  assert.equal(p.ok, false)
  assert.match(String(p.error), /dsh stop/)
})

test('Windows 方案：EncodedCommand 往返无损（绕开 cmd 引号地狱）', () => {
  const p = planRestart({ platform: 'win32', ppid: 4321, execPath: 'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe' })
  assert.equal(p.ok, true)
  assert.equal(p.mode, 'windows')
  const ps = Buffer.from(p.args.at(-1), 'base64').toString('utf16le')
  assert.ok(ps.includes("$p=4321") && ps.includes("CloseMainWindow") && ps.includes("'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe'"), ps)
  assert.ok(ps.indexOf('CloseMainWindow') < ps.indexOf('Stop-Process'), '优雅关闭先于强杀')
  assert.equal(toEncodedCommand('abc'), Buffer.from('abc', 'utf16le').toString('base64'))
})

test('restartHost：接单前先把方案算清楚；算不出来就不起辅助进程', async () => {
  let spawned = 0
  const r = await restartHost({ platform: 'darwin', ppid: 1, execPath: '/usr/bin/node', argv: [], spawn: () => { spawned++; return { unref() {} } } })
  assert.equal(r.ok, false)
  assert.equal(spawned, 0)
})

test('restartHost：连点/并发只放行一次辅助进程', async () => {
  let spawned = 0
  const opts = { platform: 'win32', ppid: 4321, execPath: 'C:\\app\\DeepSeek Harness.exe', spawn: () => { spawned++; return { unref() {} } } }
  const a = await restartHost(opts)
  const b = await restartHost(opts)
  assert.equal(a.ok, true)
  assert.equal(a.started, true)
  assert.equal(b.started, false, '15s 内的第二次请求只回「已在进行中」')
  assert.equal(spawned, 1)
})

test('【根因】辅助进程必须洗掉 ELECTRON_RUN_AS_NODE：带着它 open，新 App 会退化成 node 然后自己退', () => {
  // 现场：宿主 Host 子进程 env 里有 ELECTRON_RUN_AS_NODE=1（官方 App 用自己的 Electron 二进制当 node 用）
  const clean = sanitizeSpawnEnv({ ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1', PATH: '/usr/bin', DSH_HOME: '/Users/mac/.dsh' })
  assert.equal(clean.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(clean.ELECTRON_NO_ATTACH_CONSOLE, undefined)
  assert.deepEqual({ PATH: clean.PATH, DSH_HOME: clean.DSH_HOME }, { PATH: '/usr/bin', DSH_HOME: '/Users/mac/.dsh' }, '业务要用的变量一个都不能丢')
  // 拉起那一发自己也要再剥一次（脚本可能被别处调起，双保险）
  const p = planRestart({ platform: 'darwin', ppid: 1, execPath: '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness', argv: [], bundleId: 'com.deepseek.dsh' })
  assert.ok(p.args[1].includes('env -u ELECTRON_RUN_AS_NODE open "$A"'), p.args[1])
})

test('restartHost 把净化后的环境交给 spawn（不是原样继承 process.env）', async () => {
  let got = null
  const prev = process.env.ELECTRON_RUN_AS_NODE
  process.env.ELECTRON_RUN_AS_NODE = '1'
  try {
    const r = await restartHost({
      platform: 'win32', ppid: 4321, execPath: 'C:\\app\\DeepSeek Harness.exe',
      dedupeMs: 0,   // 上一个用例刚点过一次，这里不受 15s 防连点窗口影响
      spawn: (_c, _a, o) => { got = o; return { unref() {} } },
    })
    assert.equal(r.ok, true)
    assert.equal(got.env.ELECTRON_RUN_AS_NODE, undefined)
    assert.equal(got.detached, true)
    assert.equal(got.stdio, 'ignore', '不能留 stdio：App 退了以后辅助进程还得活着把新实例拉起来')
  } finally {
    if (prev === undefined) delete process.env.ELECTRON_RUN_AS_NODE; else process.env.ELECTRON_RUN_AS_NODE = prev
  }
})
