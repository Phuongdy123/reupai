"""Exercise the actual adapter with an isolated runtime, without starting an Engine."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class UpdateApiTests(unittest.TestCase):
    def test_update_routes_require_authorization_and_install_gate_keeps_cors_and_status(self):
        with tempfile.TemporaryDirectory() as temp:
            env = {**os.environ, 'REUP_DATA_DIR': temp, 'REUP_LOCAL_ENGINE': '1'}
            code = r'''
import sys
from pathlib import Path
sys.path.insert(0, str(Path.cwd() / 'app'))
import local_engine as engine
from services.engine_updates import UpdateManager
from fastapi.testclient import TestClient
manager = UpdateManager(engine.ENGINE_VERSION, Path.cwd(), lambda: False)
engine._update_manager = manager
client = TestClient(engine.app)
origin = 'https://www.reupai.cloud'
headers = {'Authorization': 'Bearer ' + engine.LOCAL_TOKEN, 'Origin': origin}
assert client.get('/api/updates').status_code == 401
assert client.post('/api/updates/start').status_code == 401
assert client.post('/api/updates/start', headers={**headers, 'Origin':'https://untrusted.example'}).status_code == 403
assert client.get('/api/updates', headers=headers).json()['state'] == 'idle'
assert client.post('/api/updates/start', headers=headers).status_code == 409
manager.set_state('installing')
blocked = client.get('/api/diagnostics', headers=headers)
assert blocked.status_code == 503
assert blocked.headers['access-control-allow-origin'] == origin
assert client.get('/api/updates', headers=headers).status_code == 200
assert client.get('/api/health', headers=headers).status_code == 200
assert client.post('/api/updates/cancel', headers=headers).status_code == 409
preflight = client.options('/api/updates/start', headers={'Origin':origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization'})
assert preflight.status_code == 200
print('Authenticated update routes, origin restriction, idle gate and CORS passed')
'''
            result = subprocess.run([sys.executable, '-c', code], cwd=ROOT, env=env, capture_output=True, text=True, timeout=90)
            self.assertEqual(result.returncode, 0, result.stdout[-1800:] + result.stderr[-1800:])


if __name__ == '__main__': unittest.main()
