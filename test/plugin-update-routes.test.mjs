/** 「更新」按钮的两条 HTTP 契约：market 里的 updateAvailable 判定 + plugin-update 的四道闸。
 *  离线：fetch 全假（策略、下载都走假源），宿主 CLI 在测试环境必然找不到，
 *  所以只断言「闸有没有拦住」，不测真实 pnpm 安装。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-upd-routes-'))
process.env.DSH_HOME = HOME
process.env.ENT_PROFILES_DIR = join(HOME, 'profiles')
mkdirSync(join(HOME, 'enterprise'), { recursive: true })
const PROFILE = join(HOME, 'profiles', 'desktop')
mkdirSync(PROFILE, { recursive: true })
const stateFile = join(HOME, 'enterprise', 'enterprise-state.json')

const putInstalled = (name, version) => {
  const dir = join(PROFILE, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }))
}
const writeProfile = (bundles) => writeFileSync(join(PROFILE, 'package.json'), JSON.stringify({ dsh: { profile: { bundles } } }))

// dsh-univer-office：在允许清单里但本机没装 —— 用来验证「更新」不会变成「安装」
const ALLOWED = ['dsh-enterprise', 'dsh-context', '@lemoncat7/dsh-knowledge', 'dsh-mnemon', 'dsh-univer-office']
// bundle 里必须含 dsh-enterprise：profile 定位器就是靠它认出「这是企业 profile」的
//（shared/profile.js hasEnterpriseBundle），漏掉它 findProfileRoot 会返回 null，
// 表现是「所有插件都显示未安装」——第一版测试就栽在这儿。
writeProfile(['dsh-enterprise', 'dsh-context', '@lemoncat7/dsh-knowledge', 'dsh-mnemon'])
putInstalled('dsh-context', '0.59.0')            // 仓库 0.60.0 → 可更新
putInstalled('@lemoncat7/dsh-knowledge', '2.10.1') // 仓库同为 2.10.1 → 不提示
putInstalled('dsh-mnemon', '0.5.18')             // 仓库 0.5.17（更低）→ 绝不提示降级
writeFileSync(stateFile, JSON.stringify({
  gateway: 'http://gw.test:8890',
  user: 'u',
  repoPluginLatest: { 'dsh-context': '0.60.0', '@lemoncat7/dsh-knowledge': '2.10.1', 'dsh-mnemon': '0.5.17' },
}))

const POLICY = { allowedPlugins: ALLOWED, pluginRegistry: { mode: 'off' } }
globalThis.fetch = async (url) => {
  if (String(url).includes('/policy/current')) return new Response(JSON.stringify(POLICY), { status: 200 })
  if (String(url).includes('/plugin-packages/')) return new Response(new Uint8Array(4096), { status: 200 })
  return new Response('{}', { status: 200 })
}

const { createRoutes } = await import('../src-node/web/routes.js')
const routes = createRoutes({ logger: { info() {}, warn() {} } })
const find = (path) => routes.find((r) => r.path === path)

const call = async (path, { body } = {}) => {
  const chunks = []
  const res = {
    writeHead(code, headers) { res.code = code; res.headers = headers },
    end(data) { if (data != null) chunks.push(String(data)) },
  }
  await find(path).handler({ res, body: body ?? {}, url: new URL('http://x' + path) })
  return { code: res.code, json: JSON.parse(chunks.join('') || '{}') }
}

test('market：只有「已装 + 仓库更高」才亮更新按钮，版本相同与仓库更低都不提示', async () => {
  const { json } = await call('/api/enterprise/market')
  const by = Object.fromEntries(json.items.map((x) => [x.name, x]))
  assert.equal(by['dsh-context'].updateAvailable, true)
  assert.equal(by['dsh-context'].installedVersion, '0.59.0')
  assert.equal(by['dsh-context'].repoVersion, '0.60.0')
  assert.equal(by['@lemoncat7/dsh-knowledge'].updateAvailable, false, '版本相同不算可更新')
  assert.equal(by['dsh-mnemon'].updateAvailable, false, '仓库版本更低时绝不提示（降级只能管理员做）')
  assert.equal(by['dsh-enterprise'].updateAvailable, false, '没装的插件不出现更新按钮（那是安装入口的事）')
})

test('plugin-update：允许清单外的插件直接 403', async () => {
  const { code, json } = await call('/api/enterprise/plugin-update', { body: { name: 'evil-plugin' } })
  assert.equal(code, 403)
  assert.match(json.error, /允许清单/)
})

test('plugin-update：没装的插件不能「更新」——更新不引入新插件', async () => {
  const { code, json } = await call('/api/enterprise/plugin-update', { body: { name: 'dsh-univer-office' } })
  assert.equal(code, 400)
  assert.match(json.error, /未在本机安装/)
})

test('plugin-update：仓库里没有版本信息时不要瞎装（等心跳或让管理员入库）', async () => {
  writeFileSync(stateFile, JSON.stringify({ gateway: 'http://gw.test:8890', repoPluginLatest: {} }))
  const { code, json } = await call('/api/enterprise/plugin-update', { body: { name: 'dsh-context' } })
  assert.equal(code, 400)
  assert.match(json.error, /版本信息/)
})

test('plugin-update：已是仓库版本时回 updated=false，不报错也不重装修', async () => {
  writeFileSync(stateFile, JSON.stringify({ gateway: 'http://gw.test:8890', repoPluginLatest: { 'dsh-context': '0.59.0' } }))
  const { code, json } = await call('/api/enterprise/plugin-update', { body: { name: 'dsh-context' } })
  assert.equal(code, 200)
  assert.equal(json.ok, true)
  assert.equal(json.updated, false)
})

test('plugin-update：缺 name 直接 400', async () => {
  const { code } = await call('/api/enterprise/plugin-update', { body: {} })
  assert.equal(code, 400)
})
