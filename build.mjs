/**
 * dsh-enterprise 构建脚本（零依赖，Node 内置模块实现）
 *
 * 源码目录：
 *   src-node/    Node 半区（ESM，跑在 DSH 宿主进程）—— 原样复制到 lib/
 *   src-client/  浏览器半区（DSH __ModuleLoader__ 模块）—— 按文件名排序拼接成 lib/client.js
 *
 * 产物：
 *   lib/         安装目录（dsh plugin add file: 复制的就是它）—— 全部为构建产物，勿手改
 *
 * 约定：
 *   - 改代码只改 src-node/ 与 src-client/，改完跑 `node build.mjs`（或 pnpm --filter dsh-enterprise build）
 *   - src-client 拼接顺序 = 文件名字典序，用数字前缀控制（10- 20- … 99-）；
 *     各片段共享同一工厂作用域（与拆分前的单文件等价），新增面板按前缀插入即可
 *   - 构建自检：lib/index.js 做 ESM 导入冒烟；lib/client.js 做 node --check 语法解析
 */
import { cpSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const SRC_NODE = join(root, 'src-node')
const SRC_CLIENT = join(root, 'src-client')
const LIB = join(root, 'lib')

/* ---------- 1. 清空并重建 lib/ ---------- */

// 注意：本环境（Node 22.20 + Windows）cpSync/rmSync 递归会直接崩（0xC0000409），必须手动递归。
if (existsSync(LIB)) rmTree(LIB)
copyTree(SRC_NODE, LIB)
console.log(`[build] src-node/ → lib/（复制 ${countFiles(SRC_NODE)} 个文件）`)

/* ---------- 2. 拼接浏览器半区 ---------- */

const fragments = readdirSync(SRC_CLIENT).filter((f) => f.endsWith('.js')).sort()
if (!fragments.length) throw new Error('src-client/ 下没有任何片段')
let body = ''
for (const f of fragments) {
  const src = readTrimmed(join(SRC_CLIENT, f))
  body += (body ? '\n' : '') + src
  console.log(`[build]   + ${f} (${src.split('\n').length} 行)`)
}

const clientJs = `/**
 * DSH 企业版登录插件 · 浏览器半区
 * ⚠ 构建产物 —— 源码在 src-client/（按文件名前缀排序拼接），改这里会被下次构建覆盖。
 *
 * 1. 启动检测：未配置企业网关时弹全屏登录遮罩
 * 2. 设置面板：设置 → 企业管理（账号/模型/消耗/插件/规则 五个子页）
 *
 * 构建：node build.mjs
 */
window.__ModuleLoader__.load({
\tid: "dsh-enterprise",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;

\t\tlet react = require("react");
\t\tlet reactJsx = require("react/jsx-runtime");

\t\tconst inject = ["slots"];

${body}

\t\texports.apply = apply;
\t\texports.inject = inject;
\t\treturn module.exports;
\t}
});
`
writeFileSync(join(LIB, 'client.js'), clientJs, 'utf8')
console.log(`[build] src-client/ → lib/client.js（${fragments.length} 个片段）`)

/* ---------- 3. 构建自检 ---------- */

// 3a. Node 半区：ESM 导入冒烟（校验语法 + import 图，顶层无副作用可安全导入）
const entryUrl = pathToFileURL(join(LIB, 'index.js')).href
const smoke = spawnSync(process.execPath, [
  '-e',
  `import(${JSON.stringify(entryUrl)})` +
  `.then((m) => { if (m.name !== 'dsh-enterprise' || typeof m.apply !== 'function') throw new Error('bad exports'); console.log('[check] lib/index.js import ok') })` +
  `.catch((e) => { console.error(e); process.exit(1) })`,
], { cwd: root, encoding: 'utf8', timeout: 20000 })
if (smoke.status !== 0) {
  console.error(smoke.stdout, smoke.stderr)
  throw new Error('lib/index.js 导入冒烟失败')
}
if (smoke.stdout.trim()) console.log(smoke.stdout.trim())

// 3b. 浏览器半区：node --check 按 CommonJS 脚本解析（window/require 未定义没关系，只查语法）
const chk = spawnSync(process.execPath, ['--check', join(LIB, 'client.js')], { cwd: root, encoding: 'utf8' })
if (chk.status !== 0) {
  console.error(chk.stderr)
  throw new Error('lib/client.js 语法检查失败')
}
console.log('[check] lib/client.js 语法 ok')

console.log('[build] 完成 ✓')
process.exit(0)

/* ---------- helpers ---------- */

/** 手动递归删除（cpSync/rmSync 递归在本环境会崩，见文件头） */
function rmTree(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) rmTree(p)
    else unlinkSync(p)
  }
  try { rmSync(dir) } catch { /* 目录已空，rmdir 兜底 */ }
}

/** 手动递归复制 */
function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const f of readdirSync(src)) {
    const p = join(src, f)
    if (statSync(p).isDirectory()) copyTree(p, join(dest, f))
    else copyFileSync(p, join(dest, f))
  }
}

function countFiles(dir) {
  let n = 0
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) n += countFiles(p)
    else if (f.endsWith('.js')) n++
  }
  return n
}

/** 读文件并去掉首尾空行（片段拼接时的统一间隔由包装模板控制） */
function readTrimmed(path) {
  if (!existsSync(path)) throw new Error(`片段缺失: ${relative(root, path)}`)
  return readFileSync(path, 'utf8').replace(/^\s*\n/, '').replace(/\n\s*$/, '')
}
