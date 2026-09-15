#!/usr/bin/env node
/**
 * 企业版新实例交付预置脚本（装机时跑一次，先于桌面首次启动）。
 *
 * 背景（2026-09-15 ent4 实测）：宿主在启动时读取全部状态，插件激活在其后——
 * 插件运行时写入的任何首启体验项（内测横幅回执 / 桌面向导回执 / 默认工作区 /
 * 增强模式）都要等下一次重启才生效。新装机第一屏永远是旧的。
 * 因此首启体验必须在"首次启动之前"由本脚本落盘：
 *
 *   1. 桌面向导回执  <userData>\profile-setup\<sha256(profileDir)>\state.json (outcome=skipped)
 *   2. 默认工作区    <DSH_HOME>\storages\workspace.json（为空且默认目录存在时注册）
 *   3. settings 预签 <profile>\settings.yaml：ui-onboarding.welcomeNoticeVersion + dsh-desktop.mode: advanced
 *
 * 用法：node provision-instance.cjs <DSH_HOME> <userDataDir> [profileName=desktop]
 * 前置：桌面至少启动过一次（profile 骨架已生成）或先用启动脚本拉起再关闭。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'

const WELCOME_NOTICE_VERSION = '2026-08-13.1' // 宿主 bump 横幅版本时同步改

const [, , dshHomeArg, userDataArg, profileName = 'desktop'] = process.argv
if (!dshHomeArg || !userDataArg) {
  console.error('用法: node provision-instance.cjs <DSH_HOME> <userDataDir> [profileName=desktop]')
  process.exit(1)
}
const dshHome = dshHomeArg.replace(/[/\\]+$/, '')
const profileDir = join(dshHome, 'profiles', profileName)
if (!existsSync(profileDir)) {
  console.error(`profile 不存在: ${profileDir}（先启动一次桌面生成骨架，关掉再跑本脚本）`)
  process.exit(1)
}

let done = []

// ---------- 1. 桌面向导回执 + 桌面模式首选项（真正的持久层） ----------
{
  const hash = createHash('sha256').update(profileDir).digest('hex')
  const dir = join(userDataArg, 'profile-setup', hash)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'state.json')
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify({
      version: 2, profileHash: hash, outcome: 'skipped',
      desktopVersion: '2.0.9', dshVersion: '0.1.5-rc.1', setupRevision: 1,
      recordedAt: new Date().toISOString(),
    }, null, 2))
    done.push(`桌面向导回执（${hash.slice(0, 12)}…）`)
  } else done.push('桌面向导回执（已存在，跳过）')

  // ⚠ dsh-desktop.mode 的真正持久层是 userData\profile-preferences\<profileHash>\state.json，
  //   settings.yaml 的 dsh-desktop 段只是宿主启动时的投影（改 settings.yaml 主不动=不生效，ent7 实证）。
  //   预置这里 → 宿主首启读到 advanced → 一次启动即终态，无需二次重启。
  const pfDir = join(userDataArg, 'profile-preferences', hash)
  const pfFile = join(pfDir, 'state.json')
  if (!existsSync(pfFile)) {
    mkdirSync(pfDir, { recursive: true })
    writeFileSync(pfFile, JSON.stringify({
      version: 1, profileHash: hash, mode: 'advanced',
      openBrowser: false, networkExposure: 'loopback',
      notifications: {
        enabled: true, notifyOnTurnCompletion: true, notifyOnTurnFailure: true,
        notifyOnJobCompletion: true, notifyOnJobFailure: true,
      },
      aaEnabled: false, market: 'disabled',
      recordedAt: new Date().toISOString(),
    }, null, 2))
    done.push(`桌面模式首选项（增强模式，${hash.slice(0, 12)}…）`)
  } else {
    const cur = (() => { try { return JSON.parse(readFileSync(pfFile, 'utf8'))?.mode } catch { return null } })()
    if (cur === 'compatibility') {
      // 宿主骨架启动落盘的默认值，不是员工选择——覆盖为 advanced（员工自己改过的不动）
      const j = JSON.parse(readFileSync(pfFile, 'utf8'))
      j.mode = 'advanced'
      writeFileSync(pfFile, JSON.stringify(j, null, 2))
      done.push('桌面模式首选项（默认 compatibility → 增强模式）')
    } else done.push('桌面模式首选项（已有，跳过）')
  }
}

// ---------- 2. 默认工作区 ----------
{
  const file = join(dshHome, 'storages', 'workspace.json')
  if (existsSync(file)) {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    if ((j?.global?.workspaceIds ?? []).length === 0) {
      const candidates = process.platform === 'win32'
        ? ['D:\\dsh-workspace', 'C:\\dsh-workspace']
        : [join(process.env.HOME ?? process.env.USERPROFILE ?? '', 'dsh-workspace')]
      const dir = candidates.find((d) => existsSync(d))
      if (dir) {
        const id = crypto.randomUUID()
        j.global = j.global ?? {}
        j.global.initialized = true
        j.global.workspaceIds = [id]
        j.tables = j.tables ?? {}
        j.tables.workspaces = j.tables.workspaces ?? {}
        j.tables.workspaces[id] = {
          path: dir, title: basename(dir), sessionIds: [],
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }
        writeFileSync(file, JSON.stringify(j, null, 2))
        done.push(`默认工作区 ${dir}`)
      } else done.push('默认工作区（候选目录不存在，跳过）')
    } else done.push('默认工作区（已有工作区，跳过）')
  } else done.push('默认工作区（storages 未初始化，登录后插件会注册）')
}

// ---------- 3. settings 预签（ui-onboarding + dsh-desktop.mode） ----------
// ⚠ 时序真相（ent6 复盘）：骨架启动时宿主生成默认 settings（dsh-desktop.mode=compatibility
//   整段落盘）；预置在其后跑，"段存在且有 mode 键→尊重不覆盖"的守卫导致 advanced 永远写不进。
//   compatibility 在这里是宿主默认落盘，不是员工选择——新装机交付要覆盖为 advanced。
//   区分依据：enterprise-state.json 无 user = 员工从未自己登录配置过 → 可安全覆盖。
{
  const file = join(profileDir, 'settings.yaml')
  const stateFile = join(dshHome, 'enterprise', 'enterprise-state.json')
  const userConfigured = (() => {
    try { return JSON.parse(readFileSync(stateFile, 'utf8'))?.user != null } catch { return false }
  })()
  if (existsSync(file)) {
    let t = readFileSync(file, 'utf8')
    let changed = false
    if (!/^ui-onboarding:/m.test(t)) {
      t += '\nui-onboarding:\n  welcomeNoticeVersion: ' + WELCOME_NOTICE_VERSION + '\n'
      changed = true
    } else if (!/^\s+welcomeNoticeVersion:/m.test(t)) {
      t = t.replace(/^(ui-onboarding:\s*$)/m, '$1\n  welcomeNoticeVersion: ' + WELCOME_NOTICE_VERSION)
      changed = true
    }
    if (!userConfigured) {
      if (!/^dsh-desktop:/m.test(t)) {
        t += '\ndsh-desktop:\n  mode: advanced\n'
        changed = true
      } else if (/^\s+mode:\s*compatibility\s*$/m.test(t)) {
        t = t.replace(/^(\s+)mode:\s*compatibility\s*$/m, '$1mode: advanced')
        changed = true
      } else if (!/^\s+mode:/m.test(t)) {
        t = t.replace(/^(dsh-desktop:\s*$)/m, '$1\n  mode: advanced')
        changed = true
      }
    }
    if (changed) { writeFileSync(file, t); done.push('settings 预签（横幅回执' + (userConfigured ? '' : ' + 增强模式') + '）') }
    else done.push('settings 预签（已齐，跳过）')
  } else {
    // settings.yaml 尚未生成（宿主首次启动才有骨架）：预建最小骨架。
    // 不预建的话宿主本次启动读不到回执 → 内测横幅在登录前弹一次（ent5 实测）。
    // 骨架含 llm-deepseek 屏蔽段；登录时 syncOneMainSettingsProvider 走"已存在"分支正常插入 provider。
    // ⚠ 不写 dsh-desktop 段：mode 的主持久层是 profile-preferences state.json（上面已预置），
    //   settings.yaml 的段由宿主从 state.json 投影生成。
    const skeleton = [
      'ui-onboarding:',
      '  welcomeNoticeVersion: ' + WELCOME_NOTICE_VERSION,
      'llm-deepseek:',
      '  models: []',
      '',
    ].join('\n')
    writeFileSync(file, skeleton)
    done.push('settings 预建骨架（横幅回执 + deepseek 屏蔽；增强模式在 profile-preferences）')
  }
}

// ---------- 4. 默认网关地址（登录页预填） ----------
// 登录页 server 输入框从 /api/enterprise/status 取 state.gateway 预填；登录提交缺省也用它。
// 预置 enterprise-state.json = 员工打开登录页时网关地址已经填好，只输账号密码。
// 已登录过（有 user）绝不动；已有 gateway 也不动（保留上次使用的网关语义）。
{
  const file = join(dshHome, 'enterprise', 'enterprise-state.json')
  const gateway = process.env.ENT_GATEWAY_PRESET ?? ''
  if (gateway) {
    let cur = {}
    try { cur = JSON.parse(readFileSync(file, 'utf8')) ?? {} } catch { /* 损坏视为空 */ }
    if (cur.user != null) done.push('默认网关（已登录，跳过）')
    else if (cur.gateway) done.push(`默认网关（已有 ${cur.gateway}，跳过）`)
    else {
      mkdirSync(join(dshHome, 'enterprise'), { recursive: true })
      writeFileSync(file, JSON.stringify({ ...cur, gateway }, null, 2))
      done.push(`默认网关 ${gateway}（登录页预填）`)
    }
  }
}

console.log('预置完成:')
for (const d of done) console.log('  ✓ ' + d)
