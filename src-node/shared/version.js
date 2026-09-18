/** 插件版本：与 package.json 的 version 保持一致（发新版本时两处一起改）。
 *  心跳上报（device.pluginVersion）与就绪日志使用。
 *  0.9.8：desktopCliBootstrap 支持 macOS（Contents/MacOS 布局）与 2.0.11 解包 app/ 目录，
 *  修复 Mac 上插件市场自助安装报「未找到宿主 DSH Desktop」。
 */
export const VERSION = '0.9.8'
