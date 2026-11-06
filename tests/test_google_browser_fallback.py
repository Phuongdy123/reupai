"""Google consent remains usable when Windows cannot open a browser."""
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from services import gemini_oauth as oauth
from google_auth_oauthlib.flow import InstalledAppFlow
from oauthlib.oauth2 import MismatchingStateError

URL = 'https://accounts.google.com/o/oauth2/auth?client_id=fixture&redirect_uri=http%3A%2F%2Flocalhost%3A49123%2F&state=fixture'
CONFIG = {'installed': {'client_id':'fixture.apps.googleusercontent.com','client_secret':'fixture-only',
                       'auth_uri':'https://accounts.google.com/o/oauth2/auth','token_uri':'https://oauth2.googleapis.com/token'}}


class GoogleBrowserFallbackTests(unittest.TestCase):
    def setUp(self):
        self.previous = dict(oauth._state)
        oauth._state.update(status='disconnected',attempt=0,started_at=0,error='',authorization_url=None,phase=None)
        self.addCleanup(lambda: (oauth._state.clear(), oauth._state.update(self.previous)))
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        for target, kwargs in [('_client_config', {'return_value':CONFIG}), ('_credential_snapshot', {'return_value':(None,False,False)}),
                               ('_load_token_data', {'return_value':None}), ('TOKEN_PATH', {'new':Path(self.temp.name)/'token.dat'})]:
            context = patch.object(oauth, target, **kwargs); context.start(); self.addCleanup(context.stop)
        self.save = patch.object(oauth, '_save_credentials').start(); self.addCleanup(patch.stopall)
        self.ready = threading.Event(); self.finish = threading.Event(); self.finished = threading.Event()
        self.addCleanup(self.finish.set)
        self.flow = SimpleNamespace()
        def run(**kwargs):
            self.options = kwargs
            try:
                self.flow._reupai_authorization_ready(URL)
                self.ready.set(); self.finish.wait(3)
                self.flow._reupai_exchanging()
                return SimpleNamespace(granted_scopes=oauth.SCOPES,id_token=None)
            finally: self.finished.set()
        self.flow.run_local_server = run
        self.open = patch.object(oauth.webbrowser, 'open', return_value=False).start()
        patch.object(oauth._GoogleInstalledAppFlow, 'from_client_config', return_value=self.flow).start()
        patch.object(oauth, 'enable_gemini_api', return_value={'ready':True}).start()

    def start(self):
        oauth.start_authorization(); self.assertTrue(self.ready.wait(2))

    def end(self):
        self.finish.set(); self.assertTrue(self.finished.wait(2))
        deadline = time.monotonic() + 2
        while oauth._state['status'] == 'connecting' and time.monotonic() < deadline: time.sleep(.01)

    def test_failed_browser_launch_preserves_same_live_authorization_link(self):
        self.start(); current = oauth.status()
        self.assertTrue(current['connecting']); self.assertEqual(current['authorization_url'], URL)
        self.assertFalse(current['browser_opened']); self.assertEqual(current['phase'],'awaiting_google')
        self.assertFalse(self.options['open_browser']); self.assertEqual(self.options['timeout_seconds'],300)
        self.open.assert_called_once_with(URL,new=1,autoraise=True)
        self.end(); self.assertIsNone(oauth.status()['authorization_url']); self.save.assert_called_once()

    def test_broken_windows_default_browser_does_not_close_consent_flow(self):
        self.open.side_effect = OSError('Default browser unavailable')
        self.start(); self.assertEqual(oauth.status()['authorization_url'],URL)
        self.assertIsNone(oauth.status()['error']); self.end()

    def test_disconnect_invalidates_link_and_rejects_late_callback(self):
        self.start(); oauth.disconnect()
        self.assertIsNone(oauth.status()['authorization_url']); self.end(); self.save.assert_not_called()

    def test_expired_consent_clears_link_and_rejects_late_callback(self):
        self.start()
        with oauth._lock: oauth._state['started_at']=time.time()-306
        current=oauth.status()
        self.assertFalse(current['connecting']); self.assertIsNone(current['authorization_url'])
        self.assertIn('5 phút',current['error']); self.end(); self.save.assert_not_called()

    def test_token_exchange_never_keeps_a_consumed_link_visible(self):
        self.start(); self.flow._reupai_exchanging()
        self.assertEqual(oauth.status()['phase'],'exchanging')
        self.assertIsNone(oauth.status()['authorization_url']); self.end()

    def test_non_google_or_non_loopback_links_are_rejected(self):
        for invalid in [URL.replace('accounts.google.com','accounts.google.com.evil.test'), URL.replace('https:','http:',1),
                        URL.replace('localhost','evil.test'), 'javascript:alert(1)']:
            with self.subTest(url=invalid), self.assertRaises(RuntimeError): oauth._google_authorization_url(invalid)


class OAuthLibraryContractTests(unittest.TestCase):
    def test_manual_link_keeps_oauth_state_and_pkce_and_rejects_wrong_state(self):
        flow = oauth._GoogleInstalledAppFlow.from_client_config(CONFIG, oauth.SCOPES, autogenerate_code_verifier=True)
        flow.redirect_uri = 'http://localhost:49123/'
        published=[]; flow._reupai_authorization_ready=published.append
        url, state=flow.authorization_url(prompt='consent')
        query=parse_qs(urlsplit(url).query)
        self.assertEqual(query['state'],[state]); self.assertEqual(query['code_challenge_method'],['S256'])
        self.assertTrue(query['code_challenge']); self.assertNotIn(flow.code_verifier,url)
        self.assertEqual(published,[url])
        with patch.object(flow.oauth2session, 'request') as network:
            with self.assertRaises(MismatchingStateError):
                flow.fetch_token(authorization_response='https://localhost:49123/?code=fixture&state=wrong')
            network.assert_not_called()

    def test_google_token_exchange_has_a_network_timeout_and_restores_scope_policy(self):
        flow = oauth._GoogleInstalledAppFlow.from_client_config(CONFIG, oauth.SCOPES)
        previous=os.environ.get('OAUTHLIB_RELAX_TOKEN_SCOPE')
        observed=[]
        def exchange(**kwargs):
            observed.append((kwargs['timeout'],os.environ.get('OAUTHLIB_RELAX_TOKEN_SCOPE')))
            return {}
        with patch.object(InstalledAppFlow, 'fetch_token', side_effect=exchange): flow.fetch_token(code='fixture')
        self.assertEqual(observed,[(20,'1')]); self.assertEqual(os.environ.get('OAUTHLIB_RELAX_TOKEN_SCOPE'),previous)


class WebBrowserReturnTests(unittest.TestCase):
    def setUp(self):
        self.previous=dict(oauth._state)
        oauth._state['attempt']=987
        self.addCleanup(lambda: (oauth._state.clear(),oauth._state.update(self.previous)))
        self.flow=oauth._GoogleInstalledAppFlow.from_client_config(CONFIG,oauth.SCOPES,autogenerate_code_verifier=True)
        self.ready=threading.Event(); self.done=threading.Event(); self.result={}
        def published(url):
            self.url=url; self.ready.set()
        self.flow._reupai_authorization_ready=published
        def exchange(**kwargs):
            self.result['response']=kwargs['authorization_response']
            self.flow.oauth2session.token={'access_token':'fixture-only','token_type':'Bearer','expires_in':3600,'expires_at':time.time()+3600}
        self.exchange=patch.object(self.flow,'fetch_token',side_effect=exchange).start()
        self.addCleanup(patch.stopall)

    def run_server(self):
        def run():
            try: self.result['credentials']=oauth._run_browser_flow(self.flow,{},'https://www.reupai.cloud/settings#diagnostics',987)
            except Exception as error: self.result['error']=error
            finally: self.done.set()
        threading.Thread(target=run,daemon=True).start()
        self.assertTrue(self.ready.wait(2))

    def test_google_callback_returns_to_reupai_without_code_in_redirect_or_logs(self):
        self.run_server()
        query=parse_qs(urlsplit(self.url).query)
        callback=query['redirect_uri'][0]
        session=requests.Session(); session.trust_env=False
        invalid=session.get(callback+'?state=wrong&code=fixture',allow_redirects=False,timeout=3)
        self.assertEqual(invalid.status_code,400); self.assertFalse(self.done.is_set())
        response=session.get(callback,params={'state':query['state'][0],'code':'fixture-code'},allow_redirects=False,timeout=3)
        self.assertEqual(response.status_code,303)
        self.assertEqual(response.headers['Location'],'https://www.reupai.cloud/settings#diagnostics')
        self.assertEqual(response.headers['Referrer-Policy'],'no-referrer')
        self.assertTrue(self.done.wait(2)); self.assertNotIn('error',self.result)
        self.exchange.assert_called_once()
        self.assertEqual(self.result['credentials'].token,'fixture-only')

    def test_cancelling_releases_the_listener_and_never_exchanges_a_code(self):
        self.run_server()
        with oauth._lock: oauth._state['attempt']=988
        self.assertTrue(self.done.wait(2)); self.assertIsInstance(self.result.get('error'),InterruptedError)
        self.exchange.assert_not_called()

    def test_only_account_settings_on_allowed_origins_can_be_the_return_page(self):
        self.assertEqual(oauth._google_return_url('https://www.reupai.cloud/settings#diagnostics'),'https://www.reupai.cloud/settings#diagnostics')
        for value in ['https://evil.test/settings','https://www.reupai.cloud.evil.test/settings','javascript:alert(1)',
                      'https://www.reupai.cloud/settings?next=https://evil.test','https://www.reupai.cloud/sources']:
            with self.subTest(url=value), self.assertRaises(ValueError): oauth._google_return_url(value)


if __name__ == '__main__': unittest.main()
