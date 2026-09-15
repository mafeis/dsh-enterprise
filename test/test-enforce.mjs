/**
 * 一次性冒烟测试：验证 enforcePluginAllowlist 端到端行为。
 *  造一个假 profile（含 3 个 bundle：自身 + 2 个清单外插件）+ 假网关（/policy/current 下发清单），
 *  跑一次清理，断言：清单外的两个从 bundles/dependencies 移除、目录删除、自身保留。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, unlinkSync, rmdirSync, copyFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 本环境（Node 22.20 + Windows）cpSync/rmSync 递归会快崩（0xC0000409），手动递归替代 */
function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const f of readdirSync(src)) {
    const s = join(src, f); const d = join(dest, f)
    if (statSync(s).isDirectory()) copyTree(s, d)
    else copyFileSync(s, d)
  }
}
function rmTree(p) {
  let st; try { st = lstatSync(p) } catch { return }
  if (!st.isDirectory() || st.isSymbolicLink()) { unlinkSync(p); return }
  for (const f of readdirSync(p)) rmTree(join(p, f))
  rmdirSync(p)
}

const tmp = join(process.cwd(), '.test-enforce-tmp')
rmTree(tmp)

// 1. 假网关：允许清单不含 @vlln/dsh-navbar / dsh-mnemon
const gw = createServer((req, res) => {
  if (req.url === '/policy/current') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      version: '1.0.0',
      allowedPlugins: ['dsh-enterprise', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-hot-reload'],
    }))
  } else { res.writeHead(404); res.end() }
})
await new Promise((r) => gw.listen(0, '127.0.0.1', r))
const port = gw.address().port

// 2. 假 profile：node_modules/dsh-enterprise 放构建产物（模块自身位置决定 findProfileRoot）
const profile = join(tmp, 'profile')
const entDir = join(profile, 'node_modules', 'dsh-enterprise')
mkdirSync(join(entDir, 'lib'), { recursive: true })
copyTree(join(process.cwd(), 'lib'), entDir)
writeFileSync(join(profile, 'package.json'), JSON.stringify({
  name: 'profile-root',
  dsh: { profile: { bundles: ['dsh-enterprise', '@vlln/dsh-navbar', 'dsh-mnemon'] } },
  dependencies: { 'dsh-enterprise': '^1.0.0', '@vlln/dsh-navbar': '^1.0.0', 'dsh-mnemon': '^1.0.0' },
}, null, 2))
for (const n of ['@vlln/dsh-navbar', 'dsh-mnemon', '@deepseek-ai/dsh-base']) {
  const d = join(profile, 'node_modules', ...n.split('/'))
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: n, version: '0.0.1' }))
}
// 3. 假 DSH home：状态文件指向假网关
const home = join(tmp, 'home')
mkdirSync(join(home, 'enterprise'), { recursive: true })
writeFileSync(join(home, 'enterprise', 'enterprise-state.json'), JSON.stringify({ gateway: `http://127.0.0.1:${port}` }))

// 4. 以 DSH_HOME=home 从假 profile 里 import 插件模块，执行清理
process.env.DSH_HOME = home
const mod = await import(pathToFileURL(join(entDir, 'enforce', 'plugin-enforce.js')).href)
const r1 = await mod.enforcePluginAllowlist('manual')

// 5. 断言
const pkg = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
const fails = []
const expectBundles = ['dsh-enterprise']
if (JSON.stringify(pkg.dsh.profile.bundles) !== JSON.stringify(expectBundles)) fails.push(`bundles=${JSON.stringify(pkg.dsh.profile.bundles)}`)
if (Object.keys(pkg.dependencies).join() !== 'dsh-enterprise') fails.push(`deps=${Object.keys(pkg.dependencies).join()}`)
for (const gone of ['@vlln/dsh-navbar', 'dsh-mnemon']) {
  if (existsSync(join(profile, 'node_modules', ...gone.split('/')))) fails.push(`${gone} 目录未删除`)
}
if (!existsSync(join(profile, 'node_modules', '@deepseek-ai/dsh-base/package.json'))) fails.push('清单内插件目录被误删')
if (!r1.ok || r1.removed?.length !== 2) fails.push(`removed=${JSON.stringify(r1.removed)}`)

// 6. 幂等：再跑一次应为空操作
const r2 = await mod.enforcePluginAllowlist('manual')
if (!r2.ok || r2.removed?.length !== 0) fails.push(`幂等失败: ${JSON.stringify(r2)}`)

gw.close()
rmTree(tmp)
if (fails.length) { console.error('FAIL\n' + fails.join('\n')); process.exit(1) }
console.log(`PASS — 清理 ${r1.removed.map((x) => x.name).join('、')}；配置与实体均已移除；保护名单与清单内插件完好；二次执行为空操作`)
