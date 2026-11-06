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
assert client.get('/api/gemini/oauth').status_code == 401
assert client.post('/api/gemini/oauth/start').status_code == 401
assert client.post('/api/gemini/projects/detect').status_code == 401
assert client.post('/api/gemini/projects/setup', json={'confirmed':True}).status_code == 401
assert client.get('/api/gemini/projects/setup').status_code == 401
from unittest.mock import patch
from services import gemini_oauth
with patch.object(gemini_oauth, 'start_authorization', return_value={'connecting':True}) as authorize:
    consent = client.post('/api/gemini/oauth/start', headers=headers, json={'browser':'web','return_to':origin+'/settings#diagnostics'})
    assert consent.status_code == 200
    authorize.assert_called_once_with(nonce_hash=None, open_browser=False, return_to=origin+'/settings#diagnostics')
from services import google_projects
with patch.object(google_projects, 'detect_projects', return_value={'state':'no_projects','projects':[]}) as detect:
    discovered = client.post('/api/gemini/projects/detect', headers=headers, json={'force':True})
    assert discovered.status_code == 200
    detect.assert_called_once_with(force=True)
from services import google_project_setup
with patch.object(google_project_setup, 'project_setup', return_value={'state':'creating'}) as setup:
    assert client.post('/api/gemini/projects/setup', headers=headers, json={}).status_code == 400
    assert client.post('/api/gemini/projects/setup', headers=headers, json={'confirmed':'true'}).status_code == 400
    setup.assert_not_called()
    assert client.get('/api/gemini/projects/setup', headers=headers).status_code == 200
    setup.assert_called_once_with()
    setup.reset_mock()
    assert client.post('/api/gemini/projects/setup', headers=headers, json={'confirmed':True}).status_code == 200
    setup.assert_called_once_with(create=True)
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
