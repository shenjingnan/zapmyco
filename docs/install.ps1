# Zapmyco 安装脚本 (Windows PowerShell)
# 用法: irm https://zapmyco.com/install.ps1 | iex
#
# 注意：此脚本将自动转向 cargo-dist 生成的官方安装器，
# cargo-dist 安装器会自动检测平台、下载二进制归档、验证完整性并配置 PATH。

$Repo = 'shenjingnan/zapmyco'
$InstallerUrl = "https://github.com/${Repo}/releases/latest/download/zapmyco-installer.ps1"

Write-Host "⬇️  正在下载 zapmyco 安装器..." -ForegroundColor Cyan
Write-Host ""

try {
  Invoke-WebRequest -Uri $InstallerUrl -OutFile "$env:TEMP\zapmyco-installer.ps1"
  & "$env:TEMP\zapmyco-installer.ps1"
} catch {
  Write-Host "❌ 错误: 无法下载安装器" -ForegroundColor Red
  Write-Host ""
  Write-Host "   或者你可以直接使用 cargo 安装:"
  Write-Host "   cargo install zapmyco"
  exit 1
}
