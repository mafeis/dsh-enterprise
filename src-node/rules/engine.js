/**
 * 本地规则引擎：对网关下发的 clientRules（block-url / block-word）做纯判定，
 * 不发网络请求（策略快照由 policy 模块缓存提供）。供 HTTP 路由与宿主拦截钩子共用。
 *
 * 客户端自助规则：插件本地执行，不占网关往返；命中记录环形保留 100 条（规则页可观测）。
 */
import { peekCachedPolicy } from '../policy/policy.js'
import { pluginLog } from '../shared/log.js'

export const RULE_ENGINE_VERSION = 1

const lastRuleRuns = { at: null, total: 0, blocked: 0, rules: {} }

/** 近期命中记录（环形，最多 100 条）：让规则"可观测"——拦没拦、拦了什么，规则页直接可看 */
const ruleHits = []

export function getRuleRuns() { return lastRuleRuns }
export function getRuleHits() { return ruleHits }

/** 对一条文本跑全部 block-word 规则。返回 { allowed, hit, matched, snippet, warnHit?, warnMatched? }
 *  语义：**block 优先**——遍历所有规则，先找 block 级命中（消息将被拦截，只报 block）；
 *  没有任何 block 命中时，若有 warn 级命中则报第一条 warn（放行 + 提醒）。
 *  matched = 实际命中的词；snippet = 命中文本开头片段（管理台记录用） */
export function runTextRules(text) {
  const policy = peekCachedPolicy()
  const rules = (Array.isArray(policy?.clientRules) ? policy.clientRules : []).filter((r) => r.type === 'block-word')
  const snippet = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  let warn = null
  for (const r of rules) {
    let matched = null
    try {
      const m = new RegExp(r.value, 'i').exec(text)
      if (m) matched = m[0]
    } catch {
      const v = String(r.value).toLowerCase()
      if (text.toLowerCase().includes(v)) matched = r.value
    }
    if (!matched) continue
    if (r.action === 'block') return { allowed: false, hit: r, matched, snippet }
    if (!warn) warn = { hit: r, matched }
  }
  if (warn) return { allowed: false, hit: warn.hit, matched: warn.matched, snippet }
  return { allowed: true, hit: null, matched: null, snippet: '' }
}

/** 规则值 → 纯域名（剥 scheme 与路径尾巴，去掉首点） */
export function ruleHost(value) {
  return String(value).toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0].replace(/^\./, '')
}

/** 校验一个 URL 是否被 block-url 规则拦截。返回 { allowed, hit, matched }
 *  matched = 命中的规则域名/词（横幅加粗显示用）
 *  规则值可以带 scheme（https://外部AI站）也可以不带（裸域名）；
 *  匹配时把规则值的 scheme 前缀剥掉再比对 host，两边写法都命中。
 *  规则值支持 | 分隔多个域名（如 "google.com|baidu.com"）——逐个拆开比对。 */
export function runUrlRules(rawUrl) {
  const policy = peekCachedPolicy()
  const rules = (Array.isArray(policy?.clientRules) ? policy.clientRules : []).filter((r) => r.type === 'block-url')
  let host = ''
  const raw = String(rawUrl).trim()
  try {
    // 不带 scheme 的输入（如 "chatgpt.com"）按 https 补全再解析，纯域名串也是合法输入
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw).hostname.toLowerCase()
  } catch { return { allowed: true, hit: null } }
  for (const r of rules) {
    // 拆 | 分隔的多域名；兼容用户把它当正则写的习惯
    const variants = String(r.value ?? '').split('|').map((s) => ruleHost(s)).filter(Boolean)
    for (const v of variants) {
      // 三种命中：精确 / 子域名（google.com 拦 news.google.com）/ 裸词（google 拦 *.google.*）
      if (host === v || host.endsWith('.' + v)) return { allowed: false, hit: r, matched: v }
      if (!v.includes('.')) {
        const labels = host.split('.')
        if (labels.includes(v)) return { allowed: false, hit: r, matched: v }
      }
    }
  }
  return { allowed: true, hit: null }
}

/** 网关心跳回执可达时刷新规则（心跳循环里已拉策略缓存，这里只是计数器重置辅助） */
export function noteRuleRun(type, allowed) {
  lastRuleRuns.at = new Date().toISOString()
  lastRuleRuns.total++
  if (!allowed) lastRuleRuns.blocked++
  lastRuleRuns.rules[type] = (lastRuleRuns.rules[type] ?? 0) + 1
}

export function recordRuleHit(hit, detail, extra = {}) {
  ruleHits.unshift({ at: new Date().toISOString(), ruleId: hit?.id ?? '', type: hit?.type ?? '', action: hit?.action ?? '', detail: String(detail ?? '').slice(0, 120), ...extra })
  if (ruleHits.length > 100) ruleHits.length = 100
  if (hit?.action === 'block') pluginLog(`规则拦截 [${hit.id ?? '?'}] ${hit.type ?? ''}: ${String(detail ?? '').slice(0, 100)}`)
}

/** agent/pre-step 钩子存活标记（/rules/self-test 路由验证钩子注册状态用） */
let stepHookAlive = false
export function setStepHookAlive(v) { stepHookAlive = v }
export function isStepHookAlive() { return stepHookAlive }

/** 高风险命令特征：删除/格式化/磁盘写入/进程强杀类。命中即在终端规则页置顶提醒。
 *  匹配的是「用户可见的命令语义」而非精确语法，跨 bash/pwsh/cmd 通用。 */
export const DANGER_CMD_PATTERNS = [
  { re: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+/i, label: 'rm 递归/强制删除' },
  { re: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f|\brm\s+-[a-zA-Z]*f[a-zA-Z]*r/i, label: 'rm 递归强制删除' },
  { re: /(?:remove-item|ri)\s+.*-recurse/i, label: 'PowerShell 递归删除' },
  { re: /\bdel\s+\/[sq]\b|\bdel\s+\/s\s+\/q\b|\brd\s+\/s\b|\brmdir\s+\/s\b/i, label: 'cmd 递归删除目录' },
  { re: /\bformat\s+[a-z]:/i, label: '格式化磁盘' },
  { re: /\bmkfs(\.\w+)?\b/i, label: 'mkfs 格式化' },
  { re: /\bdd\s+[^|]*\bof=\/dev\//i, label: 'dd 覆写磁盘设备' },
  { re: />\s*\/dev\/sd[a-z]|>\s*\/dev\/nvme/i, label: '覆写磁盘设备' },
  { re: /:\(\)\s*\{\s*:\|:&\s*&\s*\}\s*;:/i, label: 'fork 炸弹' },
  { re: /\bchmod\s+-R\s+777\s+\//i, label: '全盘开放写权限' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, label: '关机/重启' },
  { re: /\btaskkill\s+\/f\s+\/im\b|\bpkill\s+-9\b|\bkill\s+-9\s+1\b/i, label: '强制结束进程' },
  { re: /\bcipher\s+\/w\b|\bsdelete\b/i, label: '安全擦除' },
]

export function detectDangerousCommand(text) {
  const t = String(text ?? '')
  for (const d of DANGER_CMD_PATTERNS) {
    try { if (d.re.test(t)) return d } catch { /* 忽略坏正则 */ }
  }
  return null
}
