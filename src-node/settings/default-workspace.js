/**
 * 默认工作目录注册：全新 DSH_HOME 首次登录后，若本机存在默认工作目录且
 * workspace 列表为空（新装机，员工还没自己添加过），自动注册为默认工作区——
 * 员工登录后直接进工作目录，跳过"选择文件夹"首启步骤。
 * 目录存在但已有 workspace：不动（不覆盖员工自己的选择）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { writeTextAtomic } from '../shared/fs-utils.js'
import { dshHome } from '../shared/paths.js'
import { join } from 'node:path'
import { pluginLog } from '../shared/log.js'

/** 候选默认工作目录（按序取第一个存在的） */
const DEFAULT_WORKSPACE_DIRS = ['D:\\dsh-workspace', 'C:\\dsh-workspace']

export function ensureDefaultWorkspace() {
  try {
    const file = join(dshHome(), 'storages', 'workspace.json')
    if (!existsSync(file)) return // 存储服务尚未初始化：等下次登录/修复再试
    const j = JSON.parse(readFileSync(file, 'utf8'))
    const ids = j?.global?.workspaceIds ?? []
    if (ids.length) return // 员工已有工作区：绝不覆盖
    const dir = DEFAULT_WORKSPACE_DIRS.find((d) => existsSync(d))
    if (!dir) return // 本机没有默认目录：跳过（员工自行选择）
    const id = cryptoRandomId()
    j.global = j.global ?? {}
    j.global.initialized = true
    j.global.workspaceIds = [id]
    j.tables = j.tables ?? {}
    j.tables.workspaces = j.tables.workspaces ?? {}
    j.tables.workspaces[id] = {
      path: dir,
      title: dir.split('\\').filter(Boolean).pop() ?? dir,
      sessionIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    writeTextAtomic(file, JSON.stringify(j, null, 2))
    pluginLog(`已注册默认工作目录：${dir}（新装机首次登录自动设置）`)
  } catch (e) {
    pluginLog(`默认工作目录注册失败（不影响登录）: ${String(e?.message ?? e).slice(0, 120)}`)
  }
}

/** 无依赖随机 ID（workspace 记录主键，UUID v4 形态） */
function cryptoRandomId() {
  const h = '0123456789abcdef'
  let s = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-'
    else if (i === 14) s += '4'
    else if (i === 19) s += h[8 + Math.floor(Math.random() * 4)]
    else s += h[Math.floor(Math.random() * 16)]
  }
  return s
}
