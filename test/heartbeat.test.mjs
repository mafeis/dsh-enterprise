/** 心跳热生效回归：网关地址每拍重读（换网关无需重启实例）+ 401 连续 2 次自动清场 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 必须在导入插件模块前定位 DSH_HOME（paths.js 每次调用时读环境变量）
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-hb-test-'))
mkdirSync(join(process.env.DSH_HOME, 'enterprise'), { recursive: true })

const { runHeartbeatOnce, __resetForTest } = await import('../src-node/heartbeat/heartbeat.js')
const { readState } = await import('../src-node/state/state.js')

const stateFile = join(process.env.DSH_HOME, 'enterprise', 'enterprise-state.json')
const writeState = (gateway) =>
  writeFileSync(stateFile, JSON.stringify({ gateway, user: 'u', heartbeatConfig: { enabled: true, intervalSec: 15 } }))

test('heartbeat 每拍重读网关地址：状态文件里 gateway 变了，下一拍即切换', async () => {
  writeState('http://gw-one')
  const hits = []
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url) => { hits.push(String(url)); return new Response('{}', { status: 200 }) }
  try {
    await runHeartbeatOnce()
    writeState('http://gw-two')
    await runHeartbeatOnce()
  } finally {
    globalThis.fetch = origFetch
  }
  assert.ok(hits.some((u) => u.startsWith('http://gw-one/')), `应打到 gw-one：${hits.join(', ')}`)
  assert.ok(hits.some((u) => u.startsWith('http://gw-two/')), `应打到 gw-two（不重启即切换）：${hits.join(', ')}`)
})

test('heartbeat 未登录（无 gateway）时静默跳过，不发起请求不抛错', async () => {
  writeFileSync(stateFile, JSON.stringify({ user: 'u', heartbeatConfig: { enabled: true, intervalSec: 15 } }))
  const hits = []
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url) => { hits.push(String(url)); return new Response('{}', { status: 200 }) }
  try {
    const r = await runHeartbeatOnce()
    assert.equal(hits.length, 0)
    assert.equal(r.lastOk, false)
  } finally {
    globalThis.fetch = origFetch
  }
})

/** 401 清场用例的登录态夹具：provider 配置 + 凭证 + 登录态齐全 */
function setupLoggedIn() {
  const home = process.env.DSH_HOME
  writeFileSync(stateFile, JSON.stringify({ gateway: 'http://gw', user: 'u', tokenPreview: 'tok', heartbeatConfig: { enabled: true, intervalSec: 15 } }))
  writeFileSync(join(home, 'enterprise', 'enterprise-settings.yaml'), JSON.stringify({ providers: { 'ent-gateway': { models: [] } }, 'agent-default-model': { provider: 'ent-gateway' } }))
  writeFileSync(join(home, '.credentials.yaml'), 'version: 1\nrefs:\n  ENT_GATEWAY_TOKEN: tok\n')
  writeFileSync(join(home, 'settings.yaml'), 'llm-pi-ai:\n  providers:\n    ent-gateway:\n      baseUrl: http://gw\n')
}

test('heartbeat 连续 2 次 401：自动清场（provider/凭证/登录态清空，网关地址保留）', async () => {
  setupLoggedIn()
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{"error":"disabled"}', { status: 401 })
  try {
    await runHeartbeatOnce()
    // 第一次 401：不清场
    assert.equal(readState().user, 'u')
    await runHeartbeatOnce()
  } finally {
    globalThis.fetch = origFetch
  }
  const st = readState()
  assert.equal(st.user, null, '登录态应清空')
  assert.equal(st.gateway, 'http://gw', '网关地址应保留（登录页预填）')
  const ent = JSON.parse(readFileSync(join(process.env.DSH_HOME, 'enterprise', 'enterprise-settings.yaml'), 'utf8'))
  assert.equal(ent.providers?.['ent-gateway'], undefined, 'ent-gateway provider 应移除')
  const cred = readFileSync(join(process.env.DSH_HOME, '.credentials.yaml'), 'utf8')
  assert.ok(!/ENT_GATEWAY_TOKEN/.test(cred), '凭证应移除')
  // 第三拍：登录态已清，应静默跳过——不再发请求，也不会重复清场
  let extraHits = 0
  globalThis.fetch = async () => { extraHits++; return new Response('{}', { status: 401 }) }
  try { await runHeartbeatOnce() } finally { globalThis.fetch = origFetch }
  assert.equal(extraHits, 0, '清场后心跳应跳过，不再打 401')
})

test('heartbeat 单次 401 或网络错误：不清场（防抖动误伤）', async () => {
  setupLoggedIn()
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{}', { status: 401 })
  try { await runHeartbeatOnce() } finally { globalThis.fetch = origFetch }
  assert.equal(readState().user, 'u', '单次 401 不应清场')
  // 网络错误（fetch reject）也不清场
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED') }
  try { await runHeartbeatOnce() } finally { globalThis.fetch = origFetch }
  assert.equal(readState().user, 'u', '网络错误不应清场')
  // 恢复 200：401 计数归零，再单独一次 401 仍不清场
  globalThis.fetch = async () => new Response('{}', { status: 200 })
  try { await runHeartbeatOnce() } finally { globalThis.fetch = origFetch }
  globalThis.fetch = async () => new Response('{}', { status: 401 })
  try { await runHeartbeatOnce() } finally { globalThis.fetch = origFetch }
  assert.equal(readState().user, 'u', '成功拍后计数归零，单次 401 不应清场')
})

test('heartbeat 5xx 但 /auth/verify 说 token 无效（如网关 SQLite bug 把拒绝报成 500）：连续 2 次也自动清场', async () => {
  __resetForTest() // 前面的 401 用例给模块级计数留了 1，先归零再测本轮语义
  setupLoggedIn()
  const origFetch = globalThis.fetch
  let verifyCalls = 0
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/auth/verify')) {
      verifyCalls++
      return new Response('{"valid":false,"reason":"auth_disabled"}', { status: 200 })
    }
    return new Response('{"error":{"message":"TypeError: Provided value cannot be bound to SQLite parameter 2."}}', { status: 500 })
  }
  try {
    await runHeartbeatOnce()
    assert.equal(readState().user, 'u', '第一次 500+verify 无效：不清场')
    await runHeartbeatOnce()
  } finally {
    globalThis.fetch = origFetch
  }
  assert.equal(verifyCalls, 2, '每拍 5xx 都应经 /auth/verify 复核')
  assert.equal(readState().user, null, '连续 2 次 5xx 且凭证确实无效：应清场')
  assert.equal(readState().gateway, 'http://gw', '网关地址保留')
})

test('heartbeat 响应带显式账号状态 auth.ok=false（新网关）：连续 2 拍自动清场', async () => {
  __resetForTest()
  setupLoggedIn()
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/auth/verify')) return new Response('{"valid":false}', { status: 200 })
    // 新网关：200 + auth.ok=false（心跳不鉴权，账号状态显式透出）
    return new Response('{"ok":true,"auth":{"ok":false,"reason":"auth_disabled"}}', { status: 200 })
  }
  try {
    await runHeartbeatOnce()
    assert.equal(readState().user, 'u', '第一拍 auth.ok=false：不清场')
    await runHeartbeatOnce()
  } finally {
    globalThis.fetch = origFetch
  }
  assert.equal(readState().user, null, '连续 2 拍 auth.ok=false：应清场')
  assert.equal(readState().gateway, 'http://gw', '网关地址保留')
})

test('heartbeat auth_missing（空票残拍）：不清场不计入清场计数', async () => {
  __resetForTest()
  setupLoggedIn()
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{"ok":true,"auth":{"ok":false,"reason":"auth_missing"}}', { status: 200 })
  try { await runHeartbeatOnce(); await runHeartbeatOnce(); await runHeartbeatOnce() } finally { globalThis.fetch = origFetch }
  assert.equal(readState().user, 'u', 'auth_missing 是空票残拍语义，不应清场')
})

test('heartbeat 带凭证文件里的真实 token（state.token 恒 null 不影响 Bearer）', async () => {
  __resetForTest()
  setupLoggedIn()
  const origFetch = globalThis.fetch
  let authHeader = ''
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).endsWith('/auth/verify')) return new Response('{"valid":true}', { status: 200 })
    authHeader = opts.headers?.authorization ?? ''
    return new Response('{"ok":true,"auth":{"ok":true}}', { status: 200 })
  }
  try { await runHeartbeatOnce() } finally { globalThis.fetch = origFetch }
  assert.equal(authHeader, 'Bearer tok', 'Bearer 应取凭证文件里的真实 token，而非 state.token（恒 null）')
})

test('heartbeat 响应带显式账号状态 auth.ok=true（新网关正常账号）：不清场', async () => {
  __resetForTest()
  setupLoggedIn()
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{"ok":true,"auth":{"ok":true,"user":"u"}}', { status: 200 })
  try { await runHeartbeatOnce(); await runHeartbeatOnce() } finally { globalThis.fetch = origFetch }
  assert.equal(readState().user, 'u', 'auth.ok=true 不应清场')
})

test('heartbeat 5xx 且 /auth/verify 正常（网关自身故障）：不清场', async () => {
  __resetForTest()
  setupLoggedIn()
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/auth/verify')) return new Response('{"valid":true}', { status: 200 })
    return new Response('{}', { status: 500 })
  }
  try { await runHeartbeatOnce(); await runHeartbeatOnce() } finally { globalThis.fetch = origFetch }
  assert.equal(readState().user, 'u', 'verify 说票有效：网关 5xx 属网关故障，不应清场')
})
