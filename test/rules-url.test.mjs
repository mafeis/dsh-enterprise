/** block-url 规则回归：| 分隔多域名 + 子域名匹配 + 裸域名输入 */
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-url-test-'))
mkdirSync(join(process.env.DSH_HOME, 'enterprise'), { recursive: true })

const { _setCachedPolicyForTests } = await import('../src-node/policy/policy.js')
const { runUrlRules } = await import('../src-node/rules/engine.js')
import assert from 'node:assert/strict'

_setCachedPolicyForTests({ clientRules: [
  { id: 'u-1', type: 'block-url', action: 'block', value: 'google.com|baidu.com', message: '禁止访问搜索引擎' },
  { id: 'u-2', type: 'block-url', action: 'warn', value: 'example.org', message: '注意' },
] })

// | 分隔的两端都拦
assert.equal(runUrlRules('https://news.google.com/rss').allowed, false, 'google.com 应命中 u-1')
assert.equal(runUrlRules('https://www.baidu.com/').allowed, false, 'baidu.com 应命中 u-1')
// 子域名命中
assert.equal(runUrlRules('https://mail.google.com/').allowed, false, '子域名 mail.google.com 应命中')
// 精确域名命中
assert.equal(runUrlRules('https://google.com/').allowed, false, '裸 google.com 应命中')
// 未列入的域名放行
assert.equal(runUrlRules('https://news.sina.com.cn/').allowed, true, 'sina 未列入应放行')
// 裸域名输入（无 scheme）也检查
assert.equal(runUrlRules('baidu.com').allowed, false, '裸域名输入也应命中')
// warn 规则命中
const w = runUrlRules('https://example.org/x')
assert.equal(w.allowed, false, 'example.org 应命中 u-2')
assert.equal(w.hit.id, 'u-2')
// 坏 URL 放行不抛错
assert.equal(runUrlRules('not a url').allowed, true, '坏 URL 放行')

// 裸词规则值（google 而非 google.com）：按域名标签整词匹配
_setCachedPolicyForTests({ clientRules: [
  { id: 'u-w', type: 'block-url', action: 'warn', value: 'google|baidu', message: '' },
] })
assert.equal(runUrlRules('https://news.google.com/rss').allowed, false, '裸词 google 应命中 news.google.com')
assert.equal(runUrlRules('https://www.baidu.com/').allowed, false, '裸词 baidu 应命中 www.baidu.com')
assert.equal(runUrlRules('https://notgoogle.com/').allowed, true, 'notgoogle 不是整词标签，放行')
assert.equal(runUrlRules('https://google.evil.net/').allowed, false, '子域标签 google 命中')

console.log('✓ block-url 全部通过')
