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
  $BaseUrl = "https://github.com/${Repo}/releases/latest/download"
} else {
  $BaseUrl = "https://github.com/${Repo}/releases/download/${Version}"
}

$DownloadUrl = "${BaseUrl}/${Binary}"

# ---- 安装 ----
New-Item -Path $BinDir -ItemType Directory -Force | Out-Null

Write-Host "⬇️  正在下载 ${Binary} ..."
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
Invoke-WebRequest -Uri $DownloadUrl -OutFile "$BinDir\$BinaryName.exe"

# ---- 完整性验证 ----

if (-not $env:ZAPMYCO_NO_VERIFY) {
  $Sha256SumsPath = "$env:TEMP\SHA256SUMS_$(Get-Random)"
  try {
    Invoke-WebRequest -Uri "${BaseUrl}/SHA256SUMS" -OutFile $Sha256SumsPath -ErrorAction Stop
    $ExpectedLine = Get-Content $Sha256SumsPath | Select-String "  ${Binary}$"
    if ($ExpectedLine) {
      $ExpectedHash = ($ExpectedLine -split '\s+')[0]
      $ComputedHash = (Get-FileHash -Algorithm SHA256 "$BinDir\$BinaryName.exe").Hash.ToLower()
      if ($ExpectedHash -eq $ComputedHash) {
        Write-Host "🔐 文件完整性验证通过" -ForegroundColor Green
      } else {
        Write-Host "❌ 错误: 文件完整性验证失败！SHA256 不匹配" -ForegroundColor Red
        Write-Host "   期望: $ExpectedHash"
        Write-Host "   实际: $ComputedHash"
        Remove-Item "$BinDir\$BinaryName.exe" -Force -ErrorAction SilentlyContinue
        exit 1
      }
    } else {
      Write-Host "⚠️  警告: SHA256SUMS 中未找到 ${Binary} 的条目，跳过验证" -ForegroundColor Yellow
    }
  } catch {
    Write-Host "⚠️  警告: 无法下载 SHA256SUMS，跳过完整性验证（可设置 `$env:ZAPMYCO_NO_VERIFY=1 跳过此警告）" -ForegroundColor Yellow
  } finally {
    Remove-Item $Sha256SumsPath -Force -ErrorAction SilentlyContinue
  }
}

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
