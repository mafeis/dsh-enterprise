/** 网关模型映射单测：llm-pi-ai 校验红线（input 只能 text/image）与显示名/元数据透传 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapGatewayModels } from '../src-node/auth/login.js'

test('mapGatewayModels：input 过滤到 text/image 白名单（红线：video/audio 会让整个 llm-pi-ai 段失效）', () => {
  const out = mapGatewayModels([
    { id: 'm1', input_modes: ['text', 'image', 'video', 'audio'], display_name: '旗舰', context_window: 200000, max_tokens: 65536, thinking_levels: ['off', 'low', 'high'] },
    { id: 'm2', input_modes: [], },                       // 空 → 回退 ['text']
    { id: 'm3', },                                        // 无字段 → 回退 ['text']
  ])
  assert.deepEqual(out[0].input, ['text', 'image'])
  assert.equal(out[0].name, '旗舰')
  assert.equal(out[0].contextWindow, 200000)
  assert.equal(out[0].maxTokens, 65536)
  assert.deepEqual(out[0].thinking_levels, ['off', 'low', 'high'])
  assert.deepEqual(out[0].reasoningEfforts, { off: 'none', low: 'low', high: 'high' })
  assert.equal(out[1].reasoningEfforts, undefined)
  assert.equal(out[2].reasoningEfforts, undefined)
  assert.deepEqual(out[1].input, ['text'])
  assert.deepEqual(out[2].input, ['text'])
  assert.equal(out[2].contextWindow, 128000)   // 缺省
  assert.equal(out[2].maxTokens, 32768)        // 缺省
})

test('mapGatewayModels：空数据返回空数组（调用方按「网关无可用模型」处理）', () => {
  assert.deepEqual(mapGatewayModels([]), [])
  assert.deepEqual(mapGatewayModels(undefined), [])
})
