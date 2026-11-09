param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference='Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class StartupProbe {
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p,IntPtr l);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,System.Text.StringBuilder b,int n);
 public static IntPtr FindForProcess(uint pid) { IntPtr found=IntPtr.Zero; EnumWindows((h,l)=>{uint owner;GetWindowThreadProcessId(h,out owner);if(owner==pid){var title=new System.Text.StringBuilder(512);GetWindowText(h,title,512);Console.WriteLine("native-probe pid="+pid+" visible="+IsWindowVisible(h)+" title="+title);if(IsWindowVisible(h)&&title.ToString().Contains("NovelForge")){found=h;return false;}}return true;},IntPtr.Zero);return found; }
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c,string title);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h,uint msg,IntPtr w,IntPtr l);
}
"@
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('nf-startup-'+[guid]::NewGuid())
$previousLocal=$env:LOCALAPPDATA
try {
 $env:LOCALAPPDATA=$testRoot
 $child=Start-Process -FilePath $Executable -ArgumentList '--diagnostic-startup-failure-test' -WindowStyle Normal -PassThru
 $deadline=[DateTime]::UtcNow.AddSeconds(20)
 $found=[IntPtr]::Zero
 while([DateTime]::UtcNow -lt $deadline){
  $candidate=[StartupProbe]::FindForProcess([uint32]$child.Id)
  [uint32]$owner=0
  if($candidate -ne [IntPtr]::Zero){[void][StartupProbe]::GetWindowThreadProcessId($candidate,[ref]$owner);if($owner -eq $child.Id -and [StartupProbe]::IsWindowVisible($candidate)){$found=$candidate;break}}
  Start-Sleep -Milliseconds 100
 }
 if($found -eq [IntPtr]::Zero){throw 'Native visible startup failure dialog was not detected for test process'}
 $log=Join-Path $testRoot 'NovelForge/logs/startup.log'
 if(!(Test-Path -LiteralPath $log) -or !(Select-String -LiteralPath $log -Pattern STARTUP_SELF_TEST -Quiet)){throw 'Startup diagnostic log missing'}
 [void][StartupProbe]::SendMessage($found,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)
 if(!$child.WaitForExit(10000)){throw 'Diagnostic test process did not exit'}
 Write-Output 'PASS: release GUI process without terminal showed native failure dialog and wrote isolated startup log'
} finally {
 $env:LOCALAPPDATA=$previousLocal
 if($child -and !$child.HasExited){Stop-Process -Id $child.Id -Force}
}
