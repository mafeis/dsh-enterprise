/** 设备信息采集（心跳上报用）+ 本机已安装插件清单（插件管控比对用） */
import { existsSync, readFileSync } from 'node:fs'
import { VERSION } from '../shared/version.js'

/** 本机已安装的 DSH 插件清单：
 *  从插件自身位置（profiles/<name>/node_modules/<plugin>/lib/...）向上找
 *  含 dsh.profile.bundles 的 package.json（即 profile 根），读出 bundle 名列表。
 *  找不到（如全局安装形态）返回 null——调用方按「未知」处理，不误报违规。
 */
export function collectInstalledPlugins() {
  try {
    let p = new URL('.', import.meta.url) // 本模块所在目录（lib/<sub>/）
    for (let i = 0; i < 6; i++) {
      p = new URL('../', p) // 逐级向上
      const pkgPath = decodeURIComponent(p.pathname.replace(/^\/([A-Za-z]:)/, '$1')) + 'package.json'
      if (!existsSync(pkgPath)) continue
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        const bundles = pkg?.dsh?.profile?.bundles
        if (Array.isArray(bundles)) return bundles
      } catch { /* 下一个目录 */ }
    }
    return null
  } catch { return null }
}

/** 清空采集缓存（插件管控清理后调用）：让下一次心跳重新采集、带上更新后的插件清单 */
export function resetDeviceInfoCache() { deviceInfoCache = null }

/** 采集设备信息（心跳上报用）——尽量多采集，一次采集进程内缓存 */
let deviceInfoCache = null
export async function collectDeviceInfo() {
  if (deviceInfoCache) return deviceInfoCache
  const os = await import('node:os')
  const info = {
    hostname: os.hostname() ?? '',
    platform: `${os.platform()} ${os.arch()}`,
    osRelease: os.release() ?? '',
    osVersion: (os.version && os.version()) || '',
    cpuModel: (os.cpus()[0]?.model ?? '').replace(/\s+/g, ' ').trim(),
    cpuCores: os.cpus().length,
    memTotalGb: Math.round((os.totalmem() / 1073741824) * 10) / 10,
    memFreeGb: Math.round((os.freemem() / 1073741824) * 10) / 10,
    uptimeH: Math.round(os.uptime() / 3600),
    dshVersion: process.env.DSH_VERSION ?? process.env.npm_package_version ?? '',
    pluginVersion: VERSION,
    // 已安装插件清单：插件管控（允许清单比对）用；找不到时为 null（未知，不算违规）
    plugins: collectInstalledPlugins(),
  }
  // IP 地址（非内网回环的所有 IPv4）
  try {
    const nets = os.networkInterfaces()
    info.ips = Object.values(nets).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address)
  } catch { info.ips = [] }
  // 磁盘剩余（Windows 主要盘符，尽力而为）
  try {
    const { execFileSync } = await import('node:child_process')
    const out = execFileSync('wmic', ['logicaldisk', 'get', 'caption,freespace,size', '/format:csv'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString()
    const disks = out.split('\n').map((l) => l.trim().split(',')).filter((p) => p.length >= 3 && /^[A-Z]:$/.test(p[1] ?? '')).map((p) => ({
      drive: p[1],
      freeGb: Math.round((Number(p[2]) / 1073741824) * 10) / 10,
      totalGb: Math.round((Number(p[3]) / 1073741824) * 10) / 10,
    }))
    info.disks = disks
  } catch { info.disks = [] }
  deviceInfoCache = info
  return info
}
