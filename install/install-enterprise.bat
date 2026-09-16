@echo off
rem ============================================================
rem  dsh-enterprise 一键安装脚本（Windows）
rem  用途：员工终端双击运行，从 npm 安装企业管理插件到 DSH
rem  流程：检查环境 -> npm pack 拉包 -> 解包 -> dsh plugin add
rem ============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul
title DSH 企业管理插件安装

set "PKG_NAME=dsh-enterprise"
rem 私有 npm 仓库地址：迁移到网关服务器后，把 127.0.0.1 换成服务器 IP
set "REGISTRY=http://127.0.0.1:4873/"

echo.
echo ============================================
echo   DSH 企业管理插件 一键安装
echo ============================================
echo.

rem ---------- 1. 环境检查 ----------
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/
    goto :fail
)
where npm >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 npm，请确认 Node.js 安装完整。
    goto :fail
)
where dsh >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 dsh 命令，请先安装 DSH 终端。
    goto :fail
)

for /f "delims=" %%v in ('node --version') do set "NODE_VER=%%v"
echo [1/4] 环境检查通过（Node %NODE_VER%）

rem ---------- 2. 从 npm 拉取插件包 ----------
set "WORK=%TEMP%\dsh-enterprise-install"
if exist "%WORK%" rmdir /s /q "%WORK%"
mkdir "%WORK%" 2>nul

echo [2/4] 正在从 npm 拉取 %PKG_NAME%@latest ...
pushd "%WORK%"
call npm pack %PKG_NAME%@latest --registry=%REGISTRY%
if errorlevel 1 (
    echo [错误] 拉取失败，请检查网络后重试。
    popd
    goto :fail
)

set "TGZ="
for %%f in (%PKG_NAME%-*.tgz) do set "TGZ=%%f"
if not defined TGZ (
    echo [错误] 未找到下载的安装包。
    popd
    goto :fail
)

rem ---------- 3. 解包 ----------
echo [3/4] 解包 %TGZ% ...
tar -xzf "%TGZ%"
if errorlevel 1 (
    echo [错误] 解包失败。
    popd
    goto :fail
)
popd
if not exist "%WORK%\package\lib\index.js" (
    echo [错误] 安装包内容不完整（缺少 lib\index.js）。
    goto :fail
)

rem ---------- 4. 安装到 DSH ----------
echo [4/4] 安装到 DSH ...
call dsh plugin add file:"%WORK%\package"
if errorlevel 1 (
    echo [错误] dsh plugin add 失败，请把上方报错截图发给 IT。
    goto :fail
)

echo.
echo ============================================
echo   ✓ 安装成功！
echo   重启 DSH 终端后，会弹出企业登录页，
echo   用企业账号登录即可使用。
echo ============================================
echo.
pause
exit /b 0

:fail
echo.
echo 安装失败，请截图本窗口的全部内容联系 IT。
pause
exit /b 1
