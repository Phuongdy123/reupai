import base64
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from services import engine_updates as updates


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.release = {'format': 1, 'platform': 'windows-x64', 'version': '0.2.35',
                        'downloadUrl': updates.ASSET_PREFIX + 'v0.2.35/ReupAI-Setup-0.2.35.exe',
                        'size': 7, 'sha256': hashlib.sha256(b'fixture').hexdigest()}
        self.key = Ed25519PrivateKey.generate()
        self.public = base64.b64encode(self.key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()

    def signed(self, release=None):
        release = release or self.release
        payload = json.dumps(release, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
        return {'release': release, 'signature': base64.b64encode(self.key.sign(payload)).decode()}

    def test_signature_and_numeric_version_order(self):
        self.assertEqual(updates.verify_release(self.signed(), self.public), self.release)
        self.assertGreater(updates.version_tuple('0.2.35'), updates.version_tuple('0.2.9'))
        for invalid in ['0.2', '../0.2.35', '0.2.35-beta', 35]:
            with self.assertRaises(ValueError): updates.version_tuple(invalid)

    def test_changed_manifest_or_other_signer_is_rejected(self):
        document = self.signed()
        document['release'] = {**self.release, 'size': 8}
        with self.assertRaises(Exception): updates.verify_release(document, self.public)
        with self.assertRaises(Exception): updates.verify_release(self.signed(), base64.b64encode(b'X' * 32).decode())

    def test_signed_unsafe_asset_or_integrity_metadata_is_rejected(self):
        for override in [{'downloadUrl': 'https://example.com/setup.exe'}, {'downloadUrl': updates.ASSET_PREFIX + 'a.exe?x=1'},
                         {'size': True}, {'size': updates.MAX_INSTALLER_BYTES + 1}, {'sha256': 'x' * 64}, {'platform': 'linux'}]:
            with self.subTest(override=override), self.assertRaises(ValueError):
                updates.verify_release(self.signed({**self.release, **override}), self.public)

    def download(self, data, release=None, event=None):
        opener = unittest.mock.Mock()
        opener.open.return_value = io.BytesIO(data)
        with patch.object(updates.urllib.request, 'build_opener', return_value=opener):
            return updates.download_installer(release or self.release, self.directory, lambda n: None, event or threading.Event())

    def test_verified_download_and_cached_file_revalidation(self):
        target = self.download(b'fixture')
        self.assertEqual(target.read_bytes(), b'fixture')
        target.write_bytes(b'corrupt')
        self.download(b'fixture')
        self.assertEqual(target.read_bytes(), b'fixture')

    def test_truncated_tampered_oversized_and_cancelled_download_leave_no_partial(self):
        for data in [b'fix', b'corrupt', b'fixture-more']:
            with self.assertRaises(ValueError): self.download(data)
            self.assertFalse(list(self.directory.glob('*.part')))
            self.assertFalse(list(self.directory.glob('*.exe')))
        cancel = threading.Event(); cancel.set()
        with self.assertRaises(InterruptedError): self.download(b'fixture', event=cancel)
        self.assertFalse(list(self.directory.glob('*.part')))

    def manager(self, **kwargs):
        return updates.UpdateManager('0.2.34', self.directory, lambda: False, install_dir=self.directory,
            fetcher=lambda: self.release, downloader=lambda *a: self.directory / 'fixture.exe', **kwargs)

    def wait(self, manager, state):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if manager.snapshot()['state'] == state: return
            time.sleep(.01)
        self.fail(f'expected {state}, got {manager.snapshot()}')

    def test_checks_do_not_install_or_block_work(self):
        launch = unittest.mock.Mock()
        manager = self.manager(launcher=launch)
        self.assertEqual(manager.check()['state'], 'available')
        self.assertTrue(manager.enter_work()); manager.leave_work()
        launch.assert_not_called()

    def test_work_and_requests_must_finish_before_launch_and_failure_reopens_gate(self):
        launched = threading.Event()
        def launcher(*args):
            self.assertFalse(manager.enter_work())
            launched.set()
            return unittest.mock.Mock(poll=lambda: 1)
        manager = self.manager(launcher=launcher)
        occupied = [True]
        manager.workload = lambda: occupied[0]
        manager.enter_work()
        manager.start(); self.wait(manager, 'waiting')
        self.assertFalse(launched.is_set())
        manager.leave_work()
        self.assertFalse(launched.wait(.1))
        occupied[0] = False
        self.assertTrue(launched.wait(2))
        self.wait(manager, 'error')
        self.assertTrue(manager.enter_work()); manager.leave_work()

    def test_cancel_while_waiting_prevents_any_installation(self):
        launcher = unittest.mock.Mock()
        manager = self.manager(launcher=launcher)
        manager.workload = lambda: True
        manager.start(); self.wait(manager, 'waiting')
        manager.cancel(); self.wait(manager, 'cancelled')
        launcher.assert_not_called()

    def test_duplicate_update_requests_share_one_download(self):
        entered, finish = threading.Event(), threading.Event()
        def download(*args):
            entered.set(); finish.wait(2)
            raise InterruptedError()
        manager = self.manager(launcher=unittest.mock.Mock())
        manager.downloader = unittest.mock.Mock(side_effect=download)
        manager.start(); self.assertTrue(entered.wait(2))
        manager.start(); finish.set(); self.wait(manager, 'cancelled')
        self.assertEqual(manager.downloader.call_count, 1)

    def test_no_downgrade_and_no_auto_update_from_source(self):
        launcher = unittest.mock.Mock()
        manager = self.manager(launcher=launcher); manager.version = '0.2.36'
        manager.start(); self.wait(manager, 'up_to_date'); launcher.assert_not_called()
        manager.install_dir = None
        with self.assertRaises(ValueError): manager.start()

    def test_installer_cannot_be_cancelled_after_start(self):
        manager = self.manager()
        manager.set_state('installing')
        with self.assertRaises(ValueError): manager.cancel()
        self.assertFalse(manager.enter_work())


if __name__ == '__main__': unittest.main()
