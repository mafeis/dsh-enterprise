/**
 * YAML 行级改写单测 —— 拆分前这些正则/行级逻辑没有回归保护，是历史事故重灾区
 * （踩坑实录 §3/§6：登录成功但选择器为空、providers 重复 key、登出漏屏蔽段等）。
 * 改 settings/yaml-edit.js 必须跑：node --test test/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeProviderFromSettingsYaml, syncOneMainSettingsProvider, profilePatchSettingsPaths } from '../src-node/settings/yaml-edit.js'

// 隔离环境：插件所有落盘都走 DSH_HOME / LOCALAPPDATA / ENT_SETTINGS_PATH，全部指向临时目录
const sandbox = mkdtempSync(join(tmpdir(), 'enterprise-test-'))
process.env.DSH_HOME = join(sandbox, 'dsh-home')
process.env.LOCALAPPDATA = join(sandbox, 'localappdata')
delete process.env.ENT_PROFILE_DIR
delete process.env.ENT_SETTINGS_PATH

const MODELS = [
  { id: 'ent-chat', name: '企业对话', contextWindow: 128000, maxTokens: 32768, input: ['text', 'image'], thinking_levels: ['off', 'low', 'high'] },
  { id: 'ent-fast', contextWindow: 64000, maxTokens: 8192, input: ['text'] }, // 非思考模型：不写 reasoningEfforts
]

test('removeProviderFromSettingsYaml：三种状态（块存在/已为空/无该段）', () => {
  const withBlock = [
    'llm-pi-ai:',
    '  providers:',
    '    other-plugin:',
    '      api: openai',
    '    ent-gateway:',
    '      api: openai-completions',
    '      models:',
    '        - id: x',
    '  audit: on',
    'other-top:',
    '  keep: 1',
  ].join('\n')
  const removed = removeProviderFromSettingsYaml(withBlock, 'ent-gateway')
  assert.ok(!removed.includes('ent-gateway'))
  assert.ok(removed.includes('other-plugin:'))       // 同级其他 provider 保留
  assert.ok(removed.includes('- id: x') === false)
  assert.ok(removed.includes('  audit: on'))          // providers 段内后续 key 保留
  assert.ok(removed.includes('other-top:'))           // 段外内容保留

  // 幂等：再删一次不变
  assert.equal(removeProviderFromSettingsYaml(removed, 'ent-gateway'), removed)

  // 无 ent-gateway 块：原样返回
  assert.equal(removeProviderFromSettingsYaml(withBlock.replace(/[\s\S]*ent-gateway[\s\S]*/, 'llm-pi-ai:\n  providers:\n'), 'ent-gateway'), 'llm-pi-ai:\n  providers:\n')

  // 没有 llm-pi-ai 段：原样返回
  const noLlm = 'foo:\n  bar: 1\n'
  assert.equal(removeProviderFromSettingsYaml(noLlm, 'ent-gateway'), noLlm)
})

test('syncOneMainSettingsProvider：独立 settings 文件不存在且未设 ENT_SETTINGS_PATH → 不创建（防污染共享主配置）', () => {
  const target = join(process.env.DSH_HOME, 'settings.yaml')
  syncOneMainSettingsProvider(target, 'http://gw:8900', MODELS)
  assert.equal(existsSync(target), false)
})

test('syncOneMainSettingsProvider：独立文件不存在 + ENT_SETTINGS_PATH → 引导创建骨架并写入', () => {
  const target = join(sandbox, 'profiles', 'p1', 'settings.yaml')
  mkdirSync(join(sandbox, 'profiles', 'p1'), { recursive: true })
  process.env.ENT_SETTINGS_PATH = target
  try {
    syncOneMainSettingsProvider(target, 'http://gw:8900', MODELS)
    const text = readFileSync(target, 'utf8')
    assert.ok(text.includes('llm-pi-ai:'))
    assert.ok(text.includes('    ent-gateway:'))
    assert.ok(text.includes('llm-deepseek:\n  models: []'))   // 官方 deepseek 屏蔽段（红线）
    assert.ok(text.includes('agent-default-model:'))
    assert.ok(text.includes('model: ent-chat'))
  } finally {
    delete process.env.ENT_SETTINGS_PATH
  }
})

test('syncOneMainSettingsProvider：providers: {} 内联空对象展开 + 思考档位 dict 格式（红线）', () => {
  const target = join(sandbox, 'settings-inline.yaml')
  writeFileSync(target, 'llm-pi-ai:\n  providers: {}\n', 'utf8')
  syncOneMainSettingsProvider(target, 'http://gw:8900', MODELS)
  const text = readFileSync(target, 'utf8')
  assert.ok(text.includes('  providers:'))                    // 展开为可插入形式
  assert.ok(text.includes('    ent-gateway:'))
  // reasoningEfforts 必须是 dict（off: none 形式），绝不能是 list
  assert.ok(text.includes('          reasoningEfforts:'))
  assert.ok(text.includes('            off: none'))
  assert.ok(/            low: low/.test(text))
  // 非思考模型不写 reasoningEfforts
  const fastBlock = text.slice(text.indexOf('- id: ent-fast'), text.indexOf('agent-default-model'))
  assert.ok(!fastBlock.includes('reasoningEfforts'))
})

test('syncOneMainSettingsProvider：幂等（重复同步不产生重复块/重复 key）', () => {
  const target = join(sandbox, 'settings-idem.yaml')
  writeFileSync(target, 'llm-pi-ai:\n  providers: {}\nllm-deepseek:\n  models: []\n', 'utf8')
  syncOneMainSettingsProvider(target, 'http://gw:8900', MODELS)
  const once = readFileSync(target, 'utf8')
  syncOneMainSettingsProvider(target, 'http://gw:8900', MODELS)
  const twice = readFileSync(target, 'utf8')
  assert.equal(once, twice)
  assert.equal((once.match(/ent-gateway:/g) ?? []).length, 1)
  assert.equal((once.match(/llm-deepseek:/g) ?? []).length, 1)
  assert.equal((once.match(/^providers:/gm) ?? []).length, 0) // 顶层绝不能出现重复 providers key
})

test('syncOneMainSettingsProvider：已有 agent-default-model 时不覆盖用户选择', () => {
  const target = join(sandbox, 'settings-adm.yaml')
  writeFileSync(target, 'agent-default-model:\n  provider: other-prov\n  model: user-choice\nllm-pi-ai:\n  providers: {}\n', 'utf8')
  syncOneMainSettingsProvider(target, 'http://gw:8900', MODELS)
  const text = readFileSync(target, 'utf8')
  assert.ok(text.includes('provider: other-prov'))
  assert.ok(text.includes('model: user-choice'))
})

test('profilePatchSettingsPaths：DSH_HOME 未设置时返回空数组', () => {
  const saved = process.env.DSH_HOME
  delete process.env.DSH_HOME
  try {
    assert.deepEqual(profilePatchSettingsPaths(), [])
  } finally {
    process.env.DSH_HOME = saved
  }
})

test('清理沙箱', () => { rmSync(sandbox, { recursive: true, force: true }) })
