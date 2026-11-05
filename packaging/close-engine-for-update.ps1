param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir
)

$ErrorActionPreference = 'Stop'
$targetExe = [IO.Path]::GetFullPath((Join-Path $InstallDir 'ReupAI.exe'))

function Get-InstalledEngineProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name = 'ReupAI.exe'" | Where-Object {
        if (-not $_.ExecutablePath) { return $false }
        try {
            [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $targetExe
        } catch {
            $false
        }
    })
}

function Resolve-StatusProcessId($status) {
    if ($null -ne $status.pid) { return [int]$status.pid }

    # Engines before 0.2.18 do not report a PID. In that case Windows must
    # independently identify the process actually listening on this port.
    $listeners = @(Get-NetTCPConnection -LocalPort 17888 -State Listen -ErrorAction Stop |
        Where-Object { $_.LocalAddress -eq '127.0.0.1' } |
        Select-Object -ExpandProperty OwningProcess -Unique)
    if ($listeners.Count -ne 1) { exit 15 }
    return [int]$listeners[0]
}

function Assert-EngineIdle($status, [int]$processId) {
    if ($null -eq $status.active_jobs) { exit 14 }
    if ([int]$status.active_jobs -gt 0) { exit 10 }

    if ($null -ne $status.active_downloads) {
        if ([int]$status.active_downloads -gt 0) { exit 10 }
        return
    }

    # Old engines lack a download counter. Do not infer idle from jobs alone:
    # yt-dlp/Playwright use child processes and direct streams use sockets.
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $processId" -ErrorAction Stop)
    $external = @(Get-NetTCPConnection -OwningProcess $processId -ErrorAction Stop |
        Where-Object {
            $_.State -eq 'Established' -and
            $_.RemoteAddress -notin @('127.0.0.1', '::1')
        })
    if ($children.Count -gt 0 -or $external.Count -gt 0) { exit 10 }
}

try {
    $running = Get-InstalledEngineProcesses
    if ($running.Count -eq 0) { exit 0 }

    # An update must not interrupt a render or a download. The status request
    # stays on loopback and uses the existing local-only installation token.
    $runtimeDir = if ($env:REUP_DATA_DIR) { $env:REUP_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'ReupAI' }
    $tokenFile = Join-Path $runtimeDir 'local_token'
    if (-not (Test-Path -LiteralPath $tokenFile)) { exit 11 }
    $token = (Get-Content -LiteralPath $tokenFile -Raw -Encoding UTF8).Trim()
    if (-not $token) { exit 11 }
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:17888/api/status' `
        -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 5
    if (-not $status.engine_running) { exit 11 }
    # A second Engine (or an unrelated service) may own port 17888. Only use
    # its work counters to stop the executable installed at this exact path.
    # Older versions without a PID use the OS port owner as an independent
    # identity check. Never send a tray command to an unverified process.
    $statusPid = Resolve-StatusProcessId $status
    $owner = @($running | Where-Object { [int]$_.ProcessId -eq $statusPid })
    if ($statusPid -le 0 -or $owner.Count -ne 1) { exit 15 }
    Assert-EngineIdle $status $statusPid

    # pystray has a hidden ReupAI...SystemTrayIcon window. Its WM_STOP handler
    # closes the tray normally, after which desktop_entry stops the HTTP server
    # and releases the instance lock. Windows Restart Manager cannot close this
    # window on its own because it is not a normal application window.
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class ReupAITrayStop {
    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lparam);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lparam);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int maxCount);
    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);

    public static int Stop(uint processId) {
        int sent = 0;
        EnumWindows((hwnd, unused) => {
            uint owner;
            GetWindowThreadProcessId(hwnd, out owner);
            if (owner != processId) return true;
            var name = new StringBuilder(256);
            GetClassName(hwnd, name, name.Capacity);
            string value = name.ToString();
            if (value.StartsWith("ReupAI", StringComparison.Ordinal) &&
                value.EndsWith("SystemTrayIcon", StringComparison.Ordinal) &&
                PostMessage(hwnd, 0x040A, IntPtr.Zero, IntPtr.Zero)) {
                sent++;
            }
            return true;
        }, IntPtr.Zero);
        return sent;
    }
}
'@

    # A job may have started while the tray helper was being loaded. Check
    # activity and ownership again immediately before requesting shutdown.
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:17888/api/status' `
        -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 5
    if (-not $status.engine_running -or
        (Resolve-StatusProcessId $status) -ne $statusPid) { exit 15 }
    Assert-EngineIdle $status $statusPid

    # The process may have changed while we queried status. Recheck its path
    # immediately before sending the tray command to the verified owner only.
    $running = Get-InstalledEngineProcesses
    if ($running.Count -eq 0) { exit 0 }
    $owner = @($running | Where-Object { [int]$_.ProcessId -eq $statusPid })
    if ($owner.Count -ne 1) { exit 15 }
    $sent = [ReupAITrayStop]::Stop([uint32]$statusPid)
    if ($sent -eq 0) { exit 12 }

    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 500
        if ((Get-InstalledEngineProcesses).Count -eq 0) { exit 0 }
    }
    exit 13
} catch {
    exit 11
}
