param([int]$RootProcessId, [int]$Port, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
# Deliberately project no raw command lines, usernames, paths, URLs or environment.
$result = [ordered]@{
    timestamp = [DateTime]::UtcNow.ToString('o')
    collector = 'pwsh'
    session = [ordered]@{
        collectorSessionId = (Get-Process -Id $PID).SessionId
        interactive = [Environment]::UserInteractive
        kind = $(if ($env:SESSIONNAME -eq 'Console') { 'console' } elseif ($env:SESSIONNAME -eq 'Services') { 'services' } elseif ($env:SESSIONNAME -like 'RDP*') { 'rdp' } else { 'other-or-unset' })
    }
    errors = @()
}
function Error-Code($Failure) {
    return @{ type = $Failure.Exception.GetType().Name; hresult = ('0x{0:X8}' -f $Failure.Exception.HResult) }
}
try {
    $all = @(Get-CimInstance Win32_Process -OperationTimeoutSec 8)
    $ids = [Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add($RootProcessId)
    do {
        $added = $false
        foreach ($p in $all) {
            if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $added = $true }
        }
    } while ($added)
    $result.processes = @($all | Where-Object { $ids.Contains([int]$_.ProcessId) } | ForEach-Object {
        $p = $_
        $argsText = [string]$p.CommandLine
        $switches = [ordered]@{}
        foreach ($switch in @('remote-debugging-port', 'remote-debugging-pipe', 'type', 'no-sandbox', 'enable-logging', 'user-data-dir', 'log-file')) {
            $match = [regex]::Match($argsText, '--' + $switch + '(?:=("[^"]*"|[^\s]+))?(?=\s|$)')
            if (!$match.Success) { continue }
            $value = $match.Groups[1].Value.Trim('"')
            if ($switch -eq 'remote-debugging-port' -and $value -match '^\d{1,5}$') { $switches[$switch] = [int]$value }
            elseif ($switch -eq 'type' -and $value -in @('renderer', 'utility', 'gpu-process', 'crashpad-handler')) { $switches[$switch] = $value }
            else { $switches[$switch] = 'present' }
        }
        @{ name = $(if ($p.Name -in @('novelforge.exe', 'msedgewebview2.exe', 'crashpad_handler.exe')) { $p.Name } else { 'other' }); id = $p.ProcessId; parentId = $p.ParentProcessId; sessionId = $p.SessionId; switches = $switches }
    })
} catch { $result.errors += @{ stage = 'cim'; error = (Error-Code $_) } }
# Independent .NET fallback also reports whether the host is waiting in native code.
try {
    $hostProcess = Get-Process -Id $RootProcessId -ErrorAction Stop
    $result.host = @{ id = $hostProcess.Id; sessionId = $hostProcess.SessionId; responding = $hostProcess.Responding; windowPresent = ($hostProcess.MainWindowHandle -ne 0); cpuSeconds = $hostProcess.CPU; threads = @($hostProcess.Threads | ForEach-Object { @{ state = [string]$_.ThreadState; waitReason = $(if ([string]$_.ThreadState -eq 'Wait') { [string]$_.WaitReason } else { $null }) } }) }
} catch { $result.errors += @{ stage = 'get-process'; error = (Error-Code $_) } }
try {
    # Query only LISTEN sockets; omit foreign addresses and unrelated port numbers.
    $result.listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq $Port -or ($ids -and $ids.Contains([int]$_.OwningProcess)) } | ForEach-Object {
        @{ port = $_.LocalPort; ownerId = $_.OwningProcess; address = $(if ($_.LocalAddress -in @('127.0.0.1', '::1', '0.0.0.0', '::')) { $_.LocalAddress } else { 'other' }) }
    })
} catch { $result.errors += @{ stage = 'tcp'; error = (Error-Code $_) } }
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8
