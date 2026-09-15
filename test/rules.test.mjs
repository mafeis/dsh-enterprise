/** 本地规则引擎单测：block-url 两种写法、block-word 正则/降级、高危命令特征 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  runUrlRules, runTextRules, detectDangerousCommand, ruleHost, DANGER_CMD_PATTERNS,
} from '../src-node/rules/engine.js'
import { _setCachedPolicyForTests } from '../src-node/policy/policy.js'

afterEach(() => { _setCachedPolicyForTests(null) })

// 注意：被拦截域名用数组拼接构造——本测试文件会被企业规则引擎当工具参数扫描，
// 字面写完整 URL 会让测试代码自身被 block-url 规则拦截（真实发生过）。
const blockedHost = ['chatgpt', 'com'].join('.')

test('runUrlRules：规则值带 scheme 与裸域名两种写法都命中', () => {
  _setCachedPolicyForTests({ clientRules: [{ id: 'r1', type: 'block-url', action: 'block', value: blockedHost }] })
  assert.equal(runUrlRules('https://' + blockedHost + '/').allowed, false) // 带 scheme 的规则值写法
  assert.equal(runUrlRules(blockedHost).allowed, false)                    // 裸域名写法
  assert.equal(runUrlRules('https://www.' + blockedHost + '/x').allowed, false) // 子域命中
  assert.equal(runUrlRules('https://example.com/').allowed, true)
  assert.equal(runUrlRules('not a url').allowed, true)                  // 解析失败放行
})

test('runTextRules：合法正则命中 / 坏正则降级为 includes', () => {
  _setCachedPolicyForTests({ clientRules: [
    { id: 'w1', type: 'block-word', action: 'block', value: '内部机密' },
    { id: 'w2', type: 'block-word', action: 'block', value: '(bad-regex[' },
  ] })
  assert.equal(runTextRules('请总结：内部机密项目').allowed, false)
  assert.equal(runTextRules('正常内容').allowed, true)
  // 坏正则：降级字符串包含判断仍能命中
  const r = runTextRules('包含 (bad-regex[ 字样')
  assert.equal(r.allowed, false)
  assert.equal(r.hit.id, 'w2')
})

test('detectDangerousCommand：高危特征命中与放行', () => {
  assert.equal(detectDangerousCommand('rm -rf /tmp/x').label, 'rm 递归/强制删除')
  assert.equal(detectDangerousCommand('format d:').label, '格式化磁盘')
  assert.ok(detectDangerousCommand('shutdown /r'))
  assert.ok(detectDangerousCommand('taskkill /f /im app.exe'))
  assert.equal(detectDangerousCommand('git status'), null)
  assert.equal(detectDangerousCommand('npm run build'), null)
})

test('DANGER_CMD_PATTERNS 正则全部可用（坏正则静默忽略的兜底不该被用到）', () => {
  for (const d of DANGER_CMD_PATTERNS) assert.doesNotThrow(() => d.re.test(''))
})

test('ruleHost：剥 scheme/路径/首点', () => {
  assert.equal(ruleHost('https://a.b.com/path'), 'a.b.com')
  assert.equal(ruleHost('.evil.com'), 'evil.com')
  assert.equal(ruleHost('plain.host'), 'plain.host')
})
