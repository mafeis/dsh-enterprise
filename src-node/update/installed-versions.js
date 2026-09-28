/** 读本机各插件的已装版本 —— 「更新」按钮要比的就是这两个数：仓库默认版本 vs 本机已装版本。
 *
 * 已装清单（bundle 名）来自 profile manifest 的 dsh.profile.bundles，但那里**不带版本号**；
 * 真实版本只能回读 node_modules/<name>/package.json。scoped 包按 '/' 逐段拼
 * （join(...name.split('/'))），硬编码分隔符会让 @scope 包永远读不到。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findProfileRoot } from '../policy/policy.js'

/** 返回 { [包名]: 版本 }；读不到的包**不收录**（与「读到但版本为空」区分开）。
 *  profile 定位失败返回 null —— 调用方据此知道「不知道」而不是「都没装」。 */
export function readInstalledVersions(names) {
  const root = findProfileRoot()
  if (!root) return null
  const out = {}
  for (const raw of names ?? []) {
    const name = String(raw ?? '').trim()
    if (!name || name.includes('..')) continue
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'node_modules', ...name.split('/'), 'package.json'), 'utf8'))
      const v = String(pkg?.version ?? '').trim()
      if (v) out[name] = v
    } catch { /* 未安装 / 非 profile 形态 / 目录不完整：不收录 */ }
  }
  return out
}
