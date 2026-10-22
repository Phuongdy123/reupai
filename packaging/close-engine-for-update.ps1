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

try {
    $running = Get-InstalledEngineProcesses
    if ($running.Count -eq 0) { exit 0 }

    # An update must not interrupt a render or a download. The status request
    # stays on loopback and uses the existing local-only installation token.
    $tokenFile = Join-Path $env:LOCALAPPDATA 'ReupAI\local_token'
    if (-not (Test-Path -LiteralPath $tokenFile)) { exit 11 }
    $token = (Get-Content -LiteralPath $tokenFile -Raw -Encoding UTF8).Trim()
    if (-not $token) { exit 11 }
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:17888/api/status' `
        -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 5
    if (-not $status.engine_running) { exit 11 }
    if ([int]$status.active_jobs -gt 0 -or [int]$status.active_downloads -gt 0) { exit 10 }

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

    $sent = 0
    foreach ($process in $running) {
        $sent += [ReupAITrayStop]::Stop([uint32]$process.ProcessId)
    }
    if ($sent -eq 0) { exit 12 }

    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 500
        if ((Get-InstalledEngineProcesses).Count -eq 0) { exit 0 }
    }
    exit 13
} catch {
    exit 11
}
