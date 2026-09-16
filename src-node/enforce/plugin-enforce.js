/**
 * 插件管控强制执行：启动 / 心跳时自动清理「允许清单之外」的插件。
 *
 *  - 管控口径：网关 /policy/current 的 allowedPlugins 非空 = 启用管控；空 = 不限制（不动本机）
 *  - 清理动作（两层）：
 *      ① 配置层（权威）：从 profile package.json 的 dsh.profile.bundles 与 dependencies
 *         移除该插件——下次 DSH 启动不再加载，这是"清理生效"的根本；
 *      ② 实体层（尽力，仅在 ① 成功后执行）：删除 profile node_modules/<name> 目录。
 *         运行中文件可能被宿主占用导致删除失败，仅记录不阻断——配置层已清，
 *         重启后 bundle 不再解析。① 失败时绝不删实体（否则 manifest 引用已消失的
 *         包，重启后 bundle 解析失败），留待下一轮管控重试。
 *  - 并发防护：
 *      · enforcing 标志互斥多次管控本身；
 *      · manifestOp 互斥（claimManifestOp/releaseManifestOp）：本模块与 web 路由的
 *        plugin-install（dsh plugin add → pnpm）都会读改写 profile package.json，
 *        进程内二选一串行执行，防止「pnpm 用旧快照写回复活条目」/「丢失更新」；
 *      · 每次写 manifest 后复核、删实体后再复核（防复活自愈）。员工绕过 DSH 在
 *        shell 里手动 pnpm 仍是残余风险（进程间无锁），靠下一轮管控兜底。
 *  - 保护名单：本插件自身 + DSH 必装组件。管理员漏配清单时也不清，避免"自断管控"或
 *    砸掉宿主；此时记录日志提醒管理员把保护项加入管理台允许清单（否则心跳持续告警）。
 *  - 触发点：插件启动 4s 后（index.js）+ 心跳收到网关 pluginViolations 时（heartbeat.js）。
 *  - 清理完成后重置设备信息缓存，下一拍心跳即带更新后的插件清单，
 *    网关侧违规判定随之清零（否则旧快照会导致每拍心跳都重复告警）。
 */
import { readdirSync, lstatSync, unlinkSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { readJsonSafe, writeTextAtomic } from '../shared/fs-utils.js'
import { pluginLog } from '../shared/log.js'
import { collectInstalledPlugins, resetDeviceInfoCache } from '../device/device-info.js'
import { fetchPolicySnapshot, findProfileRoot } from '../policy/policy.js'
import { readState, saveState } from '../state/state.js'

/** 保护名单：即使不在允许清单内也绝不清理。
 *  - dsh-enterprise           本插件自身（清掉等于关掉管控）
 *  - @deepseek-ai/dsh-base    DSH 宿主基础组件（必装，文档口径）
 *  - @deepseek-ai/dsh-web-app DSH Web 图形界面（必装，文档口径）
 */
export const PROTECTED_PLUGINS = Object.freeze([
  'dsh-enterprise',
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
])

/** ============ manifest 互斥（与 plugin-install 路由共享） ============ */
let manifestBusy = false
/** 尝试占用 manifest 写权。false = 已有别的读改写在进行（管控或安装），调用方本轮放弃 */
export function claimManifestOp() {
  if (manifestBusy) return false
  manifestBusy = true
  return true
}
export function releaseManifestOp() { manifestBusy = false }

let enforcing = false

/** 本模块是否正在执行清理（plugin-install 路由据此拒绝并发安装） */
export function isEnforceBusy() { return enforcing }

/**
 * 从 profile manifest 移除一个 bundle（bundles + dependencies，原子写）。
 * @returns {'removed'|'absent'|'error'} removed=本次移除；absent=本来就没有；error=读失败/写失败
 */
function removeManifestEntry(profileDir, name) {
  try {
    const pkgPath = join(profileDir, 'package.json')
    const pkg = readJsonSafe(pkgPath)
    if (!pkg) return 'error'
    const before = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : []
    const after = before.filter((b) => b !== name)
    if (after.length !== before.length) {
      pkg.dsh.profile.bundles = after
      if (pkg.dependencies && Object.prototype.hasOwnProperty.call(pkg.dependencies, name)) {
        delete pkg.dependencies[name]
      }
      writeTextAtomic(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
      return 'removed'
    }
    return 'absent'
  } catch {
    return 'error'
  }
}

/**
 * 手动递归删除目录（勿改回 rmSync recursive）：
 * 本环境（Node 22.20 + Windows）rmSync/cpSync 递归会直接快崩（0xC0000409，
 * 见 build.mjs 同款注释），宿主进程内绝不能用。junction/symlink 只摘链接不动实体。
 * @returns {boolean} true=删除成功（或本就不存在）
 */
function rmTreeSafe(dir) {
  try {
    let st
    try { st = lstatSync(dir) } catch { return true } // 不存在 = 已干净
    if (!st.isDirectory() || st.isSymbolicLink()) { unlinkSync(dir); return true }
    for (const f of readdirSync(dir)) rmTreeSafe(join(dir, f))
    rmdirSync(dir)
    return true
  } catch { return false }
}

/** node_modules 实体路径（用 split('/') 让 join 按平台拼分隔符，scoped 包在 POSIX 也能删） */
function pluginEntityPath(profileDir, name) {
  return join(profileDir, 'node_modules', ...name.split('/'))
}

/** 实体删除重试队列的状态键：manifest 已清但目录被占用时记入，每轮管控重试直到删净 */
const PENDING_KEY = 'pendingPluginEntityDelete'
const CLEANUP_KEY = 'lastPluginCleanup'

/**
 * 重试上轮没删掉的实体目录（文件被宿主占用是暂态，心跳节奏重试通常几拍内删净）。
 * 删净的从队列移除；队列空了清掉状态键。
 */
export function retryPendingEntities(profileDir) {
  const state = readState()
  const pending = Array.isArray(state?.[PENDING_KEY]) ? state[PENDING_KEY] : []
  if (!pending.length) return
  const remaining = []
  for (const name of pending) {
    const ok = profileDir ? rmTreeSafe(pluginEntityPath(profileDir, name)) : false
    if (ok) pluginLog(`[enterprise] 插件管控：「${name}」的残留目录已删除（此前被占用）`)
    else remaining.push(name)
  }
  saveState(remaining.length ? { [PENDING_KEY]: remaining } : { [PENDING_KEY]: null })
}

/** 心跳用轻量入口：队列空时只读一次状态即返回，不为空才找 profile 重试 */
export function retryPendingPluginEntities() {
  const pending = readState()?.[PENDING_KEY]
  if (!Array.isArray(pending) || !pending.length) return
  retryPendingEntities(findProfileRoot())
}

/** 记录本次清理（员工端面板据此提示「重启 DSH 后完全生效」）+ 登记删除失败的重试队列 */
function recordCleanup(removed, profileDir) {
  const entitiesFailed = removed.filter((r) => r.configOk && !r.entityOk).map((r) => r.name)
  const patch = {
    [CLEANUP_KEY]: { names: removed.map((r) => r.name), at: new Date().toISOString() },
  }
  const state = readState()
  const prevPending = Array.isArray(state?.[PENDING_KEY]) ? state[PENDING_KEY] : []
  const merged = [...new Set([...prevPending, ...entitiesFailed])]
  patch[PENDING_KEY] = merged.length ? merged : null
  saveState(patch)
}

/**
 * 执行一次允许清单对账。处置档位由网关策略 pluginEnforce 决定：
 *   enforce = 发现清单外插件立即清理（原行为）
 *   warn    = 仅记日志警告，不动本机
 *   off     = 不限制，仅记录（心跳/出现史在网关侧照常落库）
 * @param {'startup'|'heartbeat'|'manual'} trigger 触发来源（仅用于日志）
 * @returns {Promise<{ok:boolean, skipped?:string, removed?:Array<{name:string,configOk:boolean,entityOk:boolean}>, protectedMissing?:string[]}>}
 */
export async function enforcePluginAllowlist(trigger = 'startup') {
  if (enforcing) return { ok: false, skipped: 'busy' }
  enforcing = true
  try {
    const policy = await fetchPolicySnapshot()
    const allowed = Array.isArray(policy?.allowedPlugins) ? policy.allowedPlugins : []
    if (!allowed.length) return { ok: true, skipped: 'allowlist-empty' } // 空 = 不限制
    const installed = collectInstalledPlugins()
    if (!installed) return { ok: true, skipped: 'installed-unknown' } // 非 profile 形态，无法对账

    const violations = installed.filter((x) => !allowed.includes(x) && !PROTECTED_PLUGINS.includes(x))
    // 档位分流：warn/off 不清理本机（off/warn 都只走日志；员工端面板警告与否由 status 的 enforceMode 控制）
    const mode = policy?.pluginEnforce ?? 'enforce'
    if (violations.length && mode !== 'enforce') {
      pluginLog(`[enterprise] 插件管控（档位 ${mode}）：清单外插件 ${violations.join('、')} —— ${mode === 'warn' ? '仅警告不处理' : '不限制仅记录'}`)
      return { ok: true, skipped: 'mode-' + mode, protectedMissing: [] }
    }

    // 先重试上轮被占用没删掉的残留实体（与本次违规无关，也照删）
    const profileDirEarly = findProfileRoot()
    if (profileDirEarly) retryPendingEntities(profileDirEarly)

    // 保护名单不在清单内：保留并提醒管理员补清单（不清理）
    const protectedMissing = PROTECTED_PLUGINS.filter((p) => installed.includes(p) && !allowed.includes(p))
    if (protectedMissing.length) {
      pluginLog(`[enterprise] 插件管控：保护名单 ${protectedMissing.join('、')} 不在允许清单内，已保留（请在管理台允许清单中补上，否则心跳将持续告警）`)
    }

    if (!violations.length) return { ok: true, removed: [], protectedMissing }

    // manifest 写权与 plugin-install 互斥：拿不到就整轮跳过（下轮心跳/启动再试）
    if (!claimManifestOp()) return { ok: false, skipped: 'manifest-busy' }
    try {
      const profileDir = findProfileRoot()
      const removed = []
      for (const name of violations) {
        // ① 配置层：移除 manifest 条目；写完再复核一次——pnpm 可能用读取于我们写入
        //    前的旧快照把条目写回（复活），复核时发现就再移除。以最后一次读取结论为准。
        let configOk = false
        if (profileDir) {
          const first = removeManifestEntry(profileDir, name)
          if (first !== 'error') {
            const recheck = removeManifestEntry(profileDir, name)
            configOk = recheck !== 'error'
            if (recheck === 'removed') {
              pluginLog(`[enterprise] 插件管控：「${name}」的 manifest 条目被并发安装写回，已再次移除`)
            }
          }
        }
        if (!configOk) {
          pluginLog(`[enterprise] 插件管控：清理「${name}」manifest 未成功（触发: ${trigger}），本轮不删实体，下轮重试`)
          removed.push({ name, configOk, entityOk: false })
          continue
        }

        // ② 实体层（仅在配置层确认已清后）：尽力删 node_modules 目录（带重试：
        //    pnpm 装出的目录常被锁，几百 ms 内通常就松开了）
        let entityOk = false
        if (profileDir) {
          const entityPath = pluginEntityPath(profileDir, name)
          entityOk = rmTreeSafe(entityPath)
          for (let i = 0; i < 3 && !entityOk; i++) {
            await new Promise((r) => setTimeout(r, 300))
            entityOk = rmTreeSafe(entityPath)
          }
        }

        // ②½ 自愈：实体已删后再复核 manifest——若条目又被并发安装写回，立刻再移除，
        //    避免「manifest 引用已删实体」的启动损坏状态跨轮存活。
        if (profileDir) {
          const heal = removeManifestEntry(profileDir, name)
          if (heal === 'removed') {
            pluginLog(`[enterprise] 插件管控：「${name}」的 manifest 条目在实体删除后又被并发写回，已再次移除`)
          }
        }

        removed.push({ name, configOk, entityOk })
        pluginLog(`[enterprise] 插件管控：已自动清理清单外插件「${name}」（触发: ${trigger}；配置: 已移除；文件: ${entityOk ? '已删除' : '运行中占用未删，重启后不再加载'}）`)
      }

      if (removed.length) {
        resetDeviceInfoCache() // 让下一拍心跳带更新后的插件清单
        recordCleanup(removed, profileDir) // 员工端提示重启生效 + 登记实体删除重试
      }
      return { ok: true, removed, protectedMissing }
    } finally {
      releaseManifestOp()
    }
  } finally {
    enforcing = false
  }
}
