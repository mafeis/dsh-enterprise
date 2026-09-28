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

/** 返回当前可能的 profile 根目录；link 安装时依赖 DSH_PROFILE 或 DSH_HOME 扫描兜底。 */
export function findProfileRoots(moduleUrl = import.meta.url) {
  const moduleRoot = profileRootFromModule(moduleUrl)
  if (moduleRoot) return [moduleRoot]
  const active = activeProfileDir()
  if (active && readProfilePackage(active)) return [active]
  return enterpriseProfileDirs()
}

/** 返回最适合执行 profile 级操作的根目录；找不到返回 null。 */
export function findProfileRoot(moduleUrl = import.meta.url) {
  const active = activeProfileDir()
  if (active && readProfilePackage(active)) return active
  const roots = findProfileRoots(moduleUrl)
  return roots.find((dir) => hasEnterpriseBundle(readProfilePackage(dir))) ?? roots[0] ?? null
}
