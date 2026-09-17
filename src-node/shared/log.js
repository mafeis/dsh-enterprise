/**
 * 独立落盘日志：%LOCALAPPDATA%\DSH-Enterprise\client-log.txt
 *  用户/管理员排查就认这一个文件（安装日志 install-log.txt 在同目录）。
 *  全部关键动作落盘：登录/登出/对账/自愈/指纹重配/规则拦截/心跳异常。
 *  1MB 轮转：超过后改名 .old 覆盖，最多留两份。
 *
 *  hostLogger 由插件入口 apply 时注入（setHostLogger），落盘同时镜像一条到宿主日志。
 */
import { existsSync, mkdirSync, statSync, renameSync, unlinkSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './paths.js'

let hostLogger = null
let pluginLogFile = null

/** 插件入口把宿主 ctx.logger 交给日志模块（apply 时调用一次） */
export function setHostLogger(logger) {
  hostLogger = logger
}

export function pluginLog(msg) {
  try {
    if (!pluginLogFile) {
      const dir = join(process.env.LOCALAPPDATA ?? dshHome(), 'DSH-Enterprise')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      pluginLogFile = join(dir, 'client-log.txt')
    }
    if (existsSync(pluginLogFile) && statSync(pluginLogFile).size > 1024 * 1024) {
      const old = pluginLogFile.replace(/\.txt$/, '.old.txt')
      try { if (existsSync(old)) unlinkSync(old) } catch {}
      try { renameSync(pluginLogFile, old) } catch {}
    }
    const line = `[${new Date().toISOString()}] [pid ${process.pid}] ${msg}\r\n`
    appendFileSync(pluginLogFile, line, 'utf8')
  } catch { /* 日志失败绝不影响业务 */ }
  try { hostLogger?.info?.(`[enterprise] ${msg}`) } catch {}
}

/** 兼容旧调用点：全部转独立落盘日志 */
export function ctxLoggerInfoSafe(msg) { pluginLog(msg) }
