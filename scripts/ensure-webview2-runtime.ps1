param([switch]$ProbeOnly)
$ErrorActionPreference = 'Stop'
function Find-WebViewRuntime {
    $roots = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application'),
        (Join-Path $env:ProgramFiles 'Microsoft\EdgeWebView\Application'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\EdgeWebView\Application')
    )
    foreach ($root in $roots) {
        if (!(Test-Path -LiteralPath $root)) { continue }
        $runtime = Get-ChildItem -LiteralPath $root -Directory | Where-Object {
            $_.Name -match '^\d+\.\d+\.\d+\.\d+$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'msedgewebview2.exe'))
        } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
        if ($runtime) { return $runtime }
    }
}
$runtime = Find-WebViewRuntime
if (!$runtime) {
    if ($ProbeOnly) { throw 'ENVIRONMENT: WebView2 Runtime is not installed' }
    if ($env:GITHUB_ACTIONS -ne 'true' -or !$env:RUNNER_TEMP) { throw 'Automatic runtime installation is restricted to the disposable CI runner; install WebView2 normally on this computer.' }
    $installer = Join-Path $env:RUNNER_TEMP 'MicrosoftEdgeWebview2Setup.exe'
    Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $installer
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'WebView2 installer signature validation failed' }
    $install = Start-Process -FilePath $installer -ArgumentList '/silent','/install' -WindowStyle Hidden -Wait -PassThru
    if ($install.ExitCode -ne 0) { throw "WebView2 installer failed: $($install.ExitCode)" }
    $runtime = Find-WebViewRuntime
    if (!$runtime) { throw 'ENVIRONMENT: WebView2 installer completed but the runtime executable was not found' }
}
# Resolve before tests isolate LOCALAPPDATA; keep using the genuine Microsoft runtime.
$env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = $runtime.FullName
if ($env:GITHUB_ACTIONS -eq 'true' -and $env:GITHUB_ENV) {
    "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER=$($runtime.FullName)" | Add-Content -LiteralPath $env:GITHUB_ENV
}
Write-Output "WebView2 Runtime ready: $($runtime.Name)"
