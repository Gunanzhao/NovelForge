$ErrorActionPreference = 'Stop'
$studioExecutable = Join-Path $PSScriptRoot 'desktop\novelforge-studio.exe'
if (-not (Test-Path -LiteralPath $studioExecutable -PathType Leaf)) {
    throw '未找到 desktop\novelforge-studio.exe。请先构建桌面版，或在项目目录运行 pnpm tauri:dev。'
}
Start-Process -FilePath $studioExecutable -WorkingDirectory $PSScriptRoot -WindowStyle Normal
