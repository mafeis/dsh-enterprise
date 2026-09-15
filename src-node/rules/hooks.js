/**
 * 本地规则强制执行：挂接 DSH 原生拦截点，clientRules 真正生效。
 *  - tools/pre-execute：Agent 每次工具调用前校验参数中的 URL（block-url 规则），命中即 deny
 *    （覆盖 web_fetch，也覆盖 bash/pwsh 命令里的 curl/wget 外发——命令串中的 URL 同样被抽出检查）
 *  - tools/post-execute：web_search 返回结果过滤——来源里命中被禁域名（外部AI站等）的直接剔除，
 *    模型引用不到、也不会跟进 fetch
 *  - agent/pre-step：用户新消息进入模型前跑 block-word（block 级）硬拦截，命中即 reject
 *    （该轮直接结束、请求不出本机；warn 级只提示不拦截，个人信息类由网关 DLP 脱敏兜底）
 *  各处都套 try/catch：规则引擎故障时放行不阻塞正常使用（网关 DLP 仍是最后防线）。
 */
import { fetchPolicySnapshot } from '../policy/policy.js'
import { runUrlRules, runTextRules, noteRuleRun, recordRuleHit, detectDangerousCommand, setStepHookAlive } from './engine.js'

export function registerRuleHooks(ctx) {
  ctx.effect(() => {
    const disposers = []
    const SHELL_TOOLS = new Set(['bash', 'pwsh', 'powershell', 'cmd', 'shell', 'run_command', 'run_shell_command', 'execute_command'])
    try {
      disposers.push(ctx.on('tools/pre-execute', async (exec, next) => {
        try {
          await fetchPolicySnapshot()
          const argsText = typeof exec?.arguments === 'string' ? exec.arguments : JSON.stringify(exec?.arguments ?? '')
          // 高风险命令检测（rm -rf / format / dd 等）：不阻断（Agent 正常清理场景很多），
          // 但记入命中记录并置顶提醒——用户对 Agent 的高危动作有知情权
          if (SHELL_TOOLS.has(String(exec?.name ?? '').toLowerCase())) {
            const danger = detectDangerousCommand(argsText)
            if (danger) {
              recordRuleHit({ id: 'danger-cmd', type: 'danger-cmd', action: 'warn' }, `${danger.label}: ${(argsText || '').slice(0, 80)}`, { risk: 'high' })
              ctx.logger.warn(`[enterprise] 高风险命令提示（${danger.label}）：${argsText.slice(0, 100)}`)
            }
          }
          // URL 检查：从工具参数里抽 http(s) 链接逐个过 block-url 规则
          const urls = argsText.match(/https?:\/\/[^\s"'\\<>]+/g) ?? []
          for (const u of urls) {
            const r = runUrlRules(u)
            if (!r.allowed) {
              noteRuleRun('block-url', false)
              recordRuleHit(r.hit, `${exec?.name ?? 'tool'}: ${u}`)
              ctx.logger.warn(`[enterprise] 拦截工具 ${exec?.name} 访问 ${u}（规则 ${r.hit?.id}）`)
              return { kind: 'deny', reason: `[企业管控] ${r.hit?.message || '该地址被企业规则禁止访问'}（规则 ${r.hit?.id}）` }
            }
          }
        } catch { /* 规则引擎故障不阻塞工具执行 */ }
        return next()
      }))
    } catch (e) { ctx.logger.warn('[enterprise] tools/pre-execute 挂接失败（宿主版本过旧？）: ' + String(e).slice(0, 120)) }
    try {
      disposers.push(ctx.on('tools/post-execute', async (exec, result, next) => {
        try {
          // web_search 结果过滤：来源命中被禁域名直接剔除（模型引用不到、不会跟进 fetch）
          if (exec?.name !== 'web_search' || result?.isError) return next()
          const v = result?.value
          if (!v || !Array.isArray(v.sources)) return next()
          await fetchPolicySnapshot()
          const kept = []
          let removed = 0
          for (const s of v.sources) {
            const r = runUrlRules(s?.url)
            if (!r.allowed) { removed++; recordRuleHit(r.hit, `web_search 来源: ${s?.url ?? ''}`, { kind: 'search' }); continue }
            kept.push(s)
          }
          if (!removed) return next()
          noteRuleRun('search-filter', false)
          ctx.logger.warn(`[enterprise] web_search 结果过滤：剔除 ${removed} 个被禁域名来源（保留 ${kept.length} 个）`)
          return { kind: 'accept', value: { ...v, sources: kept } }
        } catch { return next() }
      }))
    } catch (e) { ctx.logger.warn('[enterprise] tools/post-execute 挂接失败（宿主版本过旧？）: ' + String(e).slice(0, 120)) }
    try {
      disposers.push(ctx.on('agent/pre-step', async (payload, next) => {
        try {
          await fetchPolicySnapshot()
          const text = (Array.isArray(payload?.messages) ? payload.messages : [])
            .map((m) => (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? '')))
            .join('\n')
          const r = runTextRules(text)
          if (!r.allowed && r.hit?.action !== 'warn') {
            noteRuleRun('block-word', false)
            recordRuleHit(r.hit, '出站消息命中', { kind: 'word' })
            ctx.logger.warn(`[enterprise] 拦截出站消息（规则 ${r.hit?.id}，block 级敏感词）`)
            return { kind: 'reject' }
          }
        } catch { /* 不阻塞 */ }
        return next()
      }))
    } catch (e) { ctx.logger.warn('[enterprise] agent/pre-step 挂接失败（宿主版本过旧？）: ' + String(e).slice(0, 120)) }
    setStepHookAlive(true)
    ctx.logger.info('[enterprise] 本地管控钩子已挂接：tools/pre-execute（URL 拦截）+ agent/pre-step（敏感词拦截）')
    return () => { setStepHookAlive(false); for (const d of disposers) { try { d() } catch { /* 忽略 */ } } }
  }, 'enterprise: client rule enforcement hooks')
}
