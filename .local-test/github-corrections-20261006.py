import base64
import hashlib
import http.client
import json
import runpy
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
helper = runpy.run_path(str(ROOT / '.local-test/github-publish.py'))
api, credentials, REPO = helper['api'], helper['credentials'], helper['REPO']
BRANCH = 'codex/publish-v2.0.0'
TAG = 'v2.0.0-corrections'

def gates():
    delivery = json.loads((ROOT / '.local-test/delivery-corrections-20261006.json').read_text(encoding='utf-8-sig'))
    if not delivery['allFileHashesVerified'] or delivery['applicationVersion'] != '2.0.0' or delivery['releaseDate'] != '2026-10-04':
        raise RuntimeError('The verified unchanged-version delivery is required first.')
    if '28 passed' not in (ROOT / '.local-test/e2e-corrections-final-packaged-20261006.log').read_text():
        raise RuntimeError('All packaged desktop checks must pass before uploading.')
    return delivery

def sha_blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()

def publish_source():
    gates()
    token = credentials()
    repo = api('/repos/' + REPO, token)
    if not repo.get('permissions', {}).get('push'):
        raise RuntimeError('Publishing access is unavailable.')
    previous = json.loads((ROOT / '.local-test/github-published-source.json').read_text())
    head = api('/repos/' + REPO + '/git/ref/heads/' + BRANCH, token)['object']['sha']
    if head != previous['commit']:
        raise RuntimeError('The clean source branch changed independently; review it before publishing.')
    remote = api('/repos/' + REPO + '/git/trees/' + head + '?recursive=1', token)
    if remote.get('truncated'):
        raise RuntimeError('The remote tree is truncated.')
    blobs = {entry['path']: entry for entry in remote['tree'] if entry['type'] == 'blob'}
    roots = ['src', 'electron', 'shared', 'build', 'tests', 'docs', 'examples']
    files = ['.gitattributes', '.gitignore', 'CHANGELOG.md', 'README.md', 'LICENSE', 'index.html',
        'package.json', 'package-lock.json', 'playwright.config.ts', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts']
    for directory in roots:
        for path in (ROOT / directory).rglob('*'):
            if path.is_file():
                if not path.resolve().is_relative_to(ROOT):
                    raise RuntimeError('Source path escaped the workspace.')
                files.append(path.relative_to(ROOT).as_posix())
    files = sorted(set(files))
    if len(files) != gates()['sourceFiles']:
        raise RuntimeError('Source inventory differs from the verified ZIP.')
    unknown = set(blobs) - set(files) - {p for p in blobs if p.startswith('.github/')}
    if unknown:
        raise RuntimeError('Existing unrelated remote source would be omitted.')
    hashed = subprocess.run(['git', 'hash-object', '--stdin-paths'], cwd=ROOT,
        input='\n'.join(files) + '\n', text=True, capture_output=True, check=True).stdout.splitlines()
    if len(hashed) != len(files):
        raise RuntimeError('Git source hashing returned an unexpected inventory.')
    tree, manifest, changed = [], [], []
    for path, sha in zip(files, hashed):
        raw = (ROOT / path).read_bytes()
        normalized = raw if sha_blob(raw) == sha else raw.replace(b'\r\n', b'\n')
        if sha_blob(normalized) != sha:
            raise RuntimeError('Unexpected Git source filter: ' + path)
        if path not in blobs or blobs[path]['sha'] != sha:
            created = api('/repos/' + REPO + '/git/blobs', token, 'POST', {
                'content': base64.b64encode(normalized).decode('ascii'), 'encoding': 'base64'})
            if created['sha'] != sha:
                raise RuntimeError('Uploaded source digest differs: ' + path)
            changed.append(path)
        tree.append({'path': path, 'mode': blobs.get(path, {}).get('mode', '100644'), 'type': 'blob', 'sha': sha})
        manifest.append({'path': path, 'git_sha': sha, 'sha256': hashlib.sha256(raw).hexdigest()})
    for entry in blobs.values():
        if entry['path'].startswith('.github/'):
            tree.append({key: entry[key] for key in ('path', 'mode', 'type', 'sha')})
    if api('/repos/' + REPO + '/git/ref/heads/' + BRANCH, token)['object']['sha'] != head:
        raise RuntimeError('The source branch changed during upload preparation.')
    new_tree = api('/repos/' + REPO + '/git/trees', token, 'POST', {'tree': tree})
    commit = api('/repos/' + REPO + '/git/commits', token, 'POST', {
        'message': 'Correct Global selection, hidden headers and Grey theme in v2.0.0\n\nKeep version 2.0.0 and the release date of 04 October 2026. Preserve environment scopes and sessions, collapse hidden headers on navigation, improve Grey contrast, and document 415 passing regression checks plus the tested portable build.',
        'tree': new_tree['sha'], 'parents': [head]})
    api('/repos/' + REPO + '/git/refs/heads/' + BRANCH, token, 'PATCH', {'sha': commit['sha'], 'force': False})
    verified = api('/repos/' + REPO + '/git/trees/' + commit['sha'] + '?recursive=1', token)
    actual = {e['path']: e['sha'] for e in verified['tree'] if e['type'] == 'blob'}
    if actual != {e['path']: e['sha'] for e in tree}:
        raise RuntimeError('Published source verification failed.')
    output = {'repository': REPO, 'branch': BRANCH, 'commit': commit['sha'], 'parent': head,
        'source_files': len(files), 'changed_files': changed, 'verified': True, 'manifest': manifest,
        'version': '2.0.0', 'release_date': '2026-10-04', 'url': 'https://github.com/' + REPO + '/tree/' + BRANCH}
    (ROOT / '.local-test/github-corrections-source-20261006.json').write_text(json.dumps(output, indent=2))
    print(json.dumps({k: v for k, v in output.items() if k != 'manifest'}, indent=2), flush=True)

def upload_asset(release, path, name, digest, token):
    url = urllib.parse.urlsplit(release['upload_url'].split('{')[0])
    if url.scheme != 'https' or url.hostname != 'uploads.github.com':
        raise RuntimeError('Unexpected asset upload host.')
    connection = http.client.HTTPSConnection(url.hostname, timeout=90)
    connection.putrequest('POST', url.path + '?' + urllib.parse.urlencode({'name': name}))
    headers = {'Authorization': 'Bearer ' + token, 'User-Agent': 'API-Manager-release-publisher',
        'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/zip' if name.endswith('.zip') else ('text/plain' if name.endswith('.txt') else 'application/octet-stream'),
        'Content-Length': str(path.stat().st_size)}
    for key, value in headers.items():
        connection.putheader(key, value)
    connection.endheaders()
    sent, last_report = 0, time.monotonic()
    with path.open('rb') as file:
        while chunk := file.read(1024 * 1024):
            connection.send(chunk); sent += len(chunk)
            if time.monotonic() - last_report >= 20:
                print(json.dumps({'upload': name, 'percent': round(100 * sent / path.stat().st_size)}), flush=True)
                last_report = time.monotonic()
    response = connection.getresponse()
    status, result = response.status, json.loads(response.read())
    connection.close()
    if status != 201 or result['state'] != 'uploaded' or result['size'] != path.stat().st_size or result.get('digest') != 'sha256:' + digest:
        raise RuntimeError('GitHub upload/digest verification failed for ' + name)
    return result

def publish_release():
    delivery = gates()
    source = json.loads((ROOT / '.local-test/github-corrections-source-20261006.json').read_text())
    if not source['verified']:
        raise RuntimeError('Verified source upload is required.')
    output_dir = Path(delivery['folder'])
    files = [(output_dir / 'API Manager 2.0.0.exe', 'API-Manager-2.0.0.exe'),
        (output_dir / 'API Manager Setup 2.0.0.exe', 'API-Manager-Setup-2.0.0.exe'),
        (output_dir / 'API-Manager-2.0.0.zip', 'API-Manager-2.0.0.zip')]
    expected = {}
    for path, name in files:
        with path.open('rb') as file:
            expected[name] = hashlib.file_digest(file, 'sha256').hexdigest()
    if expected['API-Manager-2.0.0.zip'].upper() != delivery['sha256']:
        raise RuntimeError('ZIP changed after delivery verification.')
    for path, name in files[:2]:
        if expected[name].upper() != delivery['executableHashes']['release/' + path.name]:
            raise RuntimeError('Executable changed after verification.')
    checksum = ROOT / '.local-test/SHA256SUMS-corrections-20261006.txt'
    checksum.write_text(''.join(sha + '  ' + name + '\n' for name, sha in expected.items()), encoding='utf-8')
    expected['SHA256SUMS.txt'] = hashlib.sha256(checksum.read_bytes()).hexdigest()
    files.append((checksum, 'SHA256SUMS.txt'))
    token = credentials()
    refs = api('/repos/' + REPO + '/git/matching-refs/tags/' + TAG, token)
    exact = [ref for ref in refs if ref['ref'] == 'refs/tags/' + TAG]
    if exact:
        if exact[0]['object']['sha'] != source['commit']:
            raise RuntimeError('An existing corrections tag was left untouched because it points elsewhere.')
    else:
        api('/repos/' + REPO + '/git/refs', token, 'POST', {'ref': 'refs/tags/' + TAG, 'sha': source['commit']})
    state_path = ROOT / '.local-test/github-corrections-release-20261006.json'
    matching = [r for r in api('/repos/' + REPO + '/releases', token) if r['tag_name'] == TAG]
    if matching:
        saved = json.loads(state_path.read_text()) if state_path.exists() else {}
        if matching[0]['id'] != saved.get('id'):
            raise RuntimeError('An existing release not owned by this publishing run was left untouched.')
        release = matching[0]
    else:
        notes = (ROOT / 'CHANGELOG.md').read_text(encoding='utf-8').split('## v2.0.0 — 2026-10-04\n', 1)[1].split('\n## v1.0.0', 1)[0].strip()
        notes = notes.replace('(docs/verification.md)', '(https://github.com/' + REPO + '/blob/' + source['commit'] + '/docs/verification.md)')
        body = ('**Application version: v2.0.0. Release date: 04 October 2026.**\n\n'
            'This is a corrected build of the existing release. The original download remains available; the corrections tag identifies this source build without changing the application version or release history.\n\n'
            '## Downloads\n\n'
            '- **API-Manager-2.0.0.exe**: Windows x64 portable application.\n'
            '- **API-Manager-Setup-2.0.0.exe**: Windows x64 installer.\n'
            '- **API-Manager-2.0.0.zip**: complete source, built assets, both executables, README, examples and tests. Extract All, then follow README.md.\n'
            '- **SHA256SUMS.txt**: checksums for the three downloads.\n\n'
            'The local ui-update ZIP is an identical compatibility alias; this release offers one canonical ZIP. Builds are unsigned. Close the running application before using the new build; workspace storage is unchanged.\n\n'
            '## Release notes\n\n' + notes + '\n\n'
            '## Verification\n\n'
            'The corrected build passed314 unit tests,73 native tests and28 packaged desktop scenarios:415 automated checks. The actual portable EXE also passed JSON/SOAP, Global, hidden headers, popup, appearance, Help/date, response Search, Console and code-generation smoke checks. All uploaded files match the verified delivery hashes. '
            'Production dependency audit:0 findings. Unresolved build-tool advisories are documented in '
            '[the verification report](https://github.com/' + REPO + '/blob/' + source['commit'] + '/docs/verification.md).\n')
        body = body.replace('passed314', 'passed 314').replace('tests,73', 'tests, 73').replace('and28', 'and 28').replace(':415', ': 415').replace('audit:0', 'audit: 0')
        release = api('/repos/' + REPO + '/releases', token, 'POST', {'tag_name': TAG,
            'target_commitish': source['commit'], 'name': 'API Manager v2.0.0 — corrected build',
            'body': body, 'draft': True, 'prerelease': False})
        state_path.write_text(json.dumps({'id': release['id'], 'source_commit': source['commit'], 'draft': True}, indent=2))
        print(json.dumps({'release': release['id'], 'draft': True}), flush=True)
    assets = {a['name']: a for a in release['assets']}
    for path, name in files:
        if name in assets:
            asset = assets[name]
            if asset.get('digest') != 'sha256:' + expected[name] or asset['size'] != path.stat().st_size or asset['state'] != 'uploaded':
                raise RuntimeError('An existing release asset differs and was left untouched.')
        else:
            asset = upload_asset(release, path, name, expected[name], token)
        print(json.dumps({'uploaded': name, 'bytes': asset['size'], 'sha256_verified': True}), flush=True)
    remote = api('/repos/' + REPO + '/releases/' + str(release['id']), token)
    if {a['name'] for a in remote['assets']} != set(expected) or any(a.get('digest') != 'sha256:' + expected[a['name']] for a in remote['assets']):
        raise RuntimeError('Draft asset inventory failed verification.')
    api('/repos/' + REPO + '/releases/' + str(release['id']), token, 'PATCH', {
        'tag_name': TAG, 'target_commitish': source['commit'], 'draft': False, 'make_latest': 'true'})
    published = api('/repos/' + REPO + '/releases/tags/' + TAG, token)
    tag = api('/repos/' + REPO + '/git/ref/tags/' + TAG, token)
    if published['id'] != release['id'] or published['draft'] or tag['object']['sha'] != source['commit']:
        raise RuntimeError('Published release version verification failed.')
    result = {'id': published['id'], 'tag': TAG, 'version': '2.0.0', 'release_date': '2026-10-04',
        'source_commit': source['commit'], 'url': published['html_url'], 'verified': True,
        'assets': [{'name': a['name'], 'size': a['size'], 'digest': a.get('digest'), 'url': a['browser_download_url']} for a in published['assets']]}
    state_path.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2), flush=True)

if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['source']:
            publish_source()
        elif sys.argv[1:] == ['release']:
            publish_release()
        else:
            raise RuntimeError('Choose source or release after final delivery verification.')
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
