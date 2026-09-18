/** 插件版本：与 package.json 的 version 保持一致（发新版本时两处一起改）。
 *  心跳上报（device.pluginVersion）与就绪日志使用。
 *  0.9.9：插件自动更新——心跳发现网关插件仓库有新版本即后台静默安装，
 *  UI 提示重启生效（自本版本起，后续升级全走自动通道，无需重跑安装脚本）。
 */
export const VERSION = '0.9.11'
