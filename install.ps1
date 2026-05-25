# ZapMyCo 安装脚本 (Windows PowerShell)
# 用法: iwr https://raw.githubusercontent.com/shenjingnan/zapmyco/main/install.ps1 -useb | iex

$Repo = 'shenjingnan/zapmyco'
$BinaryName = 'zapmyco'
$InstallDir = if ($env:ZAPMYCO_INSTALL) { $env:ZAPMYCO_INSTALL } else { "$env:USERPROFILE\.zapmyco" }
$BinDir = "$InstallDir\bin"
$Version = if ($env:ZAPMYCO_VERSION) { $env:ZAPMYCO_VERSION } else { 'latest' }

# ---- 平台检测 ----
$Arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else {
  Write-Host "❌ 错误: 仅支持 64 位 Windows" -ForegroundColor Red
  exit 1
}

$Binary = "zapmyco-windows-${Arch}.exe"

if ($Version -eq 'latest') {
  $DownloadUrl = "https://github.com/${Repo}/releases/latest/download/${Binary}"
} else {
  $DownloadUrl = "https://github.com/${Repo}/releases/download/${Version}/${Binary}"
}

# ---- 安装 ----
New-Item -Path $BinDir -ItemType Directory -Force | Out-Null

Write-Host "⬇️  正在下载 ${Binary} ..."
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
Invoke-WebRequest -Uri $DownloadUrl -OutFile "$BinDir\$BinaryName.exe"

Write-Host ""
Write-Host "✅ 安装完成！" -ForegroundColor Green
Write-Host "   二进制文件: $BinDir\$BinaryName.exe"
Write-Host ""

# 检查是否在 PATH 中
$UserPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($UserPath -notlike "*$BinDir*") {
  Write-Host "   请将以下目录添加到 PATH 环境变量:"
  Write-Host "   $BinDir"
  Write-Host ""
  Write-Host "   或在 PowerShell 中执行:"
  Write-Host "   [Environment]::SetEnvironmentVariable('PATH', `"`$env:PATH;$BinDir`", 'User')"
}

Write-Host "   现在试试: $BinaryName --help"
