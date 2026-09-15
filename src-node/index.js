/**
 * DSH 企业版登录插件 · Node 半区入口
 *
 * 用户流程：DSH Web 打开登录页 → 输入企业账号密码 → 插件调网关 /auth/login 换 JWT
 *   → 自动写 enterprise-settings.yaml（providers + models + 默认模型）
 *   → 自动写 .credentials.yaml（ENT_GATEWAY_TOKEN）
 *   → DSH 立即可用企业模型，无需手工配置
 *
 * 工程结构（源码在 src-node/，本文件是构建产物 lib/index.js 的源头）：
 *   shared/    路径解析 / 原子写 / 落盘日志 / 版本号
 *   state/     插件状态持久化 + 凭证读取
 *   settings/  主 settings.yaml 行级 YAML 改写 + provider/凭证写入
 *   auth/      登录自动配置 + 一键修复
 *   device/    设备信息采集 + 本机插件清单
 *   heartbeat/ 心跳（增量上报 / 令牌续期 / 模型指纹联动）
 *   enforce/   插件管控强制执行（启动/心跳自动清理允许清单外插件）
 *   policy/    企业策略拉取缓存回执 + 企业插件源 + 市场元数据
 *   rules/     本地规则引擎（判定）+ 宿主拦截钩子（执行）
 *   web/       路由适配器 + 16 条 HTTP 路由 + 内置登录页
 *
 * ⚠ 改代码改 src-node/，跑 `node build.mjs` 重新生成 lib/，再 remove+add 重装插件。
 */
import { createRouteAdapter } from './web/respond.js'
import { createRoutes } from './web/routes.js'
import { registerRuleHooks } from './rules/hooks.js'
import { syncHeartbeatTimer, stopHeartbeat } from './heartbeat/heartbeat.js'
import { enforcePluginAllowlist } from './enforce/plugin-enforce.js'
import { readState, readToken } from './state/state.js'
import { dshHome, dshSettingsFile } from './shared/paths.js'
import { readJsonSafe } from './shared/fs-utils.js'
import { setHostLogger, pluginLog, ctxLoggerInfoSafe } from './shared/log.js'
import { ensurePlaceholderDeepseekKey } from './settings/provider-config.js'
import { profilePatchSettingsPaths, ensureWelcomeNoticeAck } from './settings/yaml-edit.js'
import { repairConfigure } from './auth/login.js'
import { VERSION } from './shared/version.js'

export const name = 'dsh-enterprise'

export const inject = ['webServer']

export function apply(ctx) {
  const adapt = createRouteAdapter(ctx)
  const routes = createRoutes(ctx)

  ctx.effect(() => {
    const disposers = routes.map((r) => ctx.webServer.register(adapt(r)))
    ctx.logger.info('[enterprise] 企业登录插件已就绪 · 登录页: /plugins/enterprise · 设置页: 设置 → 企业管理')
    setHostLogger(ctx.logger)
    pluginLog(`插件就绪（版本 ${VERSION}，home=${dshHome()}，gateway=${readState().gateway ?? '未登录'}）`)
    syncHeartbeatTimer(ctx)
    ensurePlaceholderDeepseekKey()
    // 内测横幅预签必须在激活时（不能等登录）：新装机的横幅在登录遮罩之前就弹
    ensureWelcomeNoticeAck()
    // 插件管控：启动 4s 后按网关允许清单自动清理清单外插件（manifest 移除，重启后不再加载）。
    // 网关策略未配清单 / 从未登录时内部自动跳过，属空操作。
    setTimeout(() => { void enforcePluginAllowlist('startup').catch(() => { /* 管控失败不影响插件其他功能 */ }) }, 4000)
    // 启动对账：已登录（本地有 token 与网关记录）时，启动即拉一次网关模型目录
    // 与本地 provider 对比——网关侧改过模型（增删/改名）无需等心跳周期，登录完成
    // /重启完成 5 秒内本地模型列表就对齐；provider 缺失（旧版本登录未写入导致
    // 官方"配置 API key"向导弹出）也在此一并修复。对比口径：模型 id 集合 +
    // displayName（与网关 modelFingerprint 同口径）。
    setTimeout(() => {
      try {
        const st = readState()
        if (!st.gateway || !st.user) return // 从未登录过，不干预（首次登录走正常流程）
        const token = readToken()
        if (!token) return
        fetch(`${st.gateway}/v1/models`, { signal: AbortSignal.timeout(6000) })
          .then((r) => r.json().catch(() => ({ data: [] })))
          .then((b) => {
            const remote = (b.data ?? []).map((m) => `${m.id}::${m.display_name ?? m.id}`).sort()
            if (!remote.length) return // 网关暂时不可达，留给心跳/下次启动
            // 本地 provider 的模型（任意已知 settings 目标）
            const local = (() => {
              try {
                for (const p of profilePatchSettingsPaths()) {
                  const s = readJsonSafe(p)
                  const models = s?.providers?.['ent-gateway']?.models
                  if (Array.isArray(models) && models.length) {
                    return models.map((m) => `${m.id}::${m.name ?? m.id}`).sort()
                  }
                }
                const root = readJsonSafe(dshSettingsFile())
                const models = root?.providers?.['ent-gateway']?.models
                return Array.isArray(models) ? models.map((m) => `${m.id}::${m.name ?? m.id}`).sort() : []
              } catch { return [] }
            })()
            const missing = local.length !== remote.length || remote.some((x, i) => x !== local[i])
            if (!missing) {
              ctxLoggerInfoSafe('[enterprise] 启动对账：本地模型目录与网关一致')
              return
            }
            return repairConfigure().then((r) => {
              if (r?.ok) ctxLoggerInfoSafe(`[enterprise] 启动对账：本地模型目录与网关不一致（本地 ${local.length} 个 / 网关 ${remote.length} 个），已自动更新`)
              else ctxLoggerInfoSafe(`[enterprise] 启动对账发现差异但重配失败: ${r?.error ?? '未知'}（员工可手动"一键配置"）`)
            }).catch(() => {})
          })
          .catch(() => { /* 网关不可达：心跳与下次启动再对账 */ })
      } catch { /* 对账失败不影响插件其他功能 */ }
    }, 5000)
    return () => {
      for (const d of disposers) d()
      stopHeartbeat()
    }
  }, 'enterprise: routes + heartbeat')

  // 本地规则强制执行钩子（tools/pre-execute / tools/post-execute / agent/pre-step）
  registerRuleHooks(ctx)
}

export default { name, inject, apply }
