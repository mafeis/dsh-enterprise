/** 心跳热生效回归：网关地址每拍重读（换网关无需重启实例） */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 必须在导入插件模块前定位 DSH_HOME（paths.js 每次调用时读环境变量）
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-hb-test-'))
mkdirSync(join(process.env.DSH_HOME, 'enterprise'), { recursive: true })

const { runHeartbeatOnce } = await import('../src-node/heartbeat/heartbeat.js')

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
