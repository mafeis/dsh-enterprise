#!/usr/bin/env pwsh
<#
.SYNOPSIS
  企业版新实例一键交付（冷启动）：写骨架 → 装插件 → 预置首启状态 → 单次启动。
.DESCRIPTION
  解决"宿主启动读状态早于插件激活写入"的时序问题：首启体验（向导回执/横幅回执/
  默认工作区/增强模式/默认网关）必须在正式启动之前落盘。冷启动流水线全程只有
  最后一次启动（骨架文件由 provision 脚本直接写，不再需要先跑一次宿主生成）：

    1. 建骨架      home + 启动脚本 + profile 骨架文件（纯写文件，不启动）
    2. 装插件      dsh-enterprise(构建产物) + hot-reload + startup-guard（标准装法）
    3. 预置状态    provision-instance.mjs（向导回执+模式首选项+工作区+网关+settings）
    4. 正式启动    带插件的唯一一次启动——第一屏即终态

.PARAMETER Name        实例名（如 ent5）：home=C:\Users\<user>\.<Name>，userData=C:\Users\<user>\.dsh-desktop-<Name>
.PARAMETER PluginSrc   dsh-enterprise-plugin 仓库路径（取 lib 构建产物）
.PARAMETER HelperFrom  参照实例的 profiles\desktop（取 hot-reload / startup-guard 实体目录）
.PARAMETER Gateway      出厂默认网关地址（登录页预填），默认 http://10.102.101.42:8890
.EXAMPLE
  .\new-instance.ps1 -Name ent8 -PluginSrc D:\mafei\企业版\dsh-enterprise-plugin -HelperFrom C:\Users\Administrator\.dsh-ent2\profiles\desktop
#>
param(
  [Parameter(Mandatory)][string]$Name,
  [Parameter(Mandatory)][string]$PluginSrc,
  [Parameter(Mandatory)][string]$HelperFrom,
  [string]$Gateway = 'http://10.102.101.42:8890'
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
  # 等进程真正退出（轮询至 0，最长 20s）——宿主退出途中会异步写盘（settings 归一化），
  # 固定 sleep 不够：退出写盘晚于预置会顶掉预置值（ent6 实测 mode 被写回 compatibility）
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    $left = (Get-CimInstance Win32_Process -Filter "Name like 'DSH%'" |
      Where-Object { $_.CommandLine -like ("*dsh-desktop-" + $Name + "*") } | Measure-Object).Count
    if ($left -eq 0) { break }
    Start-Sleep 1
  }
  Start-Sleep 2  # 退出写盘缓冲
}

Write-Host "== 1/4 骨架（纯写文件，不启动宿主）==" -ForegroundColor Cyan
Write-Host "   profile 目录已备好"

Write-Host "== 2/4 装插件（标准装法：无 BOM / file: 引用 / pnpm offline）==" -ForegroundColor Cyan
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

Write-Host "== 3/4 预置首启状态（向导回执/模式首选项/默认工作区/网关预填/settings）==" -ForegroundColor Cyan
$env:ENT_GATEWAY_PRESET = $Gateway
node "$PluginSrc\deploy\provision-instance.mjs" $home4 $userData desktop
Remove-Item Env:ENT_GATEWAY_PRESET -ErrorAction SilentlyContinue

Write-Host "== 4/4 正式启动（唯一一次启动）==" -ForegroundColor Cyan
Start-Process cmd -ArgumentList "/c", $cmd -WindowStyle Hidden
Start-Sleep 35
$ports = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -ge 43120 -and $_.LocalPort -le 43139 } |
  Select-Object -ExpandProperty LocalPort | Sort-Object
Write-Host "完成。实例 $Name 运行中。打开 http://127.0.0.1:$($ports[-1]) 即首启终态（无弹窗+增强模式），登录后模型/工作区全就位" -ForegroundColor Green
