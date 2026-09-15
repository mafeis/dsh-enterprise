/** 企业托管 provider / 凭证的写入与清理 */
import { existsSync, readFileSync, chmodSync } from 'node:fs'
import { writeTextAtomic, readJsonSafe } from '../shared/fs-utils.js'
import { entSettingsFile, credentialsFile } from '../shared/paths.js'
import { pluginLog } from '../shared/log.js'
import { syncMainSettingsProvider } from './yaml-edit.js'

/** 写 enterprise-settings.yaml（插件托管层）+ 同步主 settings.yaml（llm-pi-ai 运行时解析处） */
export function writeProviderConfig(base, models) {
  const settingsPath = entSettingsFile()
  const settings = readJsonSafe(settingsPath) ?? {}
  settings['agent-default-model'] = { provider: 'ent-gateway', model: models[0].id, reasoningEffort: 'low' }
  settings.providers = settings.providers ?? {}
  settings.providers['ent-gateway'] = {
    displayName: '企业统一模型网关',
    api: 'openai-completions',
    apiKeyEnv: 'ENT_GATEWAY_TOKEN',
    baseUrl: base,
    compat: { thinkingFormat: 'openai' },
    models,
  }
  writeTextAtomic(settingsPath, JSON.stringify(settings, null, 2))
  // 同步主 settings.yaml（llm-pi-ai 运行时从这里解析 provider）——与 logout 的清理对称
  syncMainSettingsProvider(base, models)
}

/** 把 ENT_GATEWAY_TOKEN 写进 .credentials.yaml 的 refs 段（存在则覆盖，不存在则补 refs: 骨架） */
export function writeCredential(token) {
  const credPath = credentialsFile()
  let credRaw = existsSync(credPath) ? readFileSync(credPath, 'utf8') : 'refs:\n'
  if (!/^refs:/m.test(credRaw)) credRaw = 'refs:\n' + credRaw
  if (/^\s*ENT_GATEWAY_TOKEN:/m.test(credRaw)) {
    credRaw = credRaw.replace(/^(\s*ENT_GATEWAY_TOKEN:\s*).*$/m, `$1${token}`)
  } else {
    credRaw = credRaw.replace(/^(refs:\s*)$/m, `$1\n  ENT_GATEWAY_TOKEN: ${token}`)
    if (!/ENT_GATEWAY_TOKEN/.test(credRaw)) credRaw += `\n  ENT_GATEWAY_TOKEN: ${token}`
  }
  writeTextAtomic(credPath, credRaw)
  // POSIX：凭证文件必须 owner-only（600）。首次新建时原子写按 umask 落成 644，
  // 下次启动宿主 credentials-local 会直接拒绝加载（Mac 实测）。
  if (process.platform !== 'win32') {
    try { chmodSync(credPath, 0o600) } catch { /* 尽力而为 */ }
  }
}

/** DeepSeek 官方占位 key：全新机器 .credentials.yaml 没有 DEEPSEEK_API_KEY 时，
 *  主界面首启（登录框出现的同时）会弹官方"配置 API key"引导框。塞一个随机占位
 *  key 让其判定为已配置、永不弹；企业登录同步后官方卡片被隐藏，占位 key 不会被用到。
 */
export function ensurePlaceholderDeepseekKey() {
  try {
    const credPath = credentialsFile()
    let raw = existsSync(credPath) ? readFileSync(credPath, 'utf8') : 'version: 1\nrefs:\n'
    if (!/^\s*DEEPSEEK_API_KEY:/m.test(raw)) {
      if (!/^refs:/m.test(raw)) {
        // 文件已有 `version: 1` 头（新版 credentials-local 布局）时，把 refs: 插在
        // version 行之后；绝不能再前插一份 `version: 1`（DUPLICATE_KEY 会炸掉整个
        // credentials 服务，插件树加载失败）。老扁平布局才在文件头补 version+refs。
        if (/^version:\s*1\s*$/m.test(raw)) raw = raw.replace(/^(version:\s*1\s*)$/m, '$1\nrefs:')
        else raw = 'version: 1\nrefs:\n' + raw
      }
      const rnd = Array.from({ length: 24 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('')
      raw = raw.replace(/^(refs:\s*)$/m, `$1\n  DEEPSEEK_API_KEY: sk-${rnd}`)
      writeTextAtomic(credPath, raw)
      pluginLog('已写入 DeepSeek 官方占位 key（阻止首启"配置 API key"弹窗）')
    }
  } catch { /* 占位失败不影响其他功能 */ }
}
