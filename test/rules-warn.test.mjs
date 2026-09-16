/** warn 级规则可观测性回归：warn 命中必须记录 + 注入提醒（此前被静默忽略，规则形同虚设） */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-warn-test-'))
mkdirSync(join(process.env.DSH_HOME, 'enterprise'), { recursive: true })

const { registerRuleHooks } = await import('../src-node/rules/hooks.js')
const { _setCachedPolicyForTests, peekCachedPolicy } = await import('../src-node/policy/policy.js')
const { getRuleHits } = await import('../src-node/rules/engine.js')

/** 最小宿主桩：记录注册的事件监听，waterfall 手动触发 */
function stubCtx() {
  const listeners = {}
  return {
    listeners,
    logger: { info() {}, warn() {}, error() {} },
    on(event, fn) { (listeners[event] ??= []).push(fn); return () => {} },
    effect(fn, _name) { fn() },
  }
}

test('warn 级命中：放行 + 记命中记录，不进模型上下文（界面横幅由客户端轮询渲染）', async () => {
  _setCachedPolicyForTests({ clientRules: [{ id: 'cr-w', type: 'block-word', action: 'warn', value: '账号|密码', message: '注意外发风险' }] })
  const ctx = stubCtx()
  registerRuleHooks(ctx)
  const preStep = ctx.listeners['agent/pre-step'][0]
  const agent = { id: 'agent-1' }
  const payload = { agent, messages: [{ role: 'user', content: '我的账号密码是什么' }] }
  const result = await preStep(payload, () => ({ kind: 'continue', messages: [] }))
  assert.equal(result.kind, 'continue', 'warn 级必须放行')
  assert.equal((result.messages ?? []).length, 0, '不得向模型注入任何消息')
  assert.equal(payload.messages[0].content, '我的账号密码是什么', '用户原始消息不得改写')
  const hits = getRuleHits()
  const hit = hits.find((h) => h.ruleId === 'cr-w')
  assert.ok(hit, '命中记录里必须有 warn 痕迹（客户端横幅数据源）')
  assert.equal(hit.matched, '账号', '记录应含命中的词（横幅「命中「账号」」）')
  assert.equal(hit.message, '注意外发风险', '记录应含规则提示语（横幅显示）')
  assert.ok(!hit.blocked, 'warn 记录不得带 blocked')
  assert.equal(result.kind, 'continue', 'warn 级必须放行')
})

test('block 级命中：直接 reject + 记录带 blocked/message（客户端立即显示拦截横幅）', async () => {
  _setCachedPolicyForTests({ clientRules: [{ id: 'cr-b', type: 'block-word', action: 'block', value: '机密', message: '禁止外发' }] })
  const ctx = stubCtx()
  registerRuleHooks(ctx)
  const handler = ctx.listeners['agent/pre-step'][0]
  const payload = { messages: [{ role: 'user', content: '这是机密文件' }] }
  const result = await handler(payload, () => ({ kind: 'continue', messages: [] }))
  assert.deepEqual(result, { kind: 'reject' }, 'block 级必须拦截')
  assert.equal(payload.messages[0].content, '这是机密文件', '拦截路径不得改写消息')
  const hit = getRuleHits().find((h) => h.ruleId === 'cr-b')
  assert.ok(hit, '拦截也必须有记录')
  assert.equal(hit.blocked, true, '记录应带 blocked 标记（客户端区分横幅样式/时机）')
  assert.equal(hit.matched, '机密', '记录应含命中的词')
  assert.equal(hit.message, '禁止外发', '记录应含规则提示语')
})

test('未命中：无命中记录', async () => {
  _setCachedPolicyForTests({ clientRules: [{ id: 'cr-w', type: 'block-word', action: 'warn', value: '账号|密码', message: '注意' }] })
  const ctx = stubCtx()
  registerRuleHooks(ctx)
  const handler = ctx.listeners['agent/pre-step'][0]
  const payload = { messages: [{ role: 'user', content: '今天天气不错' }] }
  const before = getRuleHits().length
  await handler(payload, () => ({ kind: 'continue', messages: [] }))
  assert.equal(getRuleHits().length, before, '未命中不得新增记录')
})

test('同时命中 warn+block：block 优先拦截，只记 block（消息已拦，warn 无意义）', async () => {
  _setCachedPolicyForTests({ clientRules: [
    { id: 'cr-w', type: 'block-word', action: 'warn', value: '账号|密码', message: '注意外发风险' },
    { id: 'cr-b', type: 'block-word', action: 'block', value: '银行卡', message: '禁止外发' },
  ] })
  const ctx = stubCtx()
  registerRuleHooks(ctx)
  const handler = ctx.listeners['agent/pre-step'][0]
  const payload = { messages: [{ role: 'user', content: '账号 密码 是 123456 银行卡我测试拦截规则' }] }
  const beforeCount = getRuleHits().length
  const result = await handler(payload, () => ({ kind: 'continue', messages: [] }))
  assert.deepEqual(result, { kind: 'reject' }, '同时命中时 block 级必须拦截')
  const hits = getRuleHits()
  const newHits = hits.slice(0, hits.length - beforeCount)
  assert.equal(newHits.length, 1, '只记 block 一条，不记 warn')
  assert.equal(newHits[0].ruleId, 'cr-b')
  assert.equal(newHits[0].blocked, true)
  assert.equal(newHits[0].matched, '银行卡')
})

test('无策略（peekCachedPolicy null）时不抛错正常放行', async () => {
  _setCachedPolicyForTests(null)
  const ctx = stubCtx()
  registerRuleHooks(ctx)
  const handler = ctx.listeners['agent/pre-step'][0]
  const payload = { messages: [{ role: 'user', content: '随便说说' }] }
  const result = await handler(payload, () => ({ kind: 'continue', messages: [] }))
  assert.equal(result.kind, 'continue', '无策略时正常放行')
})
