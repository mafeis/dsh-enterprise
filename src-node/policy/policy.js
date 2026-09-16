/**
 * 企业策略（/policy/current）：拉取 + 60s 缓存 + 版本回执（/policy/ack）。
 * 另含企业自建插件源解析（pluginRegistry）、profile 定位、dsh plugin CLI 转发、
 * 市场元数据（管理员中文名录优先，npm description 兜底）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { readState, readToken } from '../state/state.js'
import { dshHome } from '../shared/paths.js'

/** 策略缓存：allowedPlugins / pluginRegistry / clientRules 从网关 /policy/current 拉取，60s 缓存 */
const policyCache = { at: 0, policy: null, ackedVersion: '' }

/** 只读已缓存的策略快照（不发请求）。规则引擎的同步判定用它（与拆分前读闭包缓存等价） */
export function peekCachedPolicy() { return policyCache.policy }

/** 测试专用：注入策略快照（生产代码勿用） */
export function _setCachedPolicyForTests(policy) { policyCache.policy = policy }

export async function fetchPolicySnapshot() {
  const state = readState()
  const base = state.gateway
  if (!base) return null
  if (Date.now() - policyCache.at < 60000) return policyCache.policy
  try {
    const r = await fetch(`${base}/policy/current`, { signal: AbortSignal.timeout(4000) })
    const b = await r.json().catch(() => null)
    policyCache.policy = b ?? policyCache.policy
    policyCache.at = Date.now()
  } catch {
    policyCache.at = Date.now() // 网关不可达：保留旧缓存，60s 后再试
  }
  await ackPolicyIfNeeded()
  return policyCache.policy
}

/** 下发回执：策略版本变化并已在本地加载生效后，向网关回报（幂等，每次版本只报一次）。
 *  管理台「下发回执」列表的数据来源——此前从未上报，该列表一直为空。 */
async function ackPolicyIfNeeded() {
  const st = readState()
  const token = readToken()   // token 在 .credentials.yaml（state.token 恒 null，此处曾用错导致回执从未发出）
  const ver = policyCache.policy?.version
  if (!st.gateway || !token || !ver || ver === policyCache.ackedVersion) return
  try {
    const r = await fetch(`${st.gateway}/policy/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ profile: process.env.DSH_PROFILE ?? 'dsh', policyVersion: ver, device: 'enterprise' }),
      signal: AbortSignal.timeout(4000),
    })
    if (r.ok) policyCache.ackedVersion = ver
  } catch { /* 网关不可达，下轮策略刷新再报 */ }
}

/** ============ 企业自建插件源（pluginRegistry） ============ */
/** 把用户输入的包名解析成本源安装地址。返回 { ok, spec, source, error }
 *  proxy 模式 → { registry }（配 pnpm --registry）
 *  url 模式   → { spec }（<prefix><name> 直接作为包 spec）
 *  off        → 默认社区源原样
 */
export async function resolvePluginInstallSpec(packageName) {
  const name = String(packageName ?? '').trim()
  if (!name) return { ok: false, error: '包名为空' }
  const policy = await fetchPolicySnapshot()
  const reg = policy?.pluginRegistry
  if (!reg || reg.mode === 'off') return { ok: true, spec: name, source: 'default' }
  if (reg.mode === 'proxy') {
    if (!reg.npmRegistryUrl) return { ok: false, error: '企业源未配置 npmRegistryUrl（联系管理员）' }
    return { ok: true, spec: name, registry: reg.npmRegistryUrl.replace(/\/$/, ''), source: 'proxy' }
  }
  // url 模式：前缀拼包名（如 http://plugins.corp.local/pkg/<name>）
  if (!reg.packagePrefix) return { ok: false, error: '企业源未配置 packagePrefix（联系管理员）' }
  return { ok: true, spec: reg.packagePrefix.replace(/\/$/, '') + '/' + name, source: 'url' }
}

/** 读取 profile 根目录（插件自身位置向上找含 dsh.profile.bundles 的 package.json） */
export function findProfileRoot() {
  try {
    let p = new URL('.', import.meta.url)
    for (let i = 0; i < 6; i++) {
      p = new URL('../', p)
      const dir = decodeURIComponent(p.pathname.replace(/^\/([A-Za-z]:)/, '$1'))
      const pkgPath = join(dir, 'package.json')
      if (!existsSync(pkgPath)) continue
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        if (Array.isArray(pkg?.dsh?.profile?.bundles)) return dir
      } catch { /* 下一个目录 */ }
    }
  } catch { /* ignore */ }
  return null
}

/** 定位宿主 desktop-cli 入口 + 引导宿主 exe（返回 { exe, entry } 或 null）。
 *  宿主进程内 process.execPath = DSH Desktop.exe，一级命中（entry 相对 exe 固定）；
 *  测试进程（纯 node）退化为扫 host-commands shim 反解宿主 exe 与 cli 入口。
 *  cli 入口在 app.asar 内部，Node 的 existsSync 看不见——只验 asar 包本体（Electron fs 才穿透 asar）。 */
function desktopCliBootstrap() {
  try {
    const exe = process.execPath
    if (/DSH Desktop\.exe$/i.test(exe) || existsSync(join(dirname(exe), 'resources', 'app.asar'))) {
      return { exe, entry: join(dirname(exe), 'resources', 'app.asar', 'lib', 'desktop-cli.js') }
    }
  } catch { /* ignore */ }
  try {
    const shimRoots = [
      join(homedir(), '.dsh-desktop-ent2', 'host-commands'),           // 已知重定向实例（保底）
      join(homedir(), 'AppData', 'Roaming', 'DSH Desktop', 'host-commands'),
    ]
    for (const root of shimRoots) {
      let kinds
      try { kinds = readdirSync(root) } catch { continue }
      for (const kind of kinds) {
        const genDir = join(root, kind, 'generations')
        let gens
        try { gens = readdirSync(genDir) } catch { continue }
        for (const g of gens) {
          const shim = join(genDir, g, 'bin', 'dsh.cmd')
          try {
            const text = readFileSync(shim, 'utf8')
            const m = text.match(/"([^"]+DSH Desktop\.exe)"[^"]*"([^"]+desktop-cli\.js)"/)
            if (m && existsSync(m[1])) return { exe: m[1], entry: m[2] }
          } catch { /* 下一个 */ }
        }
      }
    }
  } catch { /* ignore */ }
  return null
}

/** 在 profile 目录执行 dsh plugin add/remove（转发 pnpm）。返回 { ok, output|error }
 *  profile 名取自 profile 目录名（曾写死 'default'，装到其他 profile 会错位）。
 *  不走 PATH 上的 dsh：host-commands shim 写死 set DSH_HOME=<默认 home> 且无条件覆盖
 *  外部环境（用户目录重定向如 .dsh-ent2 会被劫持 → 装错家 → "pnpm failed"）。
 *  改为直调宿主 desktop-cli（ELECTRON_RUN_AS_NODE + app.asar 入口），DSH_HOME 钉回
 *  本进程真实 home —— 与宿主同源，天然存在，不依赖任何 PATH 配置。 */
export async function runPluginCli(args) {
  const profileDir = findProfileRoot()
  if (!profileDir) return { ok: false, error: '无法定位 profile 目录（非 profile 安装形态不支持本操作）' }
  const profileName = profileDir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'default'
  const { execFile } = await import('node:child_process')
  const boot = desktopCliBootstrap()
  if (!boot) return { ok: false, error: '未找到宿主 DSH Desktop（无法执行插件安装/卸载）' }
  // ELECTRON_RUN_AS_NODE=1 让 DSH Desktop.exe 当纯 Node 跑 desktop-cli.js（与 host-commands shim 同一机制）；
  // DSH_HOME 钉回本进程 home——防任何中间层再写坏。
  const env = { ...process.env, DSH_HOME: dshHome(), ELECTRON_RUN_AS_NODE: '1' }
  const cliArgs = [boot.entry, 'plugin', '--profile', profileName, ...args]
  pluginLog(`[enterprise] plugin CLI: exe=${boot.exe} home=${env.DSH_HOME} args=${args.join(' ')}`)
  return new Promise((resolve) => {
    execFile(boot.exe, cliArgs,
      { cwd: profileDir, timeout: 120000, windowsHide: true, env },
      (err, stdout, stderr) => {
        if (err) resolve({ ok: false, error: String(stderr || err.message).slice(0, 400) })
        else resolve({ ok: true, output: String(stdout || '').slice(-1500) })
      })
  })
}

/** ============ 市场元数据 ============ */
/** 管理员维护的中文名录优先（跟随 UI 语言下发 zh/en 双字段），npm 英文兜底。 */
export const MARKET_DESC_ZH = {
  'dsh-enterprise': '企业账号登录、模型接入与安全管控（本插件）',
  'dshmarket': 'DSH 内置的可视化插件市场',
  'dsh-better-sidebar': 'VSCode 风格的右侧边栏：对话大纲 / 终端 / 文件树',
  'dsh-context': '会话上下文增强：注入工作区与项目背景信息',
  'dsh-mnemon': '三级记忆管理平台（会话 / 项目 / 长期记忆）',
  'dsh-startup-guard': '启动防护：宿主异常关闭后自动恢复会话',
  'dsh-hot-reload': '插件热更新：升级已装插件无需重启 DSH',
  'dsh-review': '多智能体对抗式代码审查（打包版）',
  '@deepseek-ai/dsh-headless': '无界面运行形态：服务器/CI 中跑 DSH 会话',
  '@deepseek-ai/dsh-base': 'DSH 宿主基础组件（必装）',
  '@deepseek-ai/dsh-web-app': 'DSH Web 图形界面（必装）',
  '@anysearch/anysearch-dsh': 'AnySearch 联网搜索与网页抓取提供方',
  '@vlln/dsh-navbar': '对话节点导航条：快速跳转到任意 user 消息',
}

/** 批量拉 npm registry 的 description（每个包 3s 超时，10 分钟缓存）。
 *  私有包/离线环境拿不到就返回空串，市场卡退化为纯包名展示。 */
const marketMetaCache = { at: 0, data: {} }
export async function marketMeta(names) {
  if (Date.now() - marketMetaCache.at < 600000) return marketMetaCache.data
  const out = {}
  await Promise.all(names.filter((n) => n && !MARKET_DESC_ZH[n]).slice(0, 30).map(async (name) => {
    try {
      const r = await fetch(`https://registry.npmmirror.com/${encodeURIComponent(name)}/latest`, { signal: AbortSignal.timeout(3000) })
      if (r.ok) {
        const b = await r.json()
        if (b?.description) out[name] = String(b.description).slice(0, 160)
      }
    } catch { /* 单个失败不影响其他 */ }
  }))
  marketMetaCache.data = out
  marketMetaCache.at = Date.now()
  return marketMetaCache.data
}
