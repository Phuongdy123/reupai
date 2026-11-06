import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from services import google_projects as projects, gemini_oauth as oauth


def response(items=(), token=None, status=200):
    body={'projects':list(items)}
    if token: body['nextPageToken']=token
    return SimpleNamespace(ok=status==200,status_code=status,json=lambda:body)


def project(identifier, state='ACTIVE'):
    return {'projectId':identifier,'displayName':identifier.upper(),'state':state}


class ProjectDiscoveryTests(unittest.TestCase):
    def setUp(self):
        projects._cache.clear()
        self.identity={'_reupai_google_subject':'customer-1','_reupai_google_email':'customer@example.com'}
        self.selected=None
        self.original_attempt=oauth._state['attempt']; oauth._state['attempt']=10
        self.addCleanup(lambda: oauth._state.update(attempt=self.original_attempt))
        self.addCleanup(patch.stopall)
        patch.object(oauth,'_load_token_data',side_effect=lambda:self.identity).start()
        patch.object(oauth,'get_credentials',return_value=SimpleNamespace(token='fixture-only')).start()
        patch.object(oauth,'get_project_id',side_effect=lambda:self.selected).start()
        patch.object(oauth,'_client_config',return_value={'installed':{'project_id':'reupai'}}).start()
        def select(value): self.selected=value; return value
        self.save=patch.object(oauth,'set_project_id',side_effect=select).start()
        self.request=patch.object(oauth,'authorized_request').start()
        self.permissions=patch.object(projects,'setup_permissions',return_value={'serviceusage.services.enable','serviceusage.services.use'}).start()

    def test_visible_project_without_setup_permission_is_not_auto_selected(self):
        self.request.return_value=response([project('customer-project')])
        self.permissions.return_value={'resourcemanager.projects.get'}
        result=projects.detect_projects()
        self.assertEqual(result['state'],'no_suitable_projects')
        self.save.assert_not_called()

    def test_unknown_permission_does_not_auto_select_or_claim_permission_denial(self):
        self.request.return_value=response([project('customer-project')])
        self.permissions.return_value=None
        self.assertEqual(projects.detect_projects()['state'],'choose_project')
        self.save.assert_not_called()

    def test_one_visible_customer_project_is_saved_without_an_app_quota_header(self):
        self.request.return_value=response([project('customer-project')])
        result=projects.detect_projects()
        self.assertEqual(result['project_id'],'customer-project'); self.assertTrue(result['auto_selected'])
        self.save.assert_called_once_with('customer-project')
        self.assertEqual(self.request.call_args.args,('GET',projects.SEARCH_URL))
        self.assertNotIn('project_id',self.request.call_args.kwargs)
        projects.detect_projects(); self.assertEqual(self.request.call_count,1)

    def test_multiple_projects_are_choices_without_changing_quota(self):
        self.request.return_value=response([project('customer-one'),project('customer-two')])
        result=projects.detect_projects()
        self.assertEqual(result['state'],'choose_project'); self.assertEqual(len(result['projects']),2)
        self.save.assert_not_called()

    def test_application_project_deleted_projects_and_invalid_ids_are_excluded(self):
        self.request.return_value=response([project('reupai'),project('old-project','DELETE_REQUESTED'),project('../evil'),project('customer-project')])
        self.assertEqual(projects.detect_projects()['project_id'],'customer-project')
        self.save.assert_called_once_with('customer-project')

    def test_no_project_does_not_create_one_or_select_the_application_owner(self):
        self.request.return_value=response([project('reupai')])
        result=projects.detect_projects()
        self.assertEqual(result['state'],'no_projects'); self.save.assert_not_called()
        self.assertEqual(self.request.call_count,1)

    def test_existing_manual_selection_is_retained(self):
        self.selected='manual-project'
        self.assertEqual(projects.detect_projects()['project_id'],'manual-project')
        self.request.assert_not_called(); self.save.assert_not_called()

    def test_pagination_must_finish_before_a_unique_project_can_be_selected(self):
        self.request.side_effect=[response([project('customer-one')],'next'),response([project('customer-two')])]
        result=projects.detect_projects(); self.assertEqual(len(result['projects']),2); self.save.assert_not_called()
        self.assertEqual(self.request.call_args.kwargs['params']['pageToken'],'next')

    def test_truncated_or_repeated_pages_never_trigger_an_automatic_choice(self):
        self.request.return_value=response([project('customer-project')],'repeat')
        result=projects.detect_projects()
        self.assertFalse(result['complete']); self.save.assert_not_called()

    def test_failed_search_preserves_google_authorization_and_offers_manual_selection(self):
        self.request.return_value=response(status=403)
        self.assertEqual(projects.detect_projects()['state'],'lookup_unavailable'); self.save.assert_not_called()
        self.request.return_value=response([project('customer-project')])
        self.assertEqual(projects.detect_projects(force=True)['project_id'],'customer-project')

    def test_switching_google_accounts_during_search_discards_the_old_results(self):
        def search(*args,**kwargs):
            self.identity={'_reupai_google_subject':'customer-2'}
            return response([project('customer-one')])
        self.request.side_effect=search
        result=projects.detect_projects()
        self.assertEqual(result['state'],'account_changed'); self.assertEqual(result['projects'],[])
        self.save.assert_not_called()

    def test_cancelled_oauth_attempt_does_not_search_or_save(self):
        self.assertEqual(projects.detect_projects(expected_attempt=9)['state'],'account_changed')
        self.request.assert_not_called(); self.save.assert_not_called()

    def test_manual_choice_made_during_lookup_is_not_overwritten(self):
        def search(*args,**kwargs):
            self.selected='manual-project'
            return response([project('customer-project')])
        self.request.side_effect=search
        self.assertEqual(projects.detect_projects()['project_id'],'manual-project'); self.save.assert_not_called()


class SavedProjectOwnerTests(unittest.TestCase):
    def test_project_selection_stays_with_the_google_account_that_saved_it(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(oauth,'PROJECT_PATH',Path(temp)/'project.json'), patch.dict(os.environ,{'REUP_DATA_DIR':temp,'REUP_GEMINI_PROJECT_ID':''}):
            with patch.object(oauth,'_load_token_data',return_value={'_reupai_google_subject':'customer-1','_reupai_google_email':'one@example.com'}):
                oauth.set_project_id('customer-project')
                self.assertEqual(oauth.get_project_id(),'customer-project')
            with patch.object(oauth,'_load_token_data',return_value={'_reupai_google_subject':'customer-2','_reupai_google_email':'two@example.com'}):
                self.assertIsNone(oauth.get_project_id())

    def test_legacy_project_is_bound_before_switching_google_accounts(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(oauth,'PROJECT_PATH',Path(temp)/'project.json'), patch.dict(os.environ,{'REUP_DATA_DIR':temp,'REUP_GEMINI_PROJECT_ID':''}):
            oauth.PROJECT_PATH.write_text(json.dumps({'project_id':'customer-project'}),encoding='utf-8')
            with patch.object(oauth,'_load_token_data',return_value={'_reupai_google_subject':'customer-1'}): oauth._bind_legacy_project_owner()
            with patch.object(oauth,'_load_token_data',return_value={'_reupai_google_subject':'customer-2'}): self.assertIsNone(oauth.get_project_id())


if __name__=='__main__': unittest.main()
