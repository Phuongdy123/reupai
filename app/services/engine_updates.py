"""Verified, user-initiated Windows updates with an idle-work gate."""
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from services.update_public_key import UPDATE_PUBLIC_KEY

RELEASE_URL = 'https://www.reupai.cloud/api/engine/release'
ASSET_PREFIX = 'https://github.com/Phuongdy123/reupai/releases/download/'
MAX_INSTALLER_BYTES = 1500 * 1024 * 1024


def version_tuple(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d+\.\d+\.\d+', value):
        raise ValueError('Phiên bản cập nhật không hợp lệ.')
    return tuple(map(int, value.split('.')))


def verify_release(document, public_key=UPDATE_PUBLIC_KEY):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    release = document['release']
    encoded = json.dumps(release, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key, validate=True)).verify(
        base64.b64decode(document['signature'], validate=True), encoded)
    version_tuple(release['version'])
    if release.get('platform') != 'windows-x64' or release.get('format') != 1:
        raise ValueError('Gói cập nhật không dành cho Windows x64.')
    url = release['downloadUrl']
    if not url.startswith(ASSET_PREFIX) or urlsplit(url).query or not url.endswith('.exe'):
        raise ValueError('Đường tải bộ cài không hợp lệ.')
    if not re.fullmatch(r'[a-f0-9]{64}', release['sha256']):
        raise ValueError('Thiếu mã kiểm tra bộ cài.')
    if type(release['size']) is not int or not 0 < release['size'] <= MAX_INSTALLER_BYTES:
        raise ValueError('Kích thước bộ cài không hợp lệ.')
    return release


def fetch_release():
    request = urllib.request.Request(RELEASE_URL, headers={'User-Agent': 'ReupAI-Updater', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=20) as response:
        data = response.read(65537)
    if len(data) > 65536:
        raise ValueError('Thông tin cập nhật quá lớn.')
    return verify_release(json.loads(data))


class AssetRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = urlsplit(newurl)
        if url.scheme != 'https' or url.hostname not in {'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'}:
            raise ValueError('Bộ cài chuyển hướng tới máy chủ không hợp lệ.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download_installer(release, directory, progress, cancelled):
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f'ReupAI-Setup-{release["version"]}.exe'
    if target.is_file() and target.stat().st_size == release['size']:
        with target.open('rb') as cached:
            if hashlib.file_digest(cached, 'sha256').hexdigest() == release['sha256']:
                progress(100)
                return target
    partial = target.with_suffix('.part')
    digest = hashlib.sha256()
    total = 0
    try:
        opener = urllib.request.build_opener(AssetRedirects())
        request = urllib.request.Request(release['downloadUrl'], headers={'User-Agent': 'ReupAI-Updater'})
        with opener.open(request, timeout=30) as response, partial.open('wb') as output:
            while True:
                if cancelled.is_set():
                    raise InterruptedError('Đã hủy cập nhật.')
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > release['size']:
                    raise ValueError('Bộ cài vượt kích thước đã công bố.')
                digest.update(chunk)
                output.write(chunk)
                progress(round(total / release['size'] * 100))
        if total != release['size'] or digest.hexdigest() != release['sha256']:
            raise ValueError('Bộ cài tải về không khớp mã kiểm tra; chưa tiến hành cài đặt.')
        partial.replace(target)
        return target
    finally:
        partial.unlink(missing_ok=True)


class UpdateManager:
    def __init__(self, version, directory, workload, install_dir=None, helper=None, fetcher=fetch_release, downloader=download_installer, launcher=None):
        self.version, self.directory, self.workload = version, Path(directory), workload
        self.install_dir, self.helper = install_dir, helper
        self.fetcher, self.downloader = fetcher, downloader
        self.launcher = launcher or self._launch
        self.lock = threading.RLock()
        self.cancelled = threading.Event()
        self.busy = False
        self.active_requests = 0
        self.state = {'state': 'idle', 'currentVersion': version, 'progress': 0}

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def set_state(self, state, **values):
        with self.lock:
            self.state = {**self.state, 'state': state, **values}

    def enter_work(self):
        with self.lock:
            if self.state['state'] == 'installing':
                return False
            self.active_requests += 1
            return True

    def leave_work(self):
        with self.lock:
            self.active_requests = max(0, self.active_requests - 1)

    def check(self):
        with self.lock:
            if self.busy:
                return self.snapshot()
            self.busy = True
        try:
            self.set_state('checking', error=None)
            release = self.fetcher()
            newer = version_tuple(release['version']) > version_tuple(self.version)
            self.set_state('available' if newer else 'up_to_date', release=release)
        except Exception as error:
            self.set_state('error', error=str(error) or 'Chưa xác minh được bản cập nhật.')
        finally:
            with self.lock:
                self.busy = False
        return self.snapshot()

    def start(self):
        with self.lock:
            if self.busy:
                if self.state['state'] == 'checking':
                    raise ValueError('Đang kiểm tra phiên bản. Hãy thử cập nhật lại sau vài giây.')
                return self.snapshot()
            if not self.install_dir:
                raise ValueError('Chỉ bản cài Windows mới hỗ trợ cập nhật tự động.')
            self.busy = True
            self.cancelled.clear()
            self.set_state('checking', error=None, progress=0)
            threading.Thread(target=self._run, daemon=True, name='reupai-update').start()
        return self.snapshot()

    def cancel(self):
        with self.lock:
            if self.state['state'] == 'installing':
                raise ValueError('Bộ cài đã khởi động; hãy chờ cập nhật hoàn tất.')
            self.cancelled.set()
        return self.snapshot()

    def _run(self):
        try:
            release = self.fetcher()
            if self.cancelled.is_set():
                raise InterruptedError('Đã hủy cập nhật.')
            if version_tuple(release['version']) <= version_tuple(self.version):
                self.set_state('up_to_date', release=release)
                return
            self.set_state('downloading', release=release)
            installer = self.downloader(release, self.directory, lambda n: self.set_state('downloading', progress=n), self.cancelled)
            self.set_state('waiting', progress=100)
            deadline = time.monotonic() + 6 * 60 * 60
            while not self.cancelled.is_set():
                with self.lock:
                    if self.active_requests == 0 and not self.workload():
                        self.set_state('installing')
                        break
                if time.monotonic() > deadline:
                    raise TimeoutError('Đã chờ công việc hoàn tất quá lâu. Hãy thử cập nhật lại.')
                self.cancelled.wait(1)
            if self.cancelled.is_set():
                raise InterruptedError('Đã hủy cập nhật.')
            process = self.launcher(installer, release)
            # The installer closes this Engine normally. If it fails before that,
            # reopen the work gate instead of leaving a running Engine blocked.
            while process.poll() is None:
                time.sleep(1)
            result_path = self.directory / 'result.json'
            result = json.loads(result_path.read_text(encoding='utf-8-sig')) if result_path.is_file() else {}
            raise RuntimeError(result.get('message') or 'Bộ cài chưa thay thế được ứng dụng. Hãy thử lại hoặc cài thủ công.')
        except InterruptedError:
            self.set_state('cancelled', error=None)
        except Exception as error:
            self.set_state('error', error=str(error) or 'Cập nhật chưa hoàn tất.')
        finally:
            with self.lock:
                self.busy = False

    def _launch(self, installer, release):
        if not getattr(sys, 'frozen', False) or os.name != 'nt':
            raise RuntimeError('Cần chạy bản cài Windows để cập nhật.')
        result = self.directory / 'result.json'
        result.unlink(missing_ok=True)
        powershell = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
        return subprocess.Popen([
            str(powershell), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
            '-File', str(self.helper), '-Installer', str(installer), '-InstallDir', str(self.install_dir),
            '-ExpectedHash', release['sha256'], '-TargetVersion', release['version'], '-ResultPath', str(result),
        ], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP, close_fds=True)
