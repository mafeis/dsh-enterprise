/** DSH profile 定位。
 *
 * 官方 0.1.7 起，profile 级 cordis.patch.yml 是权威配置面；企业插件必须能在
 * link:/file: 安装形态下也找到当前 profile。Node 默认会把 symlink 解析成真实路径，
 * 因此仅靠 import.meta.url 向上走，在本地 `dsh plugin add /path`（link:）时会走到
 * 仓库目录而不是 ~/.dsh/profiles/<name>。
 *
 * 解析顺序：模块所在 profile（正式包安装）→ DSH_PROFILE（运行态）→
 * DSH_HOME/profiles 下声明了 dsh-enterprise 的 profile（本地 link 兜底）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshHome } from './paths.js'

function readProfilePackage(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg : null
  } catch {
    return null
  }
}

function hasEnterpriseBundle(pkg) {
  const bundles = pkg?.dsh?.profile?.bundles
  return Array.isArray(bundles) && bundles.includes('dsh-enterprise')
}

function profileRootFromModule(moduleUrl) {
  try {
    let url = new URL('.', moduleUrl)
    for (let i = 0; i < 8; i++) {
      url = new URL('../', url)
      const dir = fileURLToPath(url)
      if (readProfilePackage(dir)) return dir
    }
  } catch { /* ignore */ }
  return null
}

function profilesDir() {
  return process.env.ENT_PROFILES_DIR ?? join(dshHome(), 'profiles')
}

function profileNameFromArgv() {
  const argv = process.argv.slice(2)
  const pIdx = argv.indexOf('--profile')
  if (pIdx !== -1 && argv[pIdx + 1]) return String(argv[pIdx + 1]).trim()
  // `dsh web` / `dsh tui`：第一个非选项参数就是 profile 名。
  for (const arg of argv) {
    if (!arg || arg.startsWith('-')) continue
    if (readProfilePackage(join(profilesDir(), arg))) return arg
  }
  return ''
}

function activeProfileDir() {
  const name = String(process.env.DSH_PROFILE ?? profileNameFromArgv()).trim()
  if (!name) return null
  return /[\\/]/.test(name) ? name : join(profilesDir(), name)
}

function enterpriseProfileDirs() {
  const root = profilesDir()
  if (!existsSync(root)) return []
  const out = []
  try {
    for (const name of readdirSync(root)) {
      const dir = join(root, name)
      const pkg = readProfilePackage(dir)
      if (hasEnterpriseBundle(pkg)) out.push(dir)
    }
  } catch { /* ignore */ }
  return out
}

/** 返回当前**全部**可能的 profile 根目录（去重，插件所在 profile 排最前）。
 *
 *  这里以前是「命中即返回」：`moduleRoot` 一旦解析成功就只返回它，于是从已安装包
 *  （…/profiles/desktop/node_modules/dsh-enterprise/lib/…）导入时，枚举永远只剩 desktop
 *  一个 profile —— 同机其它装着本插件的 profile（web / ent / headless…）不会被同步。
 *  实测代价：web profile 的 cordis.patch.yml 停在 `openai-responses` 近 20 小时，
 *  用户在别的 profile 里「切了协议没生效」就是这么来的。
 *
 *  四路全部并入并去重：插件所在 profile → 当前激活 profile → 所有声明企业包的 profile。
 *  顺序有意义：老调用方的 `roots[0]` 仍是插件所在/激活 profile，行为只增不减。 */
export function findProfileRoots(moduleUrl = import.meta.url) {
  const out = []
  const push = (dir) => {
    if (!dir) return
    const normalized = String(dir).replace(/[\\/]+$/, '')
    if (!normalized || out.includes(normalized)) return
    out.push(normalized)
  }
  push(profileRootFromModule(moduleUrl))
  const active = activeProfileDir()
  if (active && readProfilePackage(active)) push(active)
  for (const dir of enterpriseProfileDirs()) push(dir)
  return out
}

/** 返回最适合执行 profile 级操作的根目录；找不到返回 null。 */
export function findProfileRoot(moduleUrl = import.meta.url) {
  const active = activeProfileDir()
  if (active && readProfilePackage(active)) return active
  const roots = findProfileRoots(moduleUrl)
  return roots.find((dir) => hasEnterpriseBundle(readProfilePackage(dir))) ?? roots[0] ?? null
}
