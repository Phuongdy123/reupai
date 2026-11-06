"""Publish a verified installer, then generate the website's signed release document.

The signing key and GitHub credential never enter the repository or manifest.
"""
import argparse
import base64
import hashlib
import http.client
import ipaddress
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone
import urllib.error
import urllib.request
from urllib.parse import quote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'app'))
from services.update_public_key import UPDATE_PUBLIC_KEY
from services.engine_updates import version_tuple

REPO = 'Phuongdy123/reupai'


def github_token():
    result = subprocess.run(['git', 'credential', 'fill'], input=f'protocol=https\nhost=github.com\npath={REPO}.git\n\n',
                            capture_output=True, text=True, check=True)
    values = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    if not values.get('password'):
        raise RuntimeError('Không có quyền phát hành GitHub trong Git Credential Manager.')
    return values['password']


def github_api(token, path, method='GET', data=None):
    payload = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request('https://api.github.com' + path, data=payload, method=method, headers={
        'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
        'User-Agent': 'ReupAI-Release-Publisher', 'Content-Type': 'application/json',
    })
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response) if response.status != 204 else None


def upload_asset(token, release_id, path, upload_address=None):
    connection = http.client.HTTPSConnection('uploads.github.com', timeout=120)
    if upload_address:
        # Keep HTTPS SNI and certificate verification pinned to the service.
        # Only the socket route changes, using an IP resolved for this host.
        connect = connection._create_connection
        connection._create_connection = lambda address, timeout, source_address=None: connect((str(upload_address), address[1]), timeout, source_address)
    try:
        connection.putrequest('POST', f'/repos/{REPO}/releases/{release_id}/assets?name={quote(path.name)}')
        for key, value in {
            'Authorization': 'Bearer ' + token, 'User-Agent': 'ReupAI-Release-Publisher',
            'Accept': 'application/vnd.github+json', 'Content-Type': 'application/octet-stream',
            'Content-Length': str(path.stat().st_size),
        }.items():
            connection.putheader(key, value)
        connection.endheaders()
        total = 0; next_report = 32 * 1024 * 1024
        with path.open('rb') as source:
            while chunk := source.read(1024 * 1024):
                connection.send(chunk)
                total += len(chunk)
                if total >= next_report:
                    print(f'Uploading {path.name}: {total * 100 // path.stat().st_size}%', flush=True)
                    next_report += 32 * 1024 * 1024
        response = connection.getresponse()
        data = response.read()
        if response.status != 201:
            raise RuntimeError(f'Tải asset lên GitHub chưa thành công (HTTP {response.status}).')
        return json.loads(data)
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--installer', type=Path, required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--minimum-version', default='0.2.26')
    parser.add_argument('--note', action='append', default=[])
    parser.add_argument('--key-file', type=Path, default=Path.home() / '.codex/reupai-release/update-signing-key.pem')
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--upload-route-ip', type=ipaddress.ip_address, help='Optional DNS-resolved GitHub upload IP; HTTPS hostname verification remains enabled.')
    args = parser.parse_args()
    version_tuple(args.version); version_tuple(args.minimum_version)
    installer = args.installer.resolve()
    if installer.name != f'ReupAI-Setup-{args.version}.exe' or not installer.is_file():
        raise ValueError('Tên hoặc đường dẫn bộ cài không khớp phiên bản.')
    with installer.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    from cryptography.hazmat.primitives import serialization
    key = serialization.load_pem_private_key(args.key_file.read_bytes(), password=None)
    raw_public = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    if base64.b64encode(raw_public).decode() != UPDATE_PUBLIC_KEY:
        raise ValueError('Khóa ký không khớp khóa xác minh đã đóng vào EXE.')
    tag = 'v' + args.version
    release = {
        'format': 1, 'version': args.version, 'minimumVersion': args.minimum_version,
        'platform': 'windows-x64', 'downloadUrl': f'https://github.com/{REPO}/releases/download/{tag}/{installer.name}',
        'sha256': digest, 'size': installer.stat().st_size, 'notes': args.note,
        'publishedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
    }
    payload = json.dumps(release, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    document = {'release': release, 'signature': base64.b64encode(key.sign(payload)).decode()}
    candidate = installer.with_suffix('.release.json')
    candidate.write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if not args.publish:
        print('Prepared signed release document:', candidate)
        return
    token = github_token()
    try:
        remote = github_api(token, f'/repos/{REPO}/releases/tags/{tag}')
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        # GitHub does not always expose an untagged draft through /tags/{tag}.
        releases = github_api(token, f'/repos/{REPO}/releases?per_page=100')
        remote = next((item for item in releases if item['tag_name'] == tag and item.get('draft')), None)
        if remote is None:
            commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
            remote = github_api(token, f'/repos/{REPO}/releases', 'POST', {
                'tag_name': tag, 'target_commitish': commit, 'name': 'ReupAI Local Engine ' + args.version,
                'body': '\n'.join('- ' + note for note in args.note) + f'\n\nSHA-256: `{digest}`', 'draft': True,
            })
    if not remote.get('draft'):
        raise RuntimeError('Phiên bản đã phát hành là bất biến. Hãy tăng số phiên bản để phát hành bản khác.')
    for asset in remote.get('assets', []):
        if asset['name'] in {installer.name, installer.name + '.sha256'}:
            github_api(token, f'/repos/{REPO}/releases/assets/{asset["id"]}', 'DELETE')
    checksum = installer.with_suffix('.exe.sha256')
    checksum.write_text(f'{digest}  {installer.name}\n', encoding='ascii')
    for path in [installer, checksum]:
        asset = upload_asset(token, remote['id'], path, args.upload_route_ip)
        if asset['size'] != path.stat().st_size:
            raise RuntimeError('Kích thước asset sau khi tải lên không khớp.')
        if path == installer and asset.get('digest') and asset['digest'] != 'sha256:' + digest:
            raise RuntimeError('Mã kiểm tra GitHub không khớp bộ cài.')
        print('Uploaded:', path.name)
    published = github_api(token, f'/repos/{REPO}/releases/{remote["id"]}', 'PATCH', {'draft': False})
    (ROOT / 'web/src/lib/engine-release.json').write_text(candidate.read_text(encoding='utf-8'), encoding='utf-8')
    print('Published:', published['html_url'])
    print('Signed website release document updated. Build and deploy web to activate the notification.')


if __name__ == '__main__':
    main()
