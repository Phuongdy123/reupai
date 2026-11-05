"""Run the real PowerShell helper with process launches replaced by a test double."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.name == 'nt', 'Windows updater helper')
class InstallerHelperTests(unittest.TestCase):
    def test_installer_checks_hash_exit_status_and_installed_version_before_relaunch(self):
        with tempfile.TemporaryDirectory(prefix='ReupAI helper ') as temp:
            directory = Path(temp)
            installer = directory / 'fixture.exe'; installer.write_bytes(b'fixture-only')
            (directory / 'ReupAI.exe').write_bytes(b'fixture-only')
            harness = directory / 'harness.ps1'
            harness.write_text(r'''
function Start-Process {
    param([string]$FilePath,[string[]]$ArgumentList,[string]$WindowStyle,[switch]$Wait,[switch]$PassThru)
    if ($WindowStyle -ne 'Hidden') { throw 'A helper process was not hidden' }
    $global:LaunchCount++
    Set-Content -LiteralPath $env:FIXTURE_CALLS -Value $global:LaunchCount
    if ($Wait) {
        if ($ArgumentList -notcontains '/VERYSILENT') { throw 'Installer is not silent' }
        if ($ArgumentList -notcontains ('/DIR="' + $env:FIXTURE_DIR + '"')) { throw 'Install directory was not quoted' }
        return [pscustomobject]@{ ExitCode=[int]$env:FIXTURE_EXIT }
    }
    if ($ArgumentList -notcontains '--background') { throw 'Engine is not restarted in background' }
}
function Get-Item {
    param([string]$LiteralPath)
    return [pscustomobject]@{ VersionInfo=[pscustomobject]@{ ProductVersion=$env:FIXTURE_VERSION } }
}
$global:LaunchCount=0
& $env:FIXTURE_HELPER -Installer $env:FIXTURE_INSTALLER -InstallDir $env:FIXTURE_DIR -ExpectedHash $env:FIXTURE_HASH -TargetVersion '0.2.35' -ResultPath $env:FIXTURE_RESULT
exit $LASTEXITCODE
''', encoding='utf-8-sig')
            cases = [('valid', None, '0', '0.2.35', 'completed', 2),
                     ('hash', '0' * 64, '0', '0.2.35', 'failed', 0),
                     ('setup failed', None, '1', '0.2.35', 'failed', 1),
                     ('wrong version', None, '0', '0.2.34', 'failed', 1)]
            for name, digest, exit_code, version, state, launches in cases:
                with self.subTest(name=name):
                    result_path = directory / 'result.json'; result_path.unlink(missing_ok=True)
                    calls_path = directory / 'calls.txt'; calls_path.unlink(missing_ok=True)
                    env = {**os.environ, 'FIXTURE_HELPER': str(ROOT / 'app/assets/update-installer.ps1'),
                           'FIXTURE_INSTALLER': str(installer), 'FIXTURE_DIR': str(directory),
                           'FIXTURE_HASH': digest or hashlib.sha256(installer.read_bytes()).hexdigest(),
                           'FIXTURE_EXIT': exit_code, 'FIXTURE_VERSION': version,
                           'FIXTURE_RESULT': str(result_path), 'FIXTURE_CALLS': str(calls_path)}
                    run = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(harness)],
                                         env=env, capture_output=True, timeout=30)
                    self.assertTrue(result_path.is_file(), run.stderr.decode(errors='replace'))
                    result = json.loads(result_path.read_text(encoding='utf-8-sig'))
                    self.assertEqual(result['status'], state, result)
                    self.assertEqual(int(calls_path.read_text().strip()) if calls_path.exists() else 0, launches)
                    self.assertEqual(run.returncode, 0 if state == 'completed' else 1)


if __name__ == '__main__': unittest.main()
