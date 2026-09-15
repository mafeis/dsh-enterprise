/** 文件读写工具：原子写 + 宽容 JSON 读 */
import { readFileSync, writeFileSync, renameSync, existsSync, statSync, chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** atomic write: 写临时文件后 rename，防中途损坏。
 *  POSIX 红线：目标文件已存在时必须继承其权限位——.credentials.yaml 是 600，
 *  临时文件按 umask 落成 644，rename 后宿主 credentials-local 会因
 *  "readable beyond its owner" 拒绝加载，整个插件树起不来（Mac 实测）。
 *  目标目录不存在时自动创建（全新 DSH_HOME 首次登录：enterprise/ 尚未生成，
 *  writeTextAtomic 直接 ENOENT——新装机登录必炸，ent3 实测）。
 */
export function writeTextAtomic(path, text) {
  const dir = dirname(path)
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }) } catch { /* 并发创建竞态：rename 阶段再报真实错误 */ }
  }
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, text, 'utf8')
  if (process.platform !== 'win32' && existsSync(path)) {
    try { chmodSync(tmp, statSync(path).mode & 0o777) } catch { /* 权限继承失败不阻塞写入 */ }
  }
  renameSync(tmp, path)
}

/** 读 JSON：容忍 BOM 与 // 注释；任何失败返回 null（调用方按缺省处理） */
export function readJsonSafe(path) {
  try {
    const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').replace(/^\s*\/\/.*$/gm, '')
    return JSON.parse(raw)
  } catch {
    return null
  }
}
