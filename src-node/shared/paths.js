/**
 * 路径解析：DSH home / settings / 凭证 / 插件状态。
 * 所有落盘位置的唯一出处，其他模块一律从这里拿路径，禁止自己拼。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

export function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** 当前 profile 实际生效的 settings.yaml 路径：
 *  profile 用 cordis.patch.yml 把 settings 服务指向独立文件时（ENT_SETTINGS_PATH），
 *  插件的 provider 写入必须跟随该文件，否则写进全局导致其他实例被污染、本实例看不到。
 */
export function dshSettingsFile() {
  return process.env.ENT_SETTINGS_PATH ?? join(dshHome(), 'settings.yaml')
}

/** 企业托管 provider 定义文件（enterprise-settings.yaml，JSON 宽容格式） */
export function entSettingsFile() {
  return join(dshHome(), 'enterprise', 'enterprise-settings.yaml')
}

/** 企业网关 JWT 所在的凭证文件（.credentials.yaml，refs 段） */
export function credentialsFile() {
  return join(dshHome(), '.credentials.yaml')
}

/** 插件状态持久化文件（设置页 + 心跳用） */
export function statePath() {
  return join(dshHome(), 'enterprise', 'enterprise-state.json')
}
