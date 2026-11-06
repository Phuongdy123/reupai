"""One-click project creation, with a durable attempt per Google account.

Only an explicit POST starts creation. GET resumes its operation, never creates
a resource. No billing account, API key, IAM or terms acceptance is configured.
"""
import hashlib
import json
import re
import secrets
import threading

import requests

from runtime_paths import get_config_dir
from services import gemini_oauth as oauth
from services.google_projects import _identity, detect_projects, setup_permissions

_lock = threading.RLock()
_BASE = 'https://cloudresourcemanager.googleapis.com/v3/'
_OPERATION = re.compile(r'operations/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\Z')


class AccountChanged(Exception):
    pass


def _context():
    with oauth._lock:
        identity = _identity(oauth)
        credentials = oauth.get_credentials()
        if not identity or not credentials or not credentials.token:
            return None
        return identity, int(oauth._state['attempt'])


def _check(context):
    if _identity(oauth) != context[0] or int(oauth._state['attempt']) != context[1]:
        raise AccountChanged()


def _request(context, method, path, **kwargs):
    # Capture credentials under the same lock as account replacement. A request
    # already in flight can finish for its original owner, never the next user.
    with oauth._lock:
        _check(context)
        credentials = oauth.get_credentials()
        if not credentials or not credentials.token:
            raise AccountChanged()
        headers = {'Authorization': f'Bearer {credentials.token}'}
    return requests.request(method, _BASE + path, headers=headers, timeout=15, **kwargs)


def _path(context):
    name = hashlib.sha256(context[0].encode()).hexdigest() + '.json'
    return get_config_dir() / 'gemini-project-setup' / name


def _read(context):
    path = _path(context)
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding='utf-8'))
    if (not isinstance(data, dict) or not oauth.PROJECT_ID_PATTERN.fullmatch(str(data.get('project_id', '')))
            or not re.fullmatch(r'[a-f0-9]{16}', str(data.get('marker', '')))
            or data.get('operation') and not _OPERATION.fullmatch(str(data['operation']))):
        raise ValueError('Invalid project setup journal')
    return data


def _write(context, data):
    path = _path(context)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data), encoding='utf-8')
    temporary.replace(path)


def _result(state, message, **extra):
    return {'state': state, 'message': message, 'project_id': None, **extra}


def _failure(code, payload):
    # Never display raw Google errors, which may contain account information.
    error = payload.get('error', {}) if isinstance(payload, dict) else {}
    detail = str(error).lower()
    if any(word in detail for word in ('terms', 'tos_', 'tos ', 'agreement')):
        return _result('terms_required', 'Google cần bạn chấp nhận điều khoản. Mở Google Cloud bằng đúng tài khoản, hoàn tất rồi bấm thử lại.')
    if code in (429, 8) or any(word in detail for word in ('quota', 'resource_exhausted', 'limit exceeded')):
        return _result('quota_exceeded', 'Tài khoản đã chạm hạn mức tạo project của Google. Chọn project sẵn có hoặc kiểm tra hạn mức trong Google Cloud.')
    if code in (401, 16):
        return _result('reauthorization_required', 'Phiên Google cần cấp lại quyền. Kết nối lại Google rồi tiếp tục; lần tạo này vẫn được giữ.')
    if code in (403, 7, 9):
        return _result('permission_required', 'Google chưa cho tài khoản này tạo project. Mở Google Cloud để hoàn tất thiết lập hoặc nhờ quản trị viên cấp quyền tạo project, rồi thử lại.')
    return _result('retry_required', 'Chưa hoàn tất tạo project. Bấm thử lại để tiếp tục cùng lần tạo; ReupAI sẽ không tạo thêm project khác.')


def _body(response):
    try:
        value = response.json()
        return value if isinstance(value, dict) else {}
    except ValueError:
        return {}


def _finish(context, journal, project):
    if (project.get('projectId') != journal['project_id'] or project.get('state') != 'ACTIVE'
            or project.get('labels', {}).get('reupai-setup') != journal['marker']):
        return _result('verification_required', 'Chưa xác minh được project của lần tạo này. Mở Google Cloud để kiểm tra và chọn project thủ công.')
    with oauth._lock:
        _check(context)
        # A manual selection in another tab takes precedence.
        selected = oauth.get_project_id()
        if not selected or selected == journal.get('replaced_project'):
            selected = oauth.set_project_id(journal['project_id'])
        journal.update(state='created', operation=None)
        _write(context, journal)
    return _result('selected', 'Đã tạo và lưu project. ReupAI đang kiểm tra và bật Gemini cho bạn.', project_id=selected, created=True)


def _resume(context, journal):
    operation = journal.get('operation')
    if operation:
        response = _request(context, 'GET', operation)
        _check(context)
        if response.ok:
            data = _body(response)
            if not data.get('done'):
                return _result('creating', 'Google đang tạo project riêng của bạn…')
            if data.get('error'):
                journal.update(operation=None, state='failed')
                _write(context, journal)
                return _failure(data['error'].get('code'), data)
        elif response.status_code == 404:
            journal.update(operation=None)
            _write(context, journal)
        else:
            return _failure(response.status_code, _body(response))
    response = _request(context, 'GET', 'projects/' + journal['project_id'])
    _check(context)
    if response.ok:
        return _finish(context, journal, _body(response))
    if response.status_code == 404:
        return _result('retry_required', 'Google chưa xác nhận project. Bấm thử lại để tiếp tục cùng lần tạo, không tạo trùng.')
    return _failure(response.status_code, _body(response))


def project_setup(*, create=False, replace_project=None):
    """Start on explicit confirmation, or resume without creating on a GET."""
    context = _context()
    if not context:
        return _result('not_connected', 'Kết nối Google trước để tạo project của bạn.')
    with _lock:
        try:
            _check(context)
            selected = oauth.get_project_id()
            journal = _read(context)
            replacing = bool(selected and (replace_project == selected or journal and journal.get('replaced_project') == selected))
            if selected and not replacing:
                return _result('selected', 'Đang dùng project đã lưu.', project_id=selected)
            if replacing and not journal:
                # A replacement is explicit and only allowed when we have
                # verified this account cannot complete setup on the old one.
                permissions = setup_permissions(oauth, selected)
                _check(context)
                if permissions is None:
                    return _result('retry_required', 'Chưa kiểm tra được quyền project hiện tại. Thử lại; chưa tạo project mới.')
                if {'serviceusage.services.enable', 'serviceusage.services.use'} <= permissions:
                    return _result('selected', 'Project hiện tại đã có quyền thiết lập. Đang kiểm tra Gemini.', project_id=selected)
                if not create:
                    return _result('idle', '')
            if journal:
                resumed = _resume(context, journal)
                if not create or resumed['state'] != 'retry_required' or journal.get('operation'):
                    return resumed
            elif not create:
                return _result('idle', '')
            # Do not create on an incomplete/denied search or when projects exist.
            if not replacing:
                discovered = detect_projects(force=True, expected_attempt=context[1])
                _check(context)
                if discovered.get('state') not in {'no_projects', 'no_suitable_projects'} or not discovered.get('complete'):
                    return discovered
            if not journal:
                journal = {'project_id': 'reupai-' + secrets.token_hex(6), 'marker': secrets.token_hex(8), 'state': 'prepared', 'operation': None}
                if replacing:
                    journal['replaced_project'] = selected
            # Persist the id BEFORE sending. Even an ambiguous timeout or crash
            # can only retry the same projectId, never allocate a second resource.
            _write(context, journal)
            response = _request(context, 'POST', 'projects', json={
                'projectId': journal['project_id'], 'displayName': 'ReupAI Gemini',
                'labels': {'reupai-setup': journal['marker']},
            })
            data = _body(response)
            # Persist the response in its original owner's journal even if that
            # owner disconnected while Google was accepting the request.
            if response.ok and _OPERATION.fullmatch(str(data.get('name') or '')):
                journal.update(state='creating', operation=data['name'])
                _write(context, journal)
            _check(context)
            if response.ok and journal.get('operation'):
                return _resume(context, journal)
            if response.status_code == 409:
                return _resume(context, journal)
            return _failure(response.status_code, data)
        except AccountChanged:
            return _result('account_changed', 'Tài khoản Google đã đổi. Lần tạo trước vẫn được giữ cho đúng tài khoản đó.')
        except requests.RequestException:
            return _result('retry_required', 'Mạng gián đoạn khi tạo project. Bấm thử lại để tiếp tục cùng lần tạo, không tạo trùng.')
        except (OSError, ValueError, TypeError):
            return _result('local_error', 'Chưa đọc hoặc lưu được lần tạo project trên máy. Kiểm tra quyền ghi và dung lượng rồi thử lại; bạn vẫn có thể chọn project thủ công.')
