/** provider 配置单测：同一时间只允许一个 ent-gateway，协议切换不产生第二组模型。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'enterprise-provider-'))
process.env.DSH_HOME = sandbox
delete process.env.ENT_PROFILE_DIR
delete process.env.ENT_SETTINGS_PATH

const { writeProviderConfig } = await import('../src-node/settings/provider-config.js')
const { entSettingsFile } = await import('../src-node/shared/paths.js')
const { normalizeApiProtocol, apiKindForProtocol } = await import('../src-node/settings/api-protocol.js')

const MODELS = [{ id: 'ent-chat', name: '企业对话', contextWindow: 128000, maxTokens: 32768, input: ['text'] }]

test('api protocol：未知值回退 completions；responses 映射 openai-responses', () => {
  assert.equal(normalizeApiProtocol(undefined), 'completions')
  assert.equal(normalizeApiProtocol('bad'), 'completions')
  assert.equal(normalizeApiProtocol('responses'), 'responses')
  assert.equal(apiKindForProtocol('responses'), 'openai-responses')
  assert.equal(apiKindForProtocol('completions'), 'openai-completions')
})

test('writeProviderConfig：只写一个 ent-gateway，协议切换清理旧 responses provider', () => {
  writeProviderConfig('http://gw:8900', MODELS, 'completions')
  let s = JSON.parse(readFileSync(entSettingsFile(), 'utf8'))
  assert.ok(s.providers['ent-gateway'])
  assert.equal(s.providers['ent-gateway-responses'], undefined)
  assert.equal(s.providers['ent-gateway'].api, 'openai-completions')
  assert.deepEqual(s.providers['ent-gateway'].compat, { thinkingFormat: 'openai' })

  writeProviderConfig('http://gw:8900', MODELS, 'responses')
  s = JSON.parse(readFileSync(entSettingsFile(), 'utf8'))
  assert.equal(s.providers['ent-gateway'].api, 'openai-responses')
  assert.equal(s.providers['ent-gateway-responses'], undefined)
  assert.equal(s.providers['ent-gateway'].compat, undefined)
})

test('清理沙箱', () => { rmSync(sandbox, { recursive: true, force: true }) })
