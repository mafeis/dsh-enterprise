import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 登出清场对主 settings.yaml 的改写：三种形态 + 幂等（2026-09-18 Mac 重复键事故回归） */

function withHome(t, files) {
  const home = mkdtempSync(join(tmpdir(), 'ent-logout-'))
  t.after(() => { try { rmSync(home, { recursive: true, force: true }) } catch {} })
  mkdirSync(join(home, 'enterprise'), { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const p = join(home, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, content)
  }
  process.env.DSH_HOME = home
  return home
}

async function freshLogout() {
  return (await import(`../src-node/auth/logout.js?${Date.now()}`)).logoutLocal
}

test('logout：llm-deepseek 紧跟 llm-pi-ai 段后 → 块头不被吞、不产生重复 models 键', async (t) => {
  const home = withHome(t, {
    'settings.yaml': [
      'ui-onboarding:',
      '  welcomeNoticeVersion: "2026-08-13.1"',
      '',
      'llm-pi-ai:',
      '  providers:',
      '    ent-gateway:',
      '      displayName: 企业统一模型网关',
      '      apiKeyEnv: ENT_GATEWAY_TOKEN_V2',
      '      api: openai-completions',
      '      baseURL: http://old:8899/v1',
      '      models:',
      '        - id: m1',
      'llm-deepseek:',
      '  models: []',
      '',
    ].join('\n'),
    'enterprise/enterprise-settings.yaml': '{}',
    '.credentials.yaml': 'version: 1\nrefs:\n  ENT_GATEWAY_TOKEN: xxx\n',
  })
  const logoutLocal = await freshLogout()
  logoutLocal('测试')
  const out = readFileSync(join(home, 'settings.yaml'), 'utf8')
  assert.equal((out.match(/^llm-deepseek:$/m) ?? []).length, 1, 'llm-deepseek 块头只能有一个')
  assert.equal((out.match(/^\s+models: \[\]$/m) ?? []).length, 1, 'models: [] 只能有一个')
  assert.match(out, /llm-pi-ai:\n  providers: \{\}\nllm-deepseek:\n  models: \[\]/, 'providers 折叠且屏蔽段保留')
  assert.doesNotMatch(out, /ent-gateway/, 'ent-gateway 块已移除')
})

test('logout：重复执行幂等，不叠加 llm-deepseek', async (t) => {
  const home = withHome(t, {
    'settings.yaml': 'llm-pi-ai:\n  providers:\n    ent-gateway:\n      models:\n        - id: m1\nllm-deepseek:\n  models: []\n',
    'enterprise/enterprise-settings.yaml': '{}',
    '.credentials.yaml': '',
  })
  const logoutLocal = await freshLogout()
  logoutLocal('测试一')
  const once = readFileSync(join(home, 'settings.yaml'), 'utf8')
  logoutLocal('测试二')
  const twice = readFileSync(join(home, 'settings.yaml'), 'utf8')
  assert.equal(twice, once, '第二次登出不再改动')
})

test('logout：内联 providers: {} 形态 + 屏蔽段缺失 → 补一次且仅一次', async (t) => {
  const home = withHome(t, {
    'settings.yaml': 'llm-pi-ai:\n  providers: {}\n',
    'enterprise/enterprise-settings.yaml': '{}',
    '.credentials.yaml': '',
  })
  const logoutLocal = await freshLogout()
  logoutLocal('测试')
  const out = readFileSync(join(home, 'settings.yaml'), 'utf8')
  assert.equal((out.match(/^llm-deepseek:$/m) ?? []).length, 1)
  assert.equal((out.match(/^\s+models: \[\]$/m) ?? []).length, 1)
})
