#!/usr/bin/env pwsh
<#
.SYNOPSIS
  企业版新实例一键交付：生成骨架 → 停 → 装插件 → 预置首启状态 → 正式启动。
.DESCRIPTION
  解决"宿主启动读状态早于插件激活写入"的时序问题：首启体验（向导回执/横幅回执/
  默认工作区/增强模式）必须在正式启动之前落盘。本脚本串起完整流水线：

    1. 骨架启动    拉起桌面生成 profile 骨架（首启，无插件）
    2. 停实例      等骨架生成后关掉
    3. 装插件      dsh-enterprise(构建产物) + hot-reload + startup-guard（标准装法）
    4. 预置状态    provision-instance.mjs（向导回执 + 默认工作区 + settings 预签）
    5. 正式启动    带插件的最终启动——第一屏即终态

.PARAMETER Name        实例名（如 ent5）：home=C:\Users\<user>\.<Name>，userData=C:\Users\<user>\.dsh-desktop-<Name>
.PARAMETER PluginSrc   dsh-enterprise-plugin 仓库路径（取 lib 构建产物）
.PARAMETER HelperFrom  参照实例的 profiles\desktop（取 hot-reload / startup-guard 实体目录）
.EXAMPLE
  .\new-instance.ps1 -Name ent5 -PluginSrc D:\mafei\企业版\dsh-enterprise-plugin -HelperFrom C:\Users\Administrator\.dsh-ent2\profiles\desktop
#>
param(
  [Parameter(Mandatory)][string]$Name,
  [Parameter(Mandatory)][string]$PluginSrc,
  [Parameter(Mandatory)][string]$HelperFrom
)
$ErrorActionPreference = 'Stop'
$home4 = Join-Path $env:USERPROFILE (".dsh-" + $Name)
$cmd = Join-Path $home4 'start-ent-desktop.cmd'
$userData = Join-Path $env:USERPROFILE (".dsh-desktop-" + $Name)
$profileDir = Join-Path $home4 'profiles\desktop'
$exe = "$env:LOCALAPPDATA\Programs\DSH Desktop\DSH Desktop.exe"

# 全自动建 home + 启动脚本（不存在时）——一步到位，不再要求手工预建
if (-not (Test-Path $cmd)) {
  New-Item -ItemType Directory -Path $home4 -Force | Out-Null
  $q = [char]34
  $lines = '@echo off', "set ${q}DSH_HOME=$home4$q", "start ${q}${q} ${q}$exe$q --user-data-dir=$userData"
  [System.IO.File]::WriteAllBytes($cmd, [System.Text.Encoding]::ASCII.GetBytes(($lines -join "`r`n")))
  Write-Host "已创建 $cmd"
}

function Stop-Instance {
  Get-CimInstance Win32_Process -Filter "Name like 'DSH%'" |
    Where-Object { $_.CommandLine -like ("*dsh-desktop-" + $Name + "*") } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep 4
}

Write-Host "== 1/5 骨架启动（生成 profile，无插件首启）==" -ForegroundColor Cyan
if (-not (Test-Path "$profileDir\package.json")) {
  Start-Process cmd -ArgumentList "/c", $cmd -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline -and -not (Test-Path "$profileDir\package.json")) { Start-Sleep 2 }
  Start-Sleep 5   # 等宿主把 profile-setup / storages 等首启目录写完
  Stop-Instance
  Start-Sleep 2   # 等宿主进程完全退出（退出途中可能清理 profile-setup）
  Write-Host "   profile 骨架已生成"
  # 骨架启动会弹"欢迎/开始设置"向导（无回执）——宿主退出时可能留下向导窗口进程，
  # 双重确认全部清干净，否则残留进程会在预置后清掉回执（ent5 实测）
  Stop-Instance
} else { Write-Host "   profile 已存在，跳过" }

Write-Host "== 2/5 已停实例 ==" -ForegroundColor Cyan

Write-Host "== 3/5 装插件（标准装法：无 BOM / file: 引用 / pnpm offline）==" -ForegroundColor Cyan
New-Item -ItemType Directory -Path "$profileDir\node_modules\dsh-enterprise" -Force | Out-Null
robocopy "$PluginSrc\lib" "$profileDir\node_modules\dsh-enterprise\lib" /MIR /NJH /NJS /NDL | Out-Null
Copy-Item "$PluginSrc\package.json","$PluginSrc\cordis.patch.yml" "$profileDir\node_modules\dsh-enterprise\" -Force
foreach ($h in 'dsh-hot-reload','dsh-startup-guard') {
  if (Test-Path "$HelperFrom\node_modules\$h") { Copy-Item "$HelperFrom\node_modules\$h" "$profileDir\node_modules\" -Recurse -Force }
}
$ver = (Get-Content "$PluginSrc\package.json" -Raw | ConvertFrom-Json).version
node -e "
const fs = require('fs')
const p = process.argv[1]
const deps = { 'dsh-enterprise': 'file:./node_modules/dsh-enterprise' }
for (const h of ['dsh-hot-reload','dsh-startup-guard']) {
  if (fs.existsSync(p + '/node_modules/' + h)) deps[h] = 'file:./node_modules/' + h
}
fs.writeFileSync(p + '/package.json', JSON.stringify({
  name: 'dsh-profile-desktop', private: true,
  dependencies: deps,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app', ...Object.keys(deps)], patchReload: 'live' } }
}, null, 2))
fs.writeFileSync(p + '/cordis.patch.yml', '# desktop profile: settings 指向本 profile 自身' + String.fromCharCode(10) + '- id: settings' + String.fromCharCode(10) + '  config:' + String.fromCharCode(10) + '    path: ' + p.replace(/\//g, '\\') + String.fromCharCode(92) + 'settings.yaml' + String.fromCharCode(10))
" $profileDir
Push-Location $profileDir; pnpm install --offline 2>&1 | Select-Object -Last 1; Pop-Location
Write-Host "   dsh-enterprise@$ver 已装"

Write-Host "== 4/5 预置首启状态（向导回执/默认工作区/横幅+增强模式）==" -ForegroundColor Cyan
node "$PluginSrc\deploy\provision-instance.mjs" $home4 $userData desktop

Write-Host "== 5/5 正式启动（增强模式由插件激活写入，自动重启一次生效）==" -ForegroundColor Cyan
Start-Process cmd -ArgumentList "/c", $cmd -WindowStyle Hidden
Start-Sleep 35
# 插件 activation 已把 dsh-desktop.mode=advanced 写入 settings（宿主首启读的预置骨架没有 mode）——
# 重启一次让宿主读到增强模式；顺带让全部回执在"宿主读状态"时序里就位
Stop-Instance
Start-Process cmd -ArgumentList "/c", $cmd -WindowStyle Hidden
Start-Sleep 35
$ports = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -ge 43120 -and $_.LocalPort -le 43139 } |
  Select-Object -ExpandProperty LocalPort | Sort-Object
Write-Host "完成。实例 $Name 运行中。打开 http://127.0.0.1:$($ports[-1]) 即首启终态（无弹窗+增强模式），登录后模型/工作区全就位" -ForegroundColor Green
