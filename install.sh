#!/bin/sh
# ZapMyCo 安装脚本
# 用法: curl -fsSL https://raw.githubusercontent.com/shenjingnan/zapmyco/main/install.sh | sh
#        ZAPMYCO_VERSION=v0.18.0 sh install.sh

set -eu

REPO='shenjingnan/zapmyco'
BINARY_NAME='zapmyco'
INSTALL_DIR="${ZAPMYCO_INSTALL:-${HOME}/.zapmyco}"
BIN_DIR="${INSTALL_DIR}/bin"
VERSION="${ZAPMYCO_VERSION:-latest}"

# ---- 平台检测 ----

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) OS='macos' ;;
  Linux)  OS='linux' ;;
  *)
    echo "❌ 错误: 不支持的操作系统: $OS (仅支持 macOS / Linux)"
    echo "   Windows 用户请使用: iwr https://raw.githubusercontent.com/${REPO}/main/install.ps1 -useb | iex"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH='x64' ;;
  aarch64|arm64) ARCH='arm64' ;;
  *)
    echo "❌ 错误: 不支持的架构: $ARCH (仅支持 x86_64 / arm64)"
    exit 1
    ;;
esac

# ---- 构造下载 URL ----

BINARY="zapmyco-${OS}-${ARCH}"

if [ "$VERSION" = 'latest' ]; then
  DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${BINARY}"
else
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${BINARY}"
fi

# ---- 安装 ----

mkdir -p "$BIN_DIR"

echo "⬇️  正在下载 ${BINARY} ..."
curl -fsSL "$DOWNLOAD_URL" -o "${BIN_DIR}/${BINARY_NAME}"
chmod +x "${BIN_DIR}/${BINARY_NAME}"

echo ""
echo "✅ 安装完成！"
echo "   二进制文件: ${BIN_DIR}/${BINARY_NAME}"
echo ""

# 检测是否已在 PATH 中
if ! command -v "${BINARY_NAME}" >/dev/null 2>&1; then
  SHELL_NAME="$(basename "${SHELL:-sh}")"
  case "$SHELL_NAME" in
    zsh) PROFILE_FILE="${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash) PROFILE_FILE="${HOME}/.bashrc" ;;
    *) PROFILE_FILE="${HOME}/.profile" ;;
  esac

  echo "   请将以下内容添加到 ${PROFILE_FILE}:"
  echo "   export PATH=\"\$PATH:${BIN_DIR}\""
  echo ""
  echo "   然后执行: source ${PROFILE_FILE}"
fi

echo "   现在试试: ${BINARY_NAME} --help"
