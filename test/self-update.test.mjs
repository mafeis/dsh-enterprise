import assert from 'node:assert/strict'
import { test } from 'node:test'

const { compareSemver, pendingUpdateRestart } = await import('../src-node/update/self-update.js')

test('compareSemver：大于/小于/相等/空串', () => {
  assert.equal(compareSemver('0.9.9', '0.9.8'), 1)
  assert.equal(compareSemver('0.10.0', '0.9.9'), 1)
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0)
  assert.equal(compareSemver('0.9.8', '0.9.9'), -1)
  assert.equal(compareSemver('0.9.8', ''), 1)      // 空串视为 0.0.0
  assert.equal(compareSemver('', '0.0.1'), -1)
  assert.equal(compareSemver('2.0', '1.9.9'), 1)   // 段数不齐按 0 补
})

test('compareSemver：同段数值比较不吃字符串序', () => {
  assert.equal(compareSemver('0.9.10', '0.9.9'), 1)
  assert.equal(compareSemver('0.9.2', '0.9.10'), -1)
})

test('pendingUpdateRestart：无记录返回 null', () => {
  assert.equal(pendingUpdateRestart(), null)
})
