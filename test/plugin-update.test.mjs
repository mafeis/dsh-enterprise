/** 「更新」按钮的服务端半区：已装版本回读 + 企业仓库下载 URL + 待重启汇总。
 *  离线跑：不发真实请求，宿主 CLI 也找不到（runPluginCli 自己返回失败），
 *  所以断言只看「发给网关的 URL 对不对」「包落到哪儿」「状态怎么记」。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-upd-test-'))
process.env.DSH_HOME = HOME
process.env.ENT_PROFILES_DIR = join(HOME, 'profiles')
mkdirSync(join(HOME, 'enterprise'), { recursive: true })

const PROFILE = join(HOME, 'profiles', 'desktop')
const WEB_PROFILE = join(HOME, 'profiles', 'web')
mkdirSync(PROFILE, { recursive: true })
mkdirSync(WEB_PROFILE, { recursive: true })
writeFileSync(join(PROFILE, 'package.json'), JSON.stringify({
  dsh: { profile: { bundles: ['dsh-enterprise', 'dsh-context', '@lemoncat7/dsh-knowledge'] } },
}))
writeFileSync(join(WEB_PROFILE, 'package.json'), JSON.stringify({
  dsh: { profile: { bundles: ['dsh-enterprise'] } },
}))
// 记账按 profile 分档：本测试进程的「当前档位」固定为 desktop（activeProfileDir 认绝对路径）
process.env.DSH_PROFILE = PROFILE
const putPkg = (name, version) => {
  const dir = join(PROFILE, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }))
}
putPkg('dsh-context', '0.59.0')
putPkg('@lemoncat7/dsh-knowledge', '2.10.1')

const stateFile = join(HOME, 'enterprise', 'enterprise-state.json')
const writeState = (obj) => writeFileSync(stateFile, JSON.stringify(obj))
writeState({ gateway: 'http://gw.test:8890/' })

const { readInstalledVersions } = await import('../src-node/update/installed-versions.js')
const { installFromRepo, notePluginUpdateInstalled, pendingUpdates, pendingUpdateRestart, compareSemver, updateScope } = await import('../src-node/update/self-update.js')
assert.equal(updateScope(), PROFILE, '作用域 = 当前 profile 根目录（去尾分隔符）')

test('readInstalledVersions：scoped 包按段拼路径，没装的不收录', () => {
  const v = readInstalledVersions(['dsh-context', '@lemoncat7/dsh-knowledge', 'dsh-mnemon', ''])
  assert.deepEqual(v, { 'dsh-context': '0.59.0', '@lemoncat7/dsh-knowledge': '2.10.1' })
})

test('readInstalledVersions：拒绝路径穿越，不吃 ../', () => {
  const v = readInstalledVersions(['../../etc', 'dsh-context/../x', 'dsh-context'])
  assert.deepEqual(v, { 'dsh-context': '0.59.0' })
})

test('installFromRepo：scoped 包名逐段转义后拼 URL，且 @ 必须编码', async () => {
  const seen = []
  const orig = globalThis.fetch
  globalThis.fetch = async (url) => {
    seen.push(String(url))
    return new Response(new Uint8Array(4096), { status: 200 })
  }
  try {
    const r = await installFromRepo('@lemoncat7/dsh-knowledge', '2.10.2')
    assert.equal(seen[0], 'http://gw.test:8890/plugin-packages/%40lemoncat7/dsh-knowledge/2.10.2')
    // 测试环境没有宿主 DSH Desktop，安装这步必然失败——但下载与落盘必须已经发生
    assert.equal(r.ok, false)
    const tgz = join(PROFILE, '.ent-plugin-cache', '@lemoncat7-dsh-knowledge-2.10.2.tgz')
    assert.ok(existsSync(tgz), 'tgz 应落到 profile 内的 .ent-plugin-cache')
    assert.equal(statSync(tgz).size, 4096)
  } finally { globalThis.fetch = orig }
})

test('installFromRepo：下载失败时报出包名与版本（否则用户只看到一句"更新失败"）', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = async () => new Response('nope', { status: 404 })
  try {
    const r = await installFromRepo('dsh-context', '0.60.0')
    assert.equal(r.ok, false)
    assert.match(String(r.error), /HTTP 404/)
    assert.match(String(r.error), /dsh-context@0\.60\.0/)
  } finally { globalThis.fetch = orig }
})

test('installFromRepo：网关地址为空时不发请求', async () => {
  writeState({ gateway: '' })
  let called = 0
  const orig = globalThis.fetch
  globalThis.fetch = async () => { called++; return new Response('', { status: 200 }) }
  try {
    const r = await installFromRepo('dsh-context', '0.60.0')
    assert.equal(r.ok, false)
    assert.equal(called, 0)
  } finally { globalThis.fetch = orig; writeState({ gateway: 'http://gw.test:8890' }) }
})

test('pendingUpdates：只报本 profile 本次进程启动之后装好的，本插件自身只出现一次', () => {
  writeState({
    gateway: 'http://gw.test:8890',
    selfUpdateByProfile: {
      [PROFILE]: { installedVersion: '0.9.19', installedAt: new Date().toISOString() },
      [WEB_PROFILE]: { installedVersion: '0.9.19', installedAt: new Date().toISOString() },
    },
    pluginUpdatesByProfile: {
      [PROFILE]: {
        'dsh-context': { version: '0.60.0', at: new Date().toISOString() },
        'dsh-mnemon': { version: '0.5.17', at: '2000-01-01T00:00:00.000Z' },   // 上个进程时代的记录
        'dsh-enterprise': { version: '0.9.19', at: new Date().toISOString() },  // 与 selfUpdate 重复
      },
    },
  })
  const list = pendingUpdates()
  assert.deepEqual(list, [
    { name: 'dsh-enterprise', version: '0.9.19' },
    { name: 'dsh-context', version: '0.60.0' },
  ])
})

test('多实例隔离：账记在别的 profile 上时，本 profile 不能弹「已更新，重启后生效」（0.9.19 事故）', () => {
  // 先跑心跳的 web 实例把包装进自己档位并写了全局账 → desktop 档位其实还是旧版
  writeState({
    gateway: 'http://gw.test:8890',
    selfUpdate: { attemptedVersion: '0.9.19', attemptedAt: new Date().toISOString(), installedVersion: '0.9.19', installedAt: new Date().toISOString() },
    selfUpdateByProfile: { [WEB_PROFILE]: { installedVersion: '0.9.19', installedAt: new Date().toISOString() } },
    pluginUpdatesByProfile: { [WEB_PROFILE]: { 'dsh-context': { version: '0.60.0', at: new Date().toISOString() } } },
  })
  assert.deepEqual(pendingUpdates(), [], '别的档位的更新不该显示在本档位')
  assert.equal(pendingUpdateRestart(), null, '更不能谎报「本档位已更新到 x，重启后生效」')
})

test('notePluginUpdateInstalled：按 profile + 包名累计，不覆盖别人（含别的档位）的记录', () => {
  writeState({
    gateway: 'http://gw.test:8890',
    pluginUpdatesByProfile: {
      [PROFILE]: { 'dsh-context': { version: '0.60.0', at: 'x' } },
      [WEB_PROFILE]: { 'dsh-mnemon': { version: '0.5.17', at: 'x' } },
    },
  })
  notePluginUpdateInstalled('@xmanrui/dsh-im', '4.30.0')
  const s = JSON.parse(readFileSync(stateFile, 'utf8'))
  assert.ok(s.pluginUpdatesByProfile[PROFILE]['dsh-context'], '本档位原有记录要在')
  assert.equal(s.pluginUpdatesByProfile[PROFILE]['@xmanrui/dsh-im'].version, '4.30.0')
  assert.equal(s.pluginUpdatesByProfile[WEB_PROFILE]['dsh-mnemon'].version, '0.5.17', '别的档位不受影响')
})

test('compareSemver：仓库版本相等时不能出现更新按钮（预发布号也按低版本算）', () => {
  assert.equal(compareSemver('0.9.18', '0.9.18'), 0)
  assert.equal(compareSemver('0.9.18', '0.9.19'), -1)
  assert.equal(compareSemver('4.30.0', '4.29.0'), 1)
  assert.equal(compareSemver('0.0.1-rc.1', '0.0.1'), -1)
})
