"""Discover the connected customer's projects without creating or billing one."""
import threading
import time

_lock = threading.Lock()
_cache = {}
_CACHE_SECONDS = 120
_MAX_PAGES = 3
SEARCH_URL = 'https://cloudresourcemanager.googleapis.com/v3/projects:search'


def _identity(oauth):
    data = oauth._load_token_data() or {}
    return str(data.get('_reupai_google_subject') or data.get('_reupai_google_email') or '').lower()


def detect_projects(*, force=False, expected_attempt=None):
    from services import gemini_oauth as oauth

    identity = _identity(oauth)
    credentials = oauth.get_credentials()
    if not identity or not credentials or not credentials.token:
        return {'state':'not_connected','projects':[],'project_id':None,'message':'Kết nối Google trước để tìm project của bạn.'}
    with _lock:
        with oauth._lock:
            attempt = int(oauth._state['attempt'])
        if _identity(oauth) != identity or expected_attempt is not None and attempt != expected_attempt:
            return {'state':'account_changed','projects':[],'project_id':None,'message':'Lượt kết nối Google đã thay đổi. Hãy tìm project lại.'}
        current = oauth.get_project_id()
        cached = _cache.get(identity)
        if not force and cached and time.monotonic() < cached['expires'] and (not cached['value'].get('project_id') or current):
            return {**cached['value'], 'project_id':current}
        if current and not force:
            return {'state':'selected','projects':[], 'project_id':current,'message':'Đang dùng project đã lưu của bạn.'}
        config = oauth._client_config() or {}
        app_project = str(config.get('installed', {}).get('project_id') or '')
        projects = {}
        page_token = None
        complete = False
        try:
            for _ in range(_MAX_PAGES):
                params = {'pageSize':100}
                if page_token:
                    params['pageToken'] = page_token
                response = oauth.authorized_request('GET', SEARCH_URL, params=params, timeout=10)
                if not response.ok:
                    value = {'state':'lookup_unavailable','projects':[], 'project_id':current,
                             'message':'Google chưa cho phép đọc danh sách project. Bạn vẫn có thể chọn project trong Google Cloud và nhập ID bên dưới.'}
                    break
                data = response.json()
                for item in data.get('projects', []):
                    project_id = str(item.get('projectId') or '')
                    if item.get('state') != 'ACTIVE' or not oauth.PROJECT_ID_PATTERN.fullmatch(project_id) or project_id == app_project:
                        continue
                    projects[project_id] = {'project_id':project_id,'display_name':str(item.get('displayName') or project_id)[:200]}
                next_token = data.get('nextPageToken')
                if not next_token:
                    complete = True
                    break
                if next_token == page_token:
                    break
                page_token = next_token
            if response.ok:
                options = sorted(projects.values(), key=lambda item:(item['display_name'].lower(),item['project_id']))
                value = {'state':'choose_project' if options else 'no_projects','projects':options,
                         'project_id':current,'complete':complete,
                         'message':'Chọn một project trong danh sách để dùng quota Gemini.' if options else
                                   'Chưa tìm thấy project riêng của tài khoản này. Tạo project trong Google Cloud rồi bấm Tìm lại.'}
        except Exception:
            value = {'state':'lookup_unavailable','projects':[], 'project_id':current,
                     'message':'Chưa đọc được danh sách project Google Cloud. Kiểm tra mạng rồi bấm Tìm lại, hoặc nhập ID thủ công.'}
        # A grant can be replaced while the read-only Google request is running.
        # Never return that old account's projects or save a choice for it.
        with oauth._lock:
            if _identity(oauth) != identity or int(oauth._state['attempt']) != attempt:
                return {'state':'account_changed','projects':[],'project_id':None,'message':'Tài khoản Google đã đổi. Hãy tìm project lại.'}
            options = value.get('projects', [])
            current = oauth.get_project_id()
            if not current and value.get('complete') and len(options) == 1:
                selected = oauth.set_project_id(options[0]['project_id'])
                value = {**value,'state':'selected','project_id':selected,'auto_selected':True,
                         'message':'Đã tự chọn và lưu project duy nhất của tài khoản Google này.'}
            elif current:
                value = {**value,'project_id':current}
        _cache[identity] = {'expires':time.monotonic()+(_CACHE_SECONDS if value['state'] != 'lookup_unavailable' else 10),'value':value}
        return value
