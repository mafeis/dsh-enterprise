/**
 * 主 settings.yaml 的行级 YAML 改写（不引入 YAML 依赖、不破坏注释/顺序）。
 *
 * ⚠ 历史踩坑重灾区（详见 docs/客户端插件核心文档.md §6）：
 *  - 正则改 settings.yaml 极易翻车，改动这里必须配 test/yaml-edit.test.mjs 单测
 *  - llm-pi-ai 段校验红线：模型 input 只能 text/image；reasoningEfforts 必须 dict；
 *    违反 → 整个 ns 不注册 → 企业模型全部消失且无显式报错
 *  - llm-deepseek 屏蔽段（models: []）登录/登出两条路径都必须保证
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { writeTextAtomic } from '../shared/fs-utils.js'
import { dshHome, dshSettingsFile } from '../shared/paths.js'
import { ctxLoggerInfoSafe } from '../shared/log.js'
import { GATEWAY_KEY_REF } from './provider-config.js'

/**
 * 从 settings.yaml 文本中移除 llm-pi-ai.providers 下指定 provider 的整块定义。
 * 纯行级处理：定位 llm-pi-ai: 段 → providers: 子段 → <name>: 块，删除到下一个同级 key 行。
 */
export function removeProviderFromSettingsYaml(text, providerName) {
  const lines = text.split('\n')
  // 在 "llm-pi-ai:" 段内找 "providers:" 再找 "<name>:"（缩进为 providers 缩进 + 2）
  let inLlm = false
  let provIndent = -1
  let start = -1
  let keyIndent = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!inLlm && /^llm-pi-ai:\s*$/.test(line)) { inLlm = true; continue }
    if (!inLlm) continue
    const m = line.match(/^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!m) continue
    const indent = m[1].length
    if (provIndent === -1) {
      if (indent === 2 && m[2] === 'providers' && m[3] === '') { provIndent = 2; continue }
      if (indent <= 1 && m[2] !== 'providers') break // 离开了 llm-pi-ai 段
    } else if (start === -1) {
      if (indent === 4 && m[2] === providerName) { start = i; keyIndent = indent; break }
      if (indent < 4) break // providers 段结束
    }
  }
  if (start === -1) return text
  // 块终点：下一个缩进 ≤ keyIndent 的 key 行（或文档结束）
  const siblingRe = /^(\s*)([A-Za-z0-9_-]+):/
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(siblingRe)
    if (m && m[1].length <= keyIndent) { end = i; break }
  }
  lines.splice(start, end - start)
  return lines.join('\n')
}

/**
 * 把 ent-gateway provider 块写进主 settings.yaml 的 llm-pi-ai.providers 下。
 * 行级操作：已有 ent-gateway 块则先删再插（保持位置在 providers: 之后），没有则直接插入。
 */
export function syncMainSettingsProvider(base, models) {
  // 新版 DSH（0.1.7+）配置面：settings.yaml 已被导入并改名，profile patch 是权威 settings 存储层
  if (existsSync(join(dshHome(), 'settings.yaml.imported'))) {
    syncEnterpriseProfilePatches(base, models)
    return
  }
  // Desktop 多实例场景：每个 profile 有自己的 settings.yaml（cordis.patch.yml 的
  // settings entry 指向它）。ENT_SETTINGS_PATH 只覆盖 CLI 启动方式；Desktop 启动
  // 时不带该变量，dshSettingsFile() 会落到 home 根的共享 settings.yaml——而
  // profile 实际加载的是 patch 指向的文件。这里把所有已知目标都同步一遍，
  // 保证无论哪种启动方式，生效的 settings.yaml 都拿到最新 provider。
  const targets = new Set([dshSettingsFile()])
  for (const patchSettings of profilePatchSettingsPaths()) targets.add(patchSettings)
  for (const mainSettings of targets) {
    syncOneMainSettingsProvider(mainSettings, base, models)
  }
  // 新版 DSH（0.1.7+）配置面：profile patch 也是权威 settings 存储层
  syncEnterpriseProfilePatches(base, models)
}

/**
 * 从当前生效 profile 的 cordis.patch.yml（cordis.yml 的组合结果不可读，patch 源
 * 文件里 id: settings 的 config.path 就是 profile 级 settings.yaml）解析 settings 路径。
 * 仅在能唯一确定时返回；解析失败静默跳过（保持旧行为）。
 */
export function profilePatchSettingsPaths() {
  try {
    const profileDir = process.env.ENT_PROFILE_DIR
      ?? (process.env.DSH_HOME ? join(process.env.DSH_HOME, 'profiles') : null)
    if (!profileDir || !existsSync(profileDir)) return []
    // 多 profile 场景（Desktop 多开/用户多环境）：无法可靠判断当前激活的是哪个 profile
    //（profile-selection state 在 Desktop userData 目录，插件不可依赖），所以把**所有**
    // 声明了 settings path 的 profile 配置全量同步——幂等且无副作用，代价可忽略。
    const out = new Set()
    for (const name of existsSync(profileDir) ? readdirSync(profileDir) : []) {
      const patch = join(profileDir, name, 'cordis.patch.yml')
      if (!existsSync(patch)) continue
      try {
        const raw = readFileSync(patch, 'utf8').replace(/^\uFEFF/, '')
        const m = raw.match(/-\s*id:\s*settings[\s\S]*?path:\s*(.+)/)
        const p = m?.[1]?.trim()
        if (p && existsSync(p)) out.add(p)
      } catch { /* 单个 profile 坏不拖累其他 */ }
    }
    return [...out]
  } catch {
    return []
  }
}

/**
 * 当前插件安装所在 profile 的 cordis.patch.yml（新版 DSH 配置面）。
 * 插件自身位于 profile node_modules/.ent-plugin-cache 下，向上找含
 * dsh.profile.bundles 的 package.json 即 profile 根目录。
 */
function profileRootFromModule() {
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

/** 新版 DSH 的 profile patch 文件列表（通常只有一个）。
 *  ENT_PATCH_FILE 仅供测试注入，生产始终从插件安装位置向上解析。 */
export function profilePatchFiles() {
  if (process.env.ENT_PATCH_FILE) return [process.env.ENT_PATCH_FILE]
  const root = profileRootFromModule()
  return root ? [join(root, 'cordis.patch.yml')] : []
}

/** 读取 profile patch 顶层 YAML 数组（JSON 是 YAML 子集；支持整行注释头）。 */
function readProfilePatchDoc(file) {
  const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  const comments = []
  const bodyLines = []
  for (const line of raw.split('\n')) {
    if (/^\s*#/.test(line)) comments.push(line)
    else bodyLines.push(line)
  }
  const body = bodyLines.join('\n').trim()
  if (!body) return { comments, rows: [] }
  try {
    const rows = JSON.parse(body)
    if (!Array.isArray(rows)) return null
    return { comments, rows }
  } catch {
    return null
  }
}

/** 写回 profile patch：保留整行注释头，正文用 JSON 数组（合法 YAML） */
function writeProfilePatchDoc(file, comments, rows) {
  const head = comments.length ? comments.join('\n') + '\n' : ''
  writeTextAtomic(file, head + JSON.stringify(rows, null, 2) + '\n')
}

/** 按 id 合并 patch 行；config 是完整替换语义，只合并我们控制的子键 */
function mergePatchRows(rows, wantedRows) {
  const next = JSON.parse(JSON.stringify(rows))
  for (const wanted of wantedRows) {
    const idx = next.findIndex((r) => r && r.id === wanted.id && !r.insert)
    if (idx === -1) next.push(JSON.parse(JSON.stringify(wanted)))
    else next[idx] = { ...next[idx], ...wanted, config: { ...(next[idx].config ?? {}), ...(wanted.config ?? {}) } }
  }
  return next
}

/** 同步新版 DSH 的 profile patch：llm-pi-ai / agent-default-model / llm-deepseek */
export function syncEnterpriseProfilePatches(base, models) {
  for (const file of profilePatchFiles()) {
    try {
      const doc = readProfilePatchDoc(file)
      if (!doc) continue // 不是 JSON 可管理的 patch：保持旧 settings.yaml 路径，避免破坏用户配置
      const existingLlm = doc.rows.find((r) => r && r.id === 'llm-pi-ai' && !r.insert)
      const existingDeepseek = doc.rows.find((r) => r && r.id === 'llm-deepseek' && !r.insert)
      const rows = [
        {
          id: 'llm-pi-ai',
          name: '@deepseek-ai/dsh-llm-pi-ai',
          config: {
            providers: {
              ...(existingLlm?.config?.providers ?? {}),
              'ent-gateway': {
                displayName: '企业统一模型网关',
                apiKeyEnv: 'ENT_GATEWAY_TOKEN_V2',
                api: 'openai-completions',
                baseURL: base + '/v1',
                compat: { thinkingFormat: 'openai' },
                reasoning: 'off',
                models: models.map((m) => ({
                  id: m.id,
                  ...(m.name ? { name: m.name } : {}),
                  contextWindow: m.contextWindow ?? 128000,
                  maxTokens: m.maxTokens ?? 32768,
                  input: (Array.isArray(m.input) && m.input.length ? m.input : ['text']).filter((x) => x === 'text' || x === 'image'),
                  reasoningEfforts: m.reasoningEfforts,
                })),
              },
              // 双协议并存：Responses API 通道（/v1/responses），默认仍走 completions
              'ent-gateway-responses': {
                displayName: '企业统一模型网关 Responses',
                apiKeyEnv: 'ENT_GATEWAY_TOKEN_V2',
                api: 'openai-responses',
                baseURL: base + '/v1',
                models: models.map((m) => ({
                  id: m.id,
                  ...(m.name ? { name: m.name } : {}),
                  contextWindow: m.contextWindow ?? 128000,
                  maxTokens: m.maxTokens ?? 32768,
                  input: (Array.isArray(m.input) && m.input.length ? m.input : ['text']).filter((x) => x === 'text' || x === 'image'),
                  reasoningEfforts: m.reasoningEfforts,
                })),
              },
            },
          },
        },
        {
          id: 'llm-deepseek',
          name: '@deepseek-ai/dsh-llm-deepseek',
          config: { ...(existingDeepseek?.config ?? {}), models: [] },
        },
      ]
      const hasDefault = doc.rows.some((r) => r && r.id === 'agent-default-model')
      if (!hasDefault) {
        rows.push({
          id: 'agent-default-model',
          name: '@deepseek-ai/dsh-agent-default-model',
          config: { provider: 'ent-gateway', model: models[0].id },
        })
      }
      const merged = mergePatchRows(doc.rows, rows)
      if (JSON.stringify(merged) !== JSON.stringify(doc.rows)) {
        writeProfilePatchDoc(file, doc.comments, merged)
        ctxLoggerInfoSafe('[enterprise] 已同步新版 profile patch: ' + file)
      }
    } catch { /* 单个目标失败不影响其他 */ }
  }
}

/** 登出时清理新版 profile patch 中的企业网关配置 */
export function clearEnterpriseProfilePatches() {
  for (const file of profilePatchFiles()) {
    try {
      const doc = readProfilePatchDoc(file)
      if (!doc) continue
      let rows = JSON.parse(JSON.stringify(doc.rows))
      // llm-pi-ai：移除 ent-gateway；providers 为空对象保留骨架
      const llm = rows.find((r) => r && r.id === 'llm-pi-ai' && !r.insert)
      if (llm?.config?.providers) {
        for (const name of ['ent-gateway', 'ent-gateway-responses']) {
          if (Object.prototype.hasOwnProperty.call(llm.config.providers, name)) {
            delete llm.config.providers[name]
          }
        }
      }
      // agent-default-model：仅当仍指向企业网关时清理
      const adm = rows.find((r) => r && r.id === 'agent-default-model' && !r.insert)
      if (adm?.config?.provider === 'ent-gateway') {
        Reflect.deleteProperty(adm, 'config')
        if (Object.keys(adm).filter((k) => k !== 'id' && k !== 'name').length === 0) {
          rows = rows.filter((r) => r !== adm)
        }
      }
      if (JSON.stringify(rows) !== JSON.stringify(doc.rows)) {
        writeProfilePatchDoc(file, doc.comments, rows)
        ctxLoggerInfoSafe('[enterprise] 已清理新版 profile patch: ' + file)
      }
    } catch { /* 单个目标失败不影响其他 */ }
  }
}


export function syncOneMainSettingsProvider(mainSettings, base, models) {
  let raw = existsSync(mainSettings) ? readFileSync(mainSettings, 'utf8') : null
  if (raw === null) {
    // ENT_SETTINGS_PATH 指向的独立 settings 文件还不存在（新 profile 首次登录）：
    // 引导创建最小骨架再插入，而不是静默跳过——否则独立配置的实例永远拿不到 provider。
    // 未设 ENT_SETTINGS_PATH 时保持原行为（共享主配置不存在就让 DSH 自己生成，插件不动）。
    if (!process.env.ENT_SETTINGS_PATH) return
    raw = ['llm-pi-ai:', '  providers: {}', 'llm-deepseek:', '  models: []', ''].join('\n')
    writeTextAtomic(mainSettings, raw)
    ctxLoggerInfoSafe(`[enterprise] 独立 settings 文件不存在，已引导创建: ${mainSettings}`)
  }
  // 已存在则先移除旧块（双协议：completions + responses）
  raw = removeProviderFromSettingsYaml(raw, 'ent-gateway')
  raw = removeProviderFromSettingsYaml(raw, 'ent-gateway-responses')
  const lines = raw.split('\n')
  // 找 llm-pi-ai: → providers: 的行号
  let llmIdx = -1
  let provIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (llmIdx === -1 && /^llm-pi-ai:\s*$/.test(lines[i])) { llmIdx = i; continue }
    if (llmIdx !== -1 && provIdx === -1 && /^  providers:\s*$/.test(lines[i])) { provIdx = i; break }
    // 内联空对象形式（providers: {}）——清空模型后的干净状态，先展开成可插入形式
    if (llmIdx !== -1 && provIdx === -1 && /^  providers:\s*\{\}\s*$/.test(lines[i])) {
      lines[i] = '  providers:'
      provIdx = i
      break
    }
  }
  if (provIdx === -1) {
    // 全新机器的 settings.yaml 往往只有 ui-onboarding 等零散段，根本没有
    // llm-pi-ai:/providers: 骨架——此前在这里静默 return，导致登录成功但
    // provider 永远写不进主配置、模型选择器为空（220 实机复现）。这里补建骨架再插入。
    if (llmIdx === -1) {
      lines.push('', 'llm-pi-ai:', '  providers:')
      provIdx = lines.length - 1
    } else {
      // 有 llm-pi-ai: 段但缺 providers: 子键——在段头后补 providers:
      lines.splice(llmIdx + 1, 0, '  providers:')
      provIdx = llmIdx + 1
    }
  }
  // 构造 provider 块（4 空格缩进起，与现有 provider 块同级）
  // 模型元数据从网关 /v1/models 透传：input_modes（图片/视频等）、thinking_levels、context/maxTokens
  const modelLines = models.map((m) => {
    // input 已在拉取时过滤为 text/image；此处再兜底过滤一次，绝不让 video/audio 落盘
    const inputs = (Array.isArray(m.input) && m.input.length ? m.input : ['text'])
      .filter((x) => x === 'text' || x === 'image')
    const lines = [
      '        - id: ' + m.id,
      // DSH 选择器显示名：有网关 displayName 就写 name（yaml 值加引号防特殊字符破坏结构）
      ...(m.name ? ['          name: ' + JSON.stringify(String(m.name))] : []),
      '          contextWindow: ' + (m.contextWindow ?? 128000),
      '          maxTokens: ' + (m.maxTokens ?? 32768),
      '          input:',
      ...inputs.map((x) => '            - ' + x),
    ]
    // 思考档位：DSH 要求 reasoningEfforts 为 dict（档位→wire 值），不能是 list；
    // dict 必须含至少一个 off 以外的档位。布尔 false 形式会导致整个 llm-pi-ai 配置段
    // 被校验拒绝（实测），非思考模型一律省略该字段——缺省即视为非思考模型。
    // ⚠ 档位 key 白名单：宿主 schema 只接受 off|minimal|low|medium|high|xhigh|max，
    // 网关侧若给 thinkingLevels 配了其他档位（如 none），原样透传会让整段被拒、
    // 选择器全空且无显式报错（2026-09-15 实测）——未知档位一律丢弃。
    if (Array.isArray(m.thinking_levels) && m.thinking_levels.length) {
      const wire = { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }
      const beyondOff = m.thinking_levels.filter((lv) => lv !== 'off' && lv in wire)
      if (beyondOff.length) {
        lines.push('          reasoningEfforts:')
        lines.push('            off: none')
        for (const lv of beyondOff) {
          lines.push('            ' + lv + ': ' + wire[lv])
        }
      }
    }
    return lines
  }).flat()
  // 双协议并存：completions（默认）+ responses（/v1/responses 通道），同模型同凭证
  const block = [
    '    ent-gateway:',
    '      displayName: 企业统一模型网关',
    // 凭证引用名用 V2：快照层（历史 env 污染）查不到 V2 → 文件层永远生效（见 provider-config.js GATEWAY_KEY_REF）
    '      apiKeyEnv: ' + GATEWAY_KEY_REF,
    '      api: openai-completions',
    '      baseURL: ' + base + '/v1',
    '      compat:',
    '        thinkingFormat: openai',
    '      reasoning: off',
    '      models:',
    ...modelLines,
    '    ent-gateway-responses:',
    '      displayName: 企业统一模型网关 Responses',
    '      apiKeyEnv: ' + GATEWAY_KEY_REF,
    '      api: openai-responses',
    '      baseURL: ' + base + '/v1',
    '      models:',
    ...modelLines,
  ]
  lines.splice(provIdx + 1, 0, ...block)
  // 顶层 agent-default-model：不存在时设为网关默认模型（会话开箱即用）；
  // 已存在时**不覆盖**——用户在 DSH 里手动选过模型（user layer），
  // 管控默认只在首次配置生效，之后尊重用户选择
  if (!lines.some((l) => /^agent-default-model:/.test(l))) {
    lines.push('agent-default-model:', '  provider: ent-gateway', '  model: ' + models[0].id)
  }
  // 确保内置官方 deepseek 屏蔽段存在（llm-deepseek 自带整套 v4 模型目录，不屏蔽会绕过企业网关管控）
  if (!lines.some((l) => /^llm-deepseek:\s*$/.test(l))) {
    lines.push('llm-deepseek:', '  models: []')
  }
  ensureWelcomeNoticeSection(lines)
  ensureDesktopAdvancedMode(lines)
  writeTextAtomic(mainSettings, lines.join('\n'))
}

/** 用户端统一增强模式（dsh-desktop.mode: advanced，桌面专用布局）。
 *  宿主默认 compatibility（兼容模式）；已存在任何 mode 值（用户选过）则不覆盖。 */
export function ensureDesktopAdvancedMode(lines) {
  if (!lines.some((l) => /^dsh-desktop:\s*$/.test(l))) {
    lines.push('dsh-desktop:', '  mode: advanced')
    return
  }
  const idx = lines.findIndex((l) => /^dsh-desktop:\s*$/.test(l))
  const end = lines.findIndex((l, i) => i > idx && /^[^\s]/.test(l))
  const seg = lines.slice(idx + 1, end === -1 ? lines.length : end)
  if (!seg.some((l) => /^\s+mode:/.test(l))) {
    lines.splice(idx + 1, 0, '  mode: advanced')
  }
}

/** 宿主 WELCOME_NOTICE_VERSION（内测横幅横幅版本）——settings 里精确相等即不弹。
 *  宿主 bump 横幅版本时同步改这里。 */
export const WELCOME_NOTICE_VERSION = '2026-08-13.1'

/** 在 settings 行数组里确保 ui-onboarding.welcomeNoticeVersion 预签（无段补段/有段补键/已签不动） */
export function ensureWelcomeNoticeSection(lines) {
  if (!lines.some((l) => /^ui-onboarding:\s*$/.test(l))) {
    lines.push('ui-onboarding:', `  welcomeNoticeVersion: ${WELCOME_NOTICE_VERSION}`)
    return
  }
  const idx = lines.findIndex((l) => /^ui-onboarding:\s*$/.test(l))
  const end = lines.findIndex((l, i) => i > idx && /^[^\s]/.test(l))
  const seg = lines.slice(idx + 1, end === -1 ? lines.length : end)
  if (!seg.some((l) => /^\s+welcomeNoticeVersion:/.test(l))) {
    lines.splice(idx + 1, 0, `  welcomeNoticeVersion: ${WELCOME_NOTICE_VERSION}`)
  }
}

/** 插件激活即预签内测横幅 + 增强模式（不等到登录）——新装机在登录遮罩之前就会弹横幅，
 *  挂在登录流程里签不住这个时序。对主 settings 与所有 profile patch settings 生效。 */
export function ensureWelcomeNoticeAck() {
  const targets = new Set([dshSettingsFile()])
  for (const p of profilePatchSettingsPaths()) targets.add(p)
  for (const file of targets) {
    try {
      if (!existsSync(file)) continue // 目标尚未生成（全新 profile 未启动完）：登录流程会再签
      const raw = readFileSync(file, 'utf8')
      const lines = raw.split('\n')
      const before = lines.join('\n')
      ensureWelcomeNoticeSection(lines)
      ensureDesktopAdvancedMode(lines)
      const after = lines.join('\n')
      if (after !== before) {
        writeTextAtomic(file, after)
        ctxLoggerInfoSafe(`[enterprise] 已预签内测横幅回执 + 增强模式: ${file}`)
      }
    } catch { /* 单个目标失败不影响其他 */ }
  }
}
