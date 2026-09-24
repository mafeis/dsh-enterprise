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
import { removeProviderFromSettingsYaml, syncOneMainSettingsProvider, syncMainSettingsProvider, profilePatchSettingsPaths, syncEnterpriseProfilePatches, clearEnterpriseProfilePatches } from '../src-node/settings/yaml-edit.js'

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
  // 双协议后 ent-fast 之后紧跟第二个 provider，切片到 ent-gateway-responses 为止
  const fastBlock = text.slice(text.indexOf('- id: ent-fast'), text.indexOf('    ent-gateway-responses:'))
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

test('syncOneMainSettingsProvider：内测横幅预签 + 增强模式（补段/补键/幂等/不覆盖用户选择）', () => {
  // 1. 全新骨架：应补 ui-onboarding + welcomeNoticeVersion + dsh-desktop.mode
  const t1 = join(sandbox, 'settings-notice-new.yaml')
  writeFileSync(t1, 'llm-pi-ai:\n  providers: {}\n', 'utf8')
  syncOneMainSettingsProvider(t1, 'http://gw:8900', MODELS)
  const s1 = readFileSync(t1, 'utf8')
  assert.ok(/^ui-onboarding:\s*$/m.test(s1))
  assert.ok(/^\s+welcomeNoticeVersion: 2026-08-13\.1$/m.test(s1))
  assert.ok(/^dsh-desktop:\s*$/m.test(s1))
  assert.ok(/^\s+mode: advanced$/m.test(s1))

  // 2. 已有段但缺键：只补键，不动段内其他内容
  const t2 = join(sandbox, 'settings-notice-partial.yaml')
  writeFileSync(t2, 'ui-onboarding:\n  otherKey: keep-me\ndsh-desktop:\n  windowsMaterial: mica\nllm-pi-ai:\n  providers: {}\n', 'utf8')
  syncOneMainSettingsProvider(t2, 'http://gw:8900', MODELS)
  const s2 = readFileSync(t2, 'utf8')
  assert.ok(/^\s+welcomeNoticeVersion: 2026-08-13\.1$/m.test(s2))
  assert.ok(/^\s+mode: advanced$/m.test(s2))
  assert.ok(s2.includes('otherKey: keep-me'))
  assert.ok(s2.includes('windowsMaterial: mica'))

  // 3. 已签过/用户已选模式：幂等，绝不覆盖用户选择
  const t3 = join(sandbox, 'settings-notice-acked.yaml')
  writeFileSync(t3, 'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\ndsh-desktop:\n  mode: compatibility\nllm-pi-ai:\n  providers: {}\n', 'utf8')
  syncOneMainSettingsProvider(t3, 'http://gw:8900', MODELS)
  const s3 = readFileSync(t3, 'utf8')
  assert.equal((s3.match(/welcomeNoticeVersion:/g) ?? []).length, 1)
  assert.ok(s3.includes('mode: compatibility')) // 用户选过兼容模式：不覆盖
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

test('syncOneMainSettingsProvider：双协议并存（completions + responses）', () => {
  const target = join(sandbox, 'settings-dual-api.yaml')
  writeFileSync(target, 'llm-pi-ai:\n  providers: {}\n', 'utf8')
  syncOneMainSettingsProvider(target, 'http://gw:8900', MODELS)
  const text = readFileSync(target, 'utf8')
  assert.ok(text.includes('    ent-gateway:'))
  assert.ok(text.includes('    ent-gateway-responses:'))
  assert.ok(text.includes('      api: openai-completions'))
  assert.ok(text.includes('      api: openai-responses'))
  assert.equal((text.match(/      api: openai-completions/g) ?? []).length, 1)
  assert.equal((text.match(/      api: openai-responses/g) ?? []).length, 1)
  // 两个 provider 同模型同凭证
  assert.equal((text.match(/- id: ent-chat/g) ?? []).length, 2)
  assert.equal((text.match(/apiKeyEnv: ENT_GATEWAY_TOKEN_V2/g) ?? []).length, 2)
})

test('syncEnterpriseProfilePatches：profile patch 双协议 + reasoningEfforts dict', () => {
  const file = join(sandbox, 'cordis.patch.yaml')
  writeFileSync(file, JSON.stringify([{ id: 'other', config: { keep: true } }]), 'utf8')
  process.env.ENT_PATCH_FILE = file
  try {
    const patchModels = [
      { id: 'ent-chat', name: '企业对话', contextWindow: 128000, maxTokens: 32768, input: ['text', 'image'], reasoningEfforts: { off: 'none', low: 'low', high: 'high' } },
      { id: 'ent-fast', contextWindow: 64000, maxTokens: 8192, input: ['text'] },
    ]
    syncEnterpriseProfilePatches('http://gw:8900', patchModels)
    const doc = JSON.parse(readFileSync(file, 'utf8'))
    const llm = doc.find((r) => r.id === 'llm-pi-ai')
    assert.ok(llm, 'llm-pi-ai 行已写入')
    assert.equal(llm.config.providers['ent-gateway'].api, 'openai-completions')
    assert.equal(llm.config.providers['ent-gateway-responses'].api, 'openai-responses')
    assert.deepEqual(llm.config.providers['ent-gateway-responses'].models[0].reasoningEfforts, { off: 'none', low: 'low', high: 'high' })
    assert.equal(llm.config.providers['ent-gateway-responses'].models[1].reasoningEfforts, undefined)
    assert.equal(doc.find((r) => r.id === 'other').config.keep, true, '用户已有行保留')
    assert.ok(doc.find((r) => r.id === 'llm-deepseek'), '官方屏蔽段已写')
    assert.ok(doc.find((r) => r.id === 'agent-default-model'), '默认模型行已写')

    // 幂等：重复同步不变
    const once = readFileSync(file, 'utf8')
    syncEnterpriseProfilePatches('http://gw:8900', patchModels)
    assert.equal(readFileSync(file, 'utf8'), once)

    // 登出清理：两个 provider 都移除，骨架保留
    clearEnterpriseProfilePatches()
    const cleared = JSON.parse(readFileSync(file, 'utf8'))
    const llmCleared = cleared.find((r) => r.id === 'llm-pi-ai')
    assert.equal(llmCleared.config.providers['ent-gateway'], undefined)
    assert.equal(llmCleared.config.providers['ent-gateway-responses'], undefined)
    assert.ok(cleared.find((r) => r.id === 'other'), '用户已有行保留')
  } finally {
    delete process.env.ENT_PATCH_FILE
  }
})

test('syncMainSettingsProvider：settings.yaml.imported 分支调用 dshHome 不抛错', () => {
  const home = join(process.env.DSH_HOME, 'dsh-home-imported')
  mkdirSync(home, { recursive: true })
  const imported = join(home, 'settings.yaml.imported')
  writeFileSync(imported, 'done', 'utf8')
  process.env.DSH_HOME = home
  const file = join(sandbox, 'cordis.patch.main.yaml')
  writeFileSync(file, JSON.stringify([{ id: 'other', config: { keep: true } }]), 'utf8')
  process.env.ENT_PATCH_FILE = file
  try {
    syncMainSettingsProvider('http://gw:8900', MODELS)
    const doc = JSON.parse(readFileSync(file, 'utf8'))
    const llm = doc.find((r) => r.id === 'llm-pi-ai')
    assert.ok(llm, 'llm-pi-ai 行已写入')
    assert.equal(llm.config.providers['ent-gateway'].api, 'openai-completions')
    assert.equal(llm.config.providers['ent-gateway-responses'].api, 'openai-responses')
    assert.ok(doc.find((r) => r.id === 'other').config.keep, '用户已有行保留')
  } finally {
    delete process.env.ENT_PATCH_FILE
    rmSync(imported, { force: true })
    process.env.DSH_HOME = sandbox
  }
})

test('清理沙箱', () => { rmSync(sandbox, { recursive: true, force: true }) })
