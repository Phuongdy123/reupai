"""Project creation contract: no real Google resources or credentials."""
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from services import google_project_setup as setup, gemini_oauth as oauth


def response(body=None, status=200):
    return SimpleNamespace(ok=200 <= status < 300, status_code=status, json=lambda: body or {})


class ProjectSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.identity = 'customer-one'; self.selected = None; self.created = []
        self.attempt = oauth._state['attempt']; oauth._state['attempt'] = 20
        self.addCleanup(lambda: oauth._state.update(attempt=self.attempt))
        self.addCleanup(patch.stopall)
        patch.object(setup, 'get_config_dir', return_value=Path(self.temp.name)).start()
        patch.object(setup, '_identity', side_effect=lambda _: self.identity).start()
        patch.object(oauth, 'get_credentials', return_value=SimpleNamespace(token='fixture-only')).start()
        self.refresh = patch.object(oauth, 'refresh_credentials', return_value=None).start()
        patch.object(oauth, 'get_project_id', side_effect=lambda: self.selected).start()
        def save(value): self.selected = value; return value
        self.save = patch.object(oauth, 'set_project_id', side_effect=save).start()
        self.detect = patch.object(setup, 'detect_projects', return_value={'state':'no_projects','complete':True,'projects':[]}).start()
        self.permissions = patch.object(setup, 'setup_permissions', return_value=set()).start()
        self.http = patch.object(setup.requests, 'request', side_effect=self.google).start()

    def google(self, method, url, **kwargs):
        if method == 'POST':
            self.created.append(kwargs['json'])
            return response({'name':'operations/pc.fixture'})
        if url.endswith('operations/pc.fixture'): return response({'done':False})
        if self.created:
            return response({**self.created[-1], 'state':'ACTIVE'})
        return response(status=404)

    def finish(self):
        self.http.side_effect = lambda method, url, **kw: response({'done':True}) if '/operations/' in url else response({**self.created[-1], 'state':'ACTIVE'})

    def test_get_is_read_only_and_never_creates(self):
        self.assertEqual(setup.project_setup()['state'], 'idle')
        self.http.assert_not_called(); self.detect.assert_not_called()

    def test_expired_access_token_refreshes_once_without_creating_a_second_project(self):
        self.refresh.return_value=SimpleNamespace(token='refreshed-fixture')
        self.http.side_effect=[response(status=401),response({'name':'operations/pc.fixture'}),response({'done':False})]
        self.assertEqual(setup.project_setup(create=True)['state'],'creating')
        self.refresh.assert_called_once()
        first,retry=self.http.call_args_list[:2]
        self.assertEqual(first.kwargs['json'],retry.kwargs['json'])
        self.assertEqual(retry.kwargs['headers']['Authorization'],'Bearer refreshed-fixture')

    def test_account_switch_on_401_never_refreshes_or_replays_for_new_owner(self):
        def switched(*args,**kwargs):
            self.identity='other-account'
            return response(status=401)
        self.http.side_effect=switched
        self.assertEqual(setup.project_setup(create=True)['state'],'account_changed')
        self.refresh.assert_not_called()
        self.assertEqual(self.http.call_count,1)

    def test_malformed_project_labels_and_operation_errors_do_not_crash_or_select(self):
        setup.project_setup(create=True)
        self.http.side_effect=lambda method,url,**kw: response({'done':True}) if '/operations/' in url else response({**self.created[0],'state':'ACTIVE','labels':None})
        self.assertEqual(setup.project_setup()['state'],'verification_required')
        self.save.assert_not_called()
        self.http.side_effect=lambda *a,**kw: response({'done':True,'error':'unexpected upstream error'})
        self.assertEqual(setup.project_setup()['state'],'retry_required')

    def test_missing_scope_on_project_create_requires_reauthorization(self):
        result=setup._failure(403,{'error':{'details':[{'reason':'ACCESS_TOKEN_SCOPE_INSUFFICIENT'}]}})
        self.assertEqual(result['state'],'reauthorization_required')

    def test_completed_journal_does_not_trap_explicit_replacement_on_old_project(self):
        setup.project_setup(create=True); self.finish(); setup.project_setup()
        old_project=self.selected
        self.http.side_effect=self.google
        result=setup.project_setup(create=True,replace_project=old_project)
        self.assertEqual(result['state'],'creating')
        self.assertEqual(len(self.created),2)
        self.assertNotEqual(self.created[0]['projectId'],self.created[1]['projectId'])
        self.assertEqual(self.selected,old_project)
        setup.project_setup(create=True,replace_project=old_project)
        self.assertEqual(len(self.created),2)
        self.assertEqual(len(list((setup._path(setup._context()).parent/'archive').glob('*.json'))),1)

    def test_explicit_replacement_preserves_old_selection_until_new_project_verified(self):
        self.selected='old-project'
        self.assertEqual(setup.project_setup(create=True,replace_project='old-project')['state'],'creating')
        self.assertEqual(self.selected,'old-project'); self.save.assert_not_called()
        self.finish()
        result=setup.project_setup()
        self.assertEqual(result['project_id'],self.created[0]['projectId'])
        self.assertEqual(len(self.created),1)

    def test_replacement_cannot_override_manual_choice_in_another_tab(self):
        self.selected='old-project'
        setup.project_setup(create=True,replace_project='old-project')
        self.selected='manual-project'; self.finish()
        self.assertEqual(setup.project_setup()['project_id'],'manual-project')
        self.save.assert_not_called()

    def test_replacement_does_not_create_when_permissions_unknown_or_sufficient(self):
        self.selected='old-project'
        for permissions in (None, {'serviceusage.services.enable','serviceusage.services.use'}):
            self.permissions.return_value=permissions
            setup.project_setup(create=True,replace_project='old-project')
        self.http.assert_not_called(); self.save.assert_not_called()

    def test_unsuitable_discovered_project_allows_explicit_creation(self):
        self.detect.return_value={'state':'no_suitable_projects','complete':True,'projects':[{'project_id':'read-only-project'}]}
        self.assertEqual(setup.project_setup(create=True)['state'],'creating')
        self.assertEqual(len(self.created),1)

    def test_create_tracks_operation_then_saves_and_rechecks_without_duplicate(self):
        self.assertEqual(setup.project_setup(create=True)['state'], 'creating')
        self.assertEqual(len(self.created), 1); self.save.assert_not_called()
        self.assertEqual(setup.project_setup(create=True)['state'], 'creating')
        self.assertEqual(len(self.created), 1)
        self.finish()
        result = setup.project_setup()
        self.assertTrue(result['created']); self.assertEqual(result['project_id'], self.created[0]['projectId'])
        self.save.assert_called_once()
        self.assertEqual(setup.project_setup(create=True)['project_id'], self.selected)
        body = self.created[0]
        self.assertTrue(oauth.PROJECT_ID_PATTERN.fullmatch(body['projectId']))
        self.assertEqual(set(body), {'projectId','displayName','labels'})
        for call in self.http.call_args_list:
            self.assertNotIn('x-goog-user-project', call.kwargs['headers'])
            self.assertNotIn('billing', call.args[1]); self.assertNotIn('setIamPolicy', call.args[1])

    def test_manual_selection_and_existing_projects_prevent_creation(self):
        self.selected='manual-project'
        self.assertEqual(setup.project_setup(create=True)['project_id'], self.selected)
        self.http.assert_not_called()
        self.selected=None
        for discovered in [{'state':'choose_project','projects':[{'project_id':'customer-two'}]}, {'state':'lookup_unavailable'}, {'state':'no_projects','complete':False}]:
            self.detect.return_value=discovered
            self.assertEqual(setup.project_setup(create=True), discovered)
        self.http.assert_not_called()

    def test_timeout_reuses_persisted_project_id_after_restart(self):
        def timed_out(method, url, **kw):
            if method=='POST': self.created.append(kw['json']); raise requests.Timeout()
            return response(status=404)
        self.http.side_effect=timed_out
        self.assertEqual(setup.project_setup(create=True)['state'],'retry_required')
        self.assertEqual(setup.project_setup()['state'],'retry_required')
        self.http.side_effect=lambda method,url,**kw: self.google(method,url,**kw) if method=='POST' or '/operations/' in url else response(status=404)
        self.assertEqual(setup.project_setup(create=True)['state'],'creating')
        self.assertEqual(len(self.created),2)
        self.assertEqual(self.created[0],self.created[1])

    def test_accepted_creation_with_lost_post_response_is_recovered_by_get(self):
        def lost_reply(method,url,**kw):
            if method=='POST': self.created.append(kw['json']); raise requests.Timeout()
            return self.google(method,url,**kw)
        self.http.side_effect=lost_reply
        self.assertEqual(setup.project_setup(create=True)['state'],'retry_required')
        self.assertEqual(setup.project_setup()['state'],'selected')
        self.assertEqual(len(self.created),1)

    def test_switch_during_post_keeps_original_operation_but_does_not_save(self):
        def switch(method, url, **kw):
            self.created.append(kw['json']); self.identity='customer-two'
            return response({'name':'operations/pc.fixture'})
        self.http.side_effect=switch
        self.assertEqual(setup.project_setup(create=True)['state'],'account_changed')
        self.save.assert_not_called()
        self.assertEqual(setup.project_setup()['state'],'idle')
        self.identity='customer-one'; self.finish()
        self.assertEqual(setup.project_setup()['state'],'selected')
        self.assertEqual(len(self.created),1)

    def test_switch_during_poll_never_selects_the_other_accounts_project(self):
        setup.project_setup(create=True)
        def switch(*args,**kw): self.identity='customer-two'; return response({'done':True})
        self.http.side_effect=switch
        self.assertEqual(setup.project_setup()['state'],'account_changed'); self.save.assert_not_called()

    def test_manual_choice_in_other_tab_takes_precedence_on_completion(self):
        setup.project_setup(create=True)
        def completed(method,url,**kw):
            if '/operations/' in url: return response({'done':True})
            self.selected='manual-project'
            return response({**self.created[0],'state':'ACTIVE'})
        self.http.side_effect=completed
        self.assertEqual(setup.project_setup()['project_id'],'manual-project'); self.save.assert_not_called()

    def test_collision_cannot_select_a_project_without_matching_attempt_marker(self):
        self.http.side_effect=lambda method,url,**kw: response(status=409) if method=='POST' else response({'projectId':'someone-else','state':'ACTIVE','labels':{}})
        self.assertEqual(setup.project_setup(create=True)['state'],'verification_required'); self.save.assert_not_called()

    def test_google_denials_are_actionable_and_never_show_raw_errors(self):
        for code, message, state in [(403,'terms of service required','terms_required'),(403,'permission denied','permission_required'),(429,'quota exhausted','quota_exceeded'),(401,'expired access token','reauthorization_required')]:
            self.http.side_effect=lambda method,url,**kw: response({'error':{'message':message}},code) if method=='POST' else response(status=404)
            result=setup.project_setup(create=True)
            self.assertEqual(result['state'],state); self.assertNotIn(message,result['message'])
        self.save.assert_not_called()

    def test_operation_error_is_preserved_and_retry_reuses_id(self):
        setup.project_setup(create=True)
        self.http.side_effect=lambda *a,**kw: response({'done':True,'error':{'code':8,'message':'quota'}})
        self.assertEqual(setup.project_setup()['state'],'quota_exceeded')
        self.http.side_effect=lambda method,url,**kw: self.google(method,url,**kw) if method=='POST' or '/operations/' in url else response(status=404)
        self.assertEqual(setup.project_setup(create=True)['state'],'creating')
        self.assertEqual(self.created[0],self.created[1])

    def test_expired_operation_resumes_by_verified_project_without_recreation(self):
        setup.project_setup(create=True)
        self.http.side_effect=lambda method,url,**kw: response(status=404) if '/operations/' in url else response({**self.created[0],'state':'ACTIVE'})
        self.assertEqual(setup.project_setup()['state'],'selected'); self.assertEqual(len(self.created),1)

    def test_corrupt_journal_does_not_generate_a_second_attempt(self):
        context=setup._context(); path=setup._path(context);path.parent.mkdir(parents=True)
        path.write_text('{invalid',encoding='utf-8')
        self.assertEqual(setup.project_setup(create=True)['state'],'local_error');self.http.assert_not_called()

    def test_no_google_credentials_never_searches_or_creates(self):
        with patch.object(oauth,'get_credentials',return_value=None):
            self.assertEqual(setup.project_setup(create=True)['state'],'not_connected')
        self.http.assert_not_called();self.detect.assert_not_called()


if __name__ == '__main__': unittest.main()
