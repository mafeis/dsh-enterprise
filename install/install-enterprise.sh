#!/usr/bin/env bash
# ============================================================
#  dsh-enterprise 一键安装脚本（macOS / Linux）
#  用途：员工终端运行，从 npm 安装企业管理插件到 DSH
#  用法：bash install-enterprise.sh
# ============================================================
set -euo pipefail

PKG_NAME="dsh-enterprise"
# 私有 npm 仓库地址：迁移到网关服务器后，把 127.0.0.1 换成服务器 IP
REGISTRY="http://127.0.0.1:4873/"

echo
echo "============================================"
echo "  DSH 企业管理插件 一键安装"
echo "============================================"
echo

# ---------- 1. 环境检查 ----------
fail() { echo "[错误] $1"; echo "安装失败，请截图本窗口联系 IT。"; exit 1; }

command -v node >/dev/null 2>&1 || fail "未检测到 Node.js，请先安装：https://nodejs.org/"
command -v npm  >/dev/null 2>&1 || fail "未检测到 npm，请确认 Node.js 安装完整。"
command -v dsh  >/dev/null 2>&1 || fail "未检测到 dsh 命令，请先安装 DSH 终端。"

echo "[1/4] 环境检查通过（Node $(node --version)）"

# ---------- 2. 从 npm 拉取插件包 ----------
WORK="$(mktemp -d "${TMPDIR:-/tmp}/dsh-enterprise-install.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

echo "[2/4] 正在从 npm 拉取 ${PKG_NAME}@latest ..."
( cd "$WORK" && npm pack "${PKG_NAME}@latest" --registry="$REGISTRY" ) \
    || fail "拉取失败，请检查网络后重试。"

TGZ="$(ls "$WORK"/${PKG_NAME}-*.tgz 2>/dev/null | head -n1)"
[ -n "$TGZ" ] || fail "未找到下载的安装包。"

# ---------- 3. 解包 ----------
echo "[3/4] 解包 $(basename "$TGZ") ..."
tar -xzf "$TGZ" -C "$WORK" || fail "解包失败。"
[ -f "$WORK/package/lib/index.js" ] || fail "安装包内容不完整（缺少 lib/index.js）。"

# ---------- 4. 安装到 DSH ----------
echo "[4/4] 安装到 DSH ..."
dsh plugin add "file:$WORK/package" || fail "dsh plugin add 失败。"

echo
echo "============================================"
echo "  ✓ 安装成功！"
echo "  重启 DSH 终端后，会弹出企业登录页，"
echo "  用企业账号登录即可使用。"
echo "============================================"
