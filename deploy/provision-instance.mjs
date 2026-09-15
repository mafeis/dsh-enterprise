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

// ---------- 1. 桌面向导回执 ----------
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
{
  const file = join(profileDir, 'settings.yaml')
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
    if (!/^dsh-desktop:/m.test(t)) {
      t += '\ndsh-desktop:\n  mode: advanced\n'
      changed = true
    } else if (!/^\s+mode:/m.test(t)) {
      t = t.replace(/^(dsh-desktop:\s*$)/m, '$1\n  mode: advanced')
      changed = true
    }
    if (changed) { writeFileSync(file, t); done.push('settings 预签（横幅回执 + 增强模式）') }
    else done.push('settings 预签（已齐，跳过）')
  } else {
    // settings.yaml 尚未生成（宿主首次启动才有骨架）：预建最小骨架。
    // 不预建的话宿主本次启动读不到回执 → 内测横幅在登录前弹一次（ent5 实测）。
    // 骨架含 llm-deepseek 屏蔽段；登录时 syncOneMainSettingsProvider 走"已存在"分支正常插入 provider。
    const skeleton = [
      'ui-onboarding:',
      '  welcomeNoticeVersion: ' + WELCOME_NOTICE_VERSION,
      'dsh-desktop:',
      '  mode: advanced',
      'llm-deepseek:',
      '  models: []',
      '',
    ].join('\n')
    writeFileSync(file, skeleton)
    done.push('settings 预建骨架（横幅回执 + 增强模式 + deepseek 屏蔽）')
  }
}

console.log('预置完成:')
for (const d of done) console.log('  ✓ ' + d)
