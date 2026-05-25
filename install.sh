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
  BASE_URL="https://github.com/${REPO}/releases/latest/download"
else
  BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"
fi

DOWNLOAD_URL="${BASE_URL}/${BINARY}"

# ---- 安装 ----

mkdir -p "$BIN_DIR"

echo "⬇️  正在下载 ${BINARY} ..."
curl -fsSL "$DOWNLOAD_URL" -o "${BIN_DIR}/${BINARY_NAME}"
chmod +x "${BIN_DIR}/${BINARY_NAME}"

# ---- 完整性验证 ----

if [ -z "${ZAPMYCO_NO_VERIFY:-}" ]; then
  SHA256SUMS_FILE=$(mktemp)
  if curl -fsSL "${BASE_URL}/SHA256SUMS" -o "$SHA256SUMS_FILE" 2>/dev/null; then
    EXPECTED=$(grep "  ${BINARY}$" "$SHA256SUMS_FILE" | awk '{print $1}')
    COMPUTED=$(shasum -a 256 "${BIN_DIR}/${BINARY_NAME}" | awk '{print $1}')

    if [ "$EXPECTED" = "$COMPUTED" ]; then
      echo "🔐 文件完整性验证通过"
    else
      echo "❌ 错误: 文件完整性验证失败！SHA256 不匹配"
      echo "   期望: $EXPECTED"
      echo "   实际: $COMPUTED"
      rm -f "${BIN_DIR}/${BINARY_NAME}" "$SHA256SUMS_FILE"
      exit 1
    fi
    rm -f "$SHA256SUMS_FILE"
  else
    echo "⚠️  警告: 无法下载 SHA256SUMS，跳过完整性验证（可设置 ZAPMYCO_NO_VERIFY=1 跳过此警告）"
  fi
fi

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
