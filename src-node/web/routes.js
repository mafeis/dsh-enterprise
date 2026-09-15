/**
 * 本插件 HTTP 路由（挂在 DSH Host webserver，仅回环）：
 *   GET  /api/enterprise/status            当前配置状态（含插件合规/规则统计）
 *   POST /api/enterprise/login             登录并自动配置
 *   POST /api/enterprise/logout            清场登出（吊销远端 + 清本地）
 *   GET  /api/enterprise/models            企业模型目录（网关实时，缓存兜底）
 *   POST /api/enterprise/repair            一键配置 Provider
 *   POST /api/enterprise/heartbeat-config  心跳开关/间隔
 *   POST /api/enterprise/heartbeat-now     立即心跳
 *   GET  /api/enterprise/policy            网关下发的企业策略（只读透传）
 *   GET  /api/enterprise/usage?days=       我的消耗（透传网关计费）
 *   GET  /api/enterprise/market            企业插件市场
 *   POST /api/enterprise/plugin-install    安装企业允许清单内的插件（事前拦截）
 *   GET  /api/enterprise/plugin-registry   企业插件源配置
 *   GET  /api/enterprise/rules             本机执行规则（总量统计 + 命中记录）
 *   POST /api/enterprise/rules/check-url   试一试：网址是否被拦
 *   POST /api/enterprise/rules/check-text  试一试：文本是否命中敏感词
 *   GET  /api/enterprise/rules/self-test   规则钩子自检（真实 waterfall 链路）
 *   GET  /plugins/enterprise               内置登录页
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeTextAtomic, readJsonSafe } from '../shared/fs-utils.js'
import { dshSettingsFile, entSettingsFile, credentialsFile } from '../shared/paths.js'
import { pluginLog } from '../shared/log.js'
import { readState, saveState, readToken } from '../state/state.js'
import { removeProviderFromSettingsYaml } from '../settings/yaml-edit.js'
import { collectInstalledPlugins } from '../device/device-info.js'
import { fetchPolicySnapshot, resolvePluginInstallSpec, runPluginCli, findProfileRoot, MARKET_DESC_ZH, marketMeta, peekCachedPolicy } from '../policy/policy.js'
import { PROTECTED_PLUGINS, isEnforceBusy, claimManifestOp, releaseManifestOp } from '../enforce/plugin-enforce.js'
import { RULE_ENGINE_VERSION, runTextRules, runUrlRules, noteRuleRun, getRuleRuns, getRuleHits, isStepHookAlive, ruleHost } from '../rules/engine.js'
import { currentHeartbeatState, runHeartbeatOnce, syncHeartbeatTimer } from '../heartbeat/heartbeat.js'
import { repairConfigure, loginAndConfigure } from '../auth/login.js'
import { LOGIN_PAGE_HTML } from './login-page.js'

export function createRoutes(ctx) {
  const routes = [
    {
      kind: 'exact',
      path: '/api/enterprise/plugin-registry',
      methods: ['GET'],
      handler: async ({ res }) => {
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        const policy = await fetchPolicySnapshot()
        const reg = policy?.pluginRegistry ?? { mode: 'off' }
        json(200, {
          ok: true,
          registry: {
            mode: reg.mode ?? 'off',
            npmRegistryUrl: reg.npmRegistryUrl ?? '',
            packagePrefix: reg.packagePrefix ?? '',
            allowedFallback: reg.allowedFallback !== false,
          },
          allowedPlugins: policy?.allowedPlugins ?? [],
        })
      },
    },
    {
      kind: 'exact',
      path: '/api/enterprise/market',
      methods: ['GET'],
      handler: async ({ res }) => {
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        const policy = await fetchPolicySnapshot()
        const allowed = Array.isArray(policy?.allowedPlugins) ? policy.allowedPlugins : []
        const installed = collectInstalledPlugins() ?? []
        // 元数据：管理员中文名录优先，npm description 兜底（10 分钟缓存）
        const meta = await marketMeta(allowed)
        const items = allowed.map((name) => ({
          name,
          installed: installed.includes(name),
          descriptionZh: MARKET_DESC_ZH[name] ?? '',
          description: MARKET_DESC_ZH[name] ?? (meta[name] ?? ''),
        }))
        json(200, { ok: true, items, installedOthers: installed.filter((x) => !allowed.includes(x)) })
      },
    },
    {
      kind: 'exact',
      path: '/api/enterprise/plugin-install',
      methods: ['POST'],
      jsonBody: true,
      handler: async ({ res, body }) => {
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        const policy = await fetchPolicySnapshot()
        const allowed = Array.isArray(policy?.allowedPlugins) ? policy.allowedPlugins : null
        const name = String(body?.name ?? '').trim()
        if (!name) return json(400, { ok: false, error: '需要 name（插件包名）' })
        // 允许清单非空时，清单外插件拒绝安装（管控从"事后告警"升级为"事前拦截"）
        if (allowed && allowed.length && !allowed.includes(name)) {
          return json(403, { ok: false, error: `插件「${name}」不在企业允许清单内，已拦截（清单：${allowed.join('、')}）` })
        }
        // 与插件管控清理互斥：两边都要读改写 profile manifest，并发交错会让 pnpm 用
        // 旧快照把管控刚移除的条目写回（复活）。拿不到写权就拒绝本轮安装。
        if (isEnforceBusy() || !claimManifestOp()) {
          return json(409, { ok: false, error: '插件管控清理正在进行，请稍后重试安装' })
        }
        try {
          const spec = await resolvePluginInstallSpec(name)
          if (!spec.ok) return json(400, spec)
          const args = ['add', spec.spec]
          if (spec.registry) args.push('--registry', spec.registry)
          const r = await runPluginCli(args)
          noteRuleRun('plugin-install', r.ok)
          // 安装后校验：dsh CLI 可能「部分成功」（bundles 写入 manifest 但 pnpm 落盘失败——
          // 网络/registry 抖动时出现过），此时依赖实体缺失、重启后 bundle 解析直接报
          // PackageOverlayNotFoundError。这里核实 node_modules 实体真实存在，不实就改报失败。
          let verified = r.ok
          if (r.ok) {
            const profileDir = findProfileRoot()
            // join 按平台拼分隔符：split('/') 写法在 POSIX 上对 scoped 包同样成立
            //（旧写法硬编码反斜杠，Linux/macOS 上 scoped 包永远核实失败、误回滚）
            const entityPath = join(profileDir ?? '', 'node_modules', ...name.split('/'), 'package.json')
            const entOk = profileDir ? existsSync(entityPath) : true // 非 profile 形态无法核实，按原结果
            if (!entOk) {
              verified = false
              r.error = `安装未完成（${name} 的依赖未落盘，通常是网络或安装源抖动）。已自动回滚 manifest 中的 bundle 记录，请重试安装。`
              // 回滚：把该包从 dsh.profile.bundles 移除，恢复 manifest/deps 一致，避免下次启动报错
              try {
                const pkgPath = join(profileDir, 'package.json')
                const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
                if (Array.isArray(pkg?.dsh?.profile?.bundles)) {
                  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((b) => b !== name)
                }
                delete pkg.dependencies?.[name]
                writeTextAtomic(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
              } catch { /* 回滚失败不影响主错误返回 */ }
            }
          }
          return json(200, { ...r, ok: verified, verified, resolvedSpec: spec.spec, source: spec.source, registry: spec.registry ?? null })
        } finally {
          releaseManifestOp()
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/enterprise/rules',
      methods: ['GET'],
      handler: async ({ res }) => {
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        const policy = await fetchPolicySnapshot()
        json(200, {
          ok: true,
          engineVersion: RULE_ENGINE_VERSION,
          rules: policy?.clientRules ?? [],
          runs: getRuleRuns(),
          hits: getRuleHits(),
        })
      },
    },
    {
      kind: 'exact',
      path: '/api/enterprise/rules/check-url',
      methods: ['POST'],
      jsonBody: true,
      handler: async ({ res, body }) => {
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        await fetchPolicySnapshot()   // 保证缓存新鲜
        const r = runUrlRules(String(body?.url ?? ''))
        noteRuleRun('block-url', r.allowed)
        json(200, { ok: true, ...r, message: r.hit?.message ?? '', action: r.hit?.action ?? 'block' })
      },
    },
    {
      kind: 'exact',
      path: '/api/enterprise/rules/check-text',
      methods: ['POST'],
      jsonBody: true,
      handler: async ({ res, body }) => {
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        await fetchPolicySnapshot()
        const r = runTextRules(String(body?.text ?? ''))
        noteRuleRun('block-word', r.allowed)
        json(200, { ok: true, ...r, message: r.hit?.message ?? '', action: r.hit?.action ?? 'block' })
      },
    },
    {
      kind: 'exact',
      path: '/api/enterprise/rules/self-test',
      methods: ['GET'],
      handler: async ({ res }) => {
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        // 在宿主 ctx 上发射真实 waterfall 事件，验证强制执行钩子已注册且判定正确。
        // 只跑监听器链（默认 allow），不执行任何真实工具。
        // 拦截目标从当前生效的 block-url 规则动态取（此前硬编码特定外部域名，规则换配置自测就失效）。
        await fetchPolicySnapshot()
        const results = {}
        try {
          const policy = peekCachedPolicy()
          const blockUrlRule = (policy?.clientRules ?? []).find((r) => r.type === 'block-url' && r.action === 'block')
          const mkExec = (url) => ({ callId: 'selftest-' + Math.random().toString(36).slice(2), name: 'web_fetch', arguments: { url }, agent: null, signal: new AbortController().signal })
          let blocked, allowed
          if (blockUrlRule) {
            const denyTarget = 'https://' + ruleHost(blockUrlRule.value) + '/'
            try { blocked = await ctx.waterfall(ctx, 'tools/pre-execute', mkExec(denyTarget), () => Promise.resolve({ kind: 'allow' })) } catch (e) { results.toolBlockedErr = String(e?.stack ?? e).slice(0, 300) }
          } else {
            results.noBlockUrlRule = true
          }
          try { allowed = await ctx.waterfall(ctx, 'tools/pre-execute', mkExec('https://example.com/'), () => Promise.resolve({ kind: 'allow' })) } catch (e) { results.toolAllowedErr = String(e?.stack ?? e).slice(0, 300) }
          results.toolBlocked = blocked
          results.toolAllowed = allowed
          // agent/pre-step 的其他监听器（session-checkpoint-policy 等）要求真实 agent，
          // 自测里拿不到 → 直接用和 agent/pre-step 相同的判定函数验证（runTextRules 已由 check-text 路由覆盖），
          // 并退而验证：钩子注册状态 + tools/pre-execute 全链路。
          const blockWord = (policy?.clientRules ?? []).find((r) => r.type === 'block-word' && r.action === 'block')
          const hit = blockWord ? (() => { try { return new RegExp(blockWord.value, 'i').test('请总结这段话：内部机密项目进展') } catch { return false } })() : false
          results.stepRuleEval = { rule: blockWord?.id, hit }
          results.stepHookRegistered = isStepHookAlive() // 见钩子 effect 里的存活标记
          results.ok = (!blockUrlRule || blocked?.kind === 'deny') && allowed?.kind === 'allow' && hit && isStepHookAlive()
        } catch (e) {
          results.ok = false
          results.error = String(e?.message ?? e).slice(0, 200)
        }
        json(200, results)
      },
    },
    {
      kind: 'exact',
      path: '/api/enterprise/status',
      methods: ['GET'],
      handler: async ({ res }) => {
        const s = readJsonSafe(entSettingsFile())
        const p = s?.providers?.['ent-gateway']
        const state = readState()
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        const installedPlugins = collectInstalledPlugins()
        const policySnap = await fetchPolicySnapshot()
        const allowedPlugins = Array.isArray(policySnap?.allowedPlugins) ? policySnap.allowedPlugins : null
        // 违规 = 允许清单非空 且 已安装清单已知 时，安装了清单之外的插件
        //（保护名单除外：本插件自身与 DSH 必装组件由管控保留，不向员工端告警）
        const violations = (Array.isArray(allowedPlugins) && allowedPlugins.length && Array.isArray(installedPlugins))
          ? installedPlugins.filter((x) => !allowedPlugins.includes(x) && !PROTECTED_PLUGINS.includes(x))
          : []
        json(200, {
          configured: !!p,
          gateway: p?.baseUrl ?? state.gateway ?? '',
          models: (p?.models ?? state.models ?? []).map((m) => (typeof m === 'string' ? m : m.id)),
          defaultModel: s?.['agent-default-model']?.model ?? '',
          user: state.user ?? '',
          loginAt: state.loginAt ?? '',
          heartbeatConfig: state.heartbeatConfig ?? { enabled: true, intervalSec: 60 },
          heartbeat: state.heartbeat ?? currentHeartbeatState(),
          clientRules: {
            count: (policySnap?.clientRules ?? []).length,
            engineVersion: RULE_ENGINE_VERSION,
            runs: getRuleRuns(),
          },
          pluginGovernance: {
            installedPlugins: installedPlugins ?? [],
            installedUnknown: installedPlugins === null,
            allowedPlugins: allowedPlugins ?? [],
            allowedUnknown: allowedPlugins === null,
            violations,
            // 管控清理记录：本次 DSH 进程启动之后发生过清理 → 提示「重启后完全生效」
            //（被移除插件的 bundle 已随本进程启动加载，内存里无法卸载，重启后不再加载）
            pendingRestart: (state.lastPluginCleanup?.names?.length
              && new Date(state.lastPluginCleanup.at) > new Date(Date.now() - process.uptime() * 1000))
              ? state.lastPluginCleanup : null,
          },
        })
      },
    },
    {
      kind: 'exact',
      path: '/api/enterprise/policy',
      methods: ['GET'],
      handler: async ({ res }) => {
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        const state = readState()
        if (!state.gateway) return json(503, { ok: false, error: '未登录企业网关' })
        try {
          const r = await fetch(`${state.gateway}/policy/current`, { signal: AbortSignal.timeout(5000) })
          const b = await r.json().catch(() => null)
          if (!r.ok || !b) return json(502, { ok: false, error: `策略获取失败（HTTP ${r.status}）` })
          json(200, { ok: true, policy: b })
        } catch (e) {
          json(502, { ok: false, error: '网关不可达：' + String(e?.message ?? e).slice(0, 120) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/enterprise/heartbeat-config',
      methods: ['POST'],
      jsonBody: true,
      handler: async ({ res, body }) => {
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        const hb = readState().heartbeatConfig ?? { enabled: true, intervalSec: 60 }
        const next = {
          enabled: typeof body.enabled === 'boolean' ? body.enabled : hb.enabled,
          intervalSec: Math.min(3600, Math.max(15, Number(body.intervalSec) || hb.intervalSec)),
        }
        saveState({ heartbeatConfig: next })
        syncHeartbeatTimer(ctx)
        json(200, { ok: true, heartbeatConfig: next })
      },
    },
    {
      kind: 'exact',
      path: '/api/enterprise/heartbeat-now',
      methods: ['POST'],
      handler: async ({ res }) => {
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        const state = readState()
        if (!state.gateway) return json(400, { ok: false, error: '尚未登录' })
        const r = await runHeartbeatOnce()
        json(200, { ok: true, heartbeat: r })
      },
    },
    {
      kind: 'exact',
      path: '/api/enterprise/models',
      methods: ['GET'],
      handler: async ({ res }) => {
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        const state = readState()
        let models = []
        let source = ''
        // 优先实时拉网关目录（含 input_modes / thinking_levels 元数据）；网关不可达时退回本地缓存
        if (state.gateway) {
          try {
            const r = await fetch(`${state.gateway}/v1/models`, { signal: AbortSignal.timeout(5000) })
            const b = await r.json().catch(() => ({}))
            if (r.ok && Array.isArray(b.data)) { models = b.data; source = 'gateway' }
          } catch { /* 网关不可达，走缓存 */ }
        }
        if (!models.length) {
          const s = readJsonSafe(entSettingsFile())
          models = (s?.providers?.['ent-gateway']?.models ?? []).map((m) => (typeof m === 'string' ? { id: m } : m))
          source = models.length ? 'cache' : ''
        }
        json(200, { ok: models.length > 0, source, gateway: state.gateway ?? '', models })
      },
    },
    {
      kind: 'exact',
      path: '/api/enterprise/usage',
      methods: ['GET'],
      handler: async ({ res, url }) => {
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        const days = Math.min(90, Math.max(1, Math.round(Number(url.searchParams.get('days')) || 7)))
        const state = readState()
        if (!state.gateway) return json(400, { ok: false, error: '尚未登录企业账号' })
        const token = readToken()
        if (!token) return json(401, { ok: false, error: '凭证已丢失，请重新登录' })
        try {
          const r = await fetch(`${state.gateway}/usage/me?days=${days}`, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(6000),
          })
          const b = await r.json().catch(() => ({}))
          if (!r.ok) {
            return json(r.status === 401 ? 401 : 502, { ok: false, error: r.status === 401 ? '登录状态已失效，请重新登录' : (b?.error?.message ?? `网关查询失败（HTTP ${r.status}）`) })
          }
          json(200, b)
        } catch (e) {
          json(502, { ok: false, error: '网关不可达：' + String(e?.message ?? e).slice(0, 120) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/enterprise/repair',
      methods: ['POST'],
      handler: async ({ res }) => {
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        json(200, await repairConfigure())
      },
    },
    {
      kind: 'exact',
      path: '/api/enterprise/login',
      methods: ['POST'],
      jsonBody: true,
      handler: async ({ res, body }) => {
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        if (!body.username || !body.password) return json(400, { ok: false, error: '需要 username 和 password' })
        try {
          // server 缺省优先级：本次提交 > 上次使用的网关（state.gateway，登出后仍保留）> 出厂默认
          const state = readState()
          const r = await loginAndConfigure({ server: body.server ?? state.gateway ?? '', username: body.username, password: body.password })
          if (r.ok) {
            ctx.logger.info(`[enterprise] 用户 ${r.user} 登录成功，已配置 ${r.models.length} 个企业模型`)
            pluginLog(`登录成功 user=${r.user} server=${body.server ?? state.gateway ?? '(出厂默认)'} 模型=${r.models.length} 个`)
            // 登录后自动补一次 repairConfigure（与"一键配置 Provider"同一函数，幂等）：
            // 220 实机发现登录写入在个别机器上未即时反映到模型选择器（要手动点一键配置
            // 才好），延迟补写保证跟手动点击完全同路径、同结果，员工零操作。
            setTimeout(() => {
              repairConfigure().then((rr) => {
                if (rr?.ok) pluginLog(`登录后自动重配完成（模型 ${rr.models.length} 个，运行中实例已同步）`)
                else pluginLog(`登录后自动重配未成功: ${rr?.error ?? '未知'}（可手动"一键配置"）`)
              }).catch(() => {})
            }, 3000)
          }
          else { ctx.logger.warn(`[enterprise] 登录失败: ${r.error}`); pluginLog(`登录失败 user=${body.username} 原因=${r.error}`) }
          json(200, r)
        } catch (e) {
          json(502, { ok: false, error: '网关不可达：' + String(e).slice(0, 120) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/enterprise/logout',
      methods: ['POST'],
      handler: async ({ res }) => {
        const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
        try {
          // 1. 服务端吊销：让网关立刻作废这张 JWT（跟随登录状态失效，而不是干等 7/30 天过期）
          const st = readState()
          if (st.gateway && st.token) {
            try {
              await fetch(`${st.gateway}/auth/logout`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${st.token}` },
                body: '{}',
                signal: AbortSignal.timeout(5000),
              })
            } catch { /* 网关不可达也要继续清理本地 */ }
          }
          // 2. 清本地配置与凭证
          const settingsPath = entSettingsFile()
          const s = readJsonSafe(settingsPath)
          if (s) { delete s.providers?.['ent-gateway']; delete s['agent-default-model']; writeTextAtomic(settingsPath, JSON.stringify(s, null, 2)) }
          // 主 settings.yaml：移除 ent-gateway；企业管控模式下进一步把模型配置整个清空（providers: {} + 删默认模型）——
          // 不登录不能用：登出后 DSH 无任何可用模型，登录遮罩挡住全部操作
          const mainSettings = dshSettingsFile()
          if (existsSync(mainSettings)) {
            const raw = readFileSync(mainSettings, 'utf8')
            let cleaned = removeProviderFromSettingsYaml(raw, 'ent-gateway')
            // 顶层 agent-default-model 若指向 ent-gateway，一并移除（否则 DSH 找不到 provider 启动报错）
            if (/^agent-default-model:\s*\n(\s+provider:\s*ent-gateway[^\n]*\n)/m.test(cleaned)) {
              cleaned = cleaned.replace(/^(agent-default-model:\s*)\n\s+provider:\s*ent-gateway[^\n]*\n\s+model:[^\n]*\n/m, '')
            }
            // 企业管控：清空所有模型（用户要求登出后模型配置清空）
            const admMatch = cleaned.match(/^agent-default-model:\s*\n\s+provider:\s*([^\n]+)\n/m)
            const admProvider = admMatch?.[1]?.trim()
            if (!admProvider || admProvider === 'ent-gateway') {
              // 无其他默认模型（或默认就是企业网关）→ 连 agent-default-model 一起删
              cleaned = cleaned.replace(/^agent-default-model:\s*\n(\s+.*\n?)+/m, '')
            }
            cleaned = cleaned.replace(/(^llm-pi-ai:\s*\n)\s+providers:[^\n]*\n(?:(?!  [a-zA-Z]|\n)[^\n]*\n)*/m, '$1  providers: {}\n')
            // 确保 llm-deepseek 屏蔽段存在：DSH 内置官方 deepseek provider 自带一整套 v4 模型目录，
            // 不屏蔽会在会话模型下拉里冒出来，绕过企业网关统一管控
            if (!/^llm-deepseek:\s*$/m.test(cleaned)) {
              cleaned = cleaned.replace(/(^llm-pi-ai:\s*\n\s+providers: \{\}\n)/m, '$1llm-deepseek:\n  models: []\n')
            }
            if (cleaned !== raw) writeTextAtomic(mainSettings, cleaned)
          }
          const credPath = credentialsFile()
          if (existsSync(credPath)) {
            const raw = readFileSync(credPath, 'utf8').replace(/^\s*ENT_GATEWAY_TOKEN:\s*.*\r?\n?/m, '')
            writeTextAtomic(credPath, raw)
          }
          // 3. 清 state 里的令牌与登录痕迹
          saveState({ token: null, tokenPreview: null, user: null, loginAt: null })
          pluginLog(`登出完成（原账号=${st.user ?? '未知'}，网关地址保留=${st.gateway ?? ''}）`)
          json(200, { ok: true })
        } catch (e) { json(500, { ok: false, error: String(e).slice(0, 120) }) }
      },
    },
    {
      kind: 'exact',
      path: '/plugins/enterprise',
      methods: ['GET'],
      handler: async ({ res }) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(LOGIN_PAGE_HTML)
      },
    },
  ]
  return routes
}
