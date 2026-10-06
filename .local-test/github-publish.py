import json
import hashlib
import http.client
import time
import urllib.parse
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = 'manishkumars264/API-Managerv2.0.0'
API = 'https://api.github.com'

def credentials():
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never'}
    result = subprocess.run(['git', 'credential', 'fill'], cwd=ROOT, env=env,
        input='protocol=https\nhost=github.com\npath=' + REPO + '.git\n\n',
        text=True, capture_output=True, timeout=25)
    if result.returncode:
        raise RuntimeError('No usable non-interactive GitHub publishing credential was available.')
    fields = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    if not fields.get('password'):
        raise RuntimeError('The GitHub credential helper did not return an authenticated credential.')
    return fields['password']

def api(path, token, method='GET', data=None):
    body = None if data is None else json.dumps(data).encode('utf-8')
    req = urllib.request.Request(API + path, data=body, method=method, headers={
        'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'API-Manager-release-publisher',
        'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        message = json.loads(error.read()).get('message', 'Request failed')
        raise RuntimeError(f'GitHub {method} {path}: HTTP {error.code}: {message}') from None

def inspect():
    token = credentials()
    user = api('/user', token)
    repo = api('/repos/' + REPO, token)
    branch = api('/repos/' + REPO + '/branches/' + repo['default_branch'].replace('/', '%2F'), token)
    releases = api('/repos/' + REPO + '/releases', token)
    tree = api('/repos/' + REPO + '/git/trees/' + branch['commit']['sha'] + '?recursive=1', token)
    counts = {}
    for entry in tree['tree']:
        if entry['type'] == 'blob':
            top = entry['path'].split('/')[0]
            counts[top] = counts.get(top, 0) + 1
    result = {'login': user['login'], 'repository': REPO, 'permissions': repo.get('permissions'),
        'default_branch': repo['default_branch'], 'remote_sha': branch['commit']['sha'],
        'protected': branch['protected'], 'remote_file_counts': counts,
        'tree_truncated': tree.get('truncated'),
        'root_files': [entry['path'] for entry in tree['tree'] if '/' not in entry['path'] and entry['type'] == 'blob'],
        'workflows': [entry['path'] for entry in tree['tree'] if entry['path'].startswith('.github/') and entry['type'] == 'blob'],
        'releases': [{'id': r['id'], 'tag': r['tag_name'], 'draft': r['draft'], 'url': r['html_url'],
            'assets': [{'name': a['name'], 'size': a['size'], 'digest': a.get('digest')} for a in r['assets']]} for r in releases]}
    (ROOT / '.local-test/github-publish-inspect.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))

def publish_source():
    token = credentials()
    repo = api('/repos/' + REPO, token)
    if not repo.get('permissions', {}).get('push'):
        raise RuntimeError('The authenticated account cannot publish to this repository.')
    default_branch = repo['default_branch']
    publish_branch = 'codex/publish-v2.0.0'
    refs = api('/repos/' + REPO + '/git/matching-refs/heads/' + publish_branch, token)
    if any(r['ref'] == 'refs/heads/' + publish_branch for r in refs):
        raise RuntimeError('The publishing branch already exists; inspect it before making another upload.')
    head = api('/repos/' + REPO + '/git/ref/heads/' + default_branch, token)['object']['sha']
    remote = api('/repos/' + REPO + '/git/trees/' + head + '?recursive=1', token)
    if remote.get('truncated'):
        raise RuntimeError('The remote tree was truncated; publishing stopped before mutation.')
    blobs = {e['path']: e for e in remote['tree'] if e['type'] == 'blob'}
    roots = ['src', 'electron', 'shared', 'build', 'tests', 'docs', 'examples']
    files = ['.gitattributes', '.gitignore', 'CHANGELOG.md', 'README.md', 'LICENSE',
        'index.html', 'package.json', 'package-lock.json', 'playwright.config.ts',
        'tsconfig.json', 'vite.config.ts', 'vitest.config.ts']
    for directory in roots:
        files.extend(p.relative_to(ROOT).as_posix() for p in (ROOT / directory).rglob('*') if p.is_file())
    files = sorted(files)
    if len(files) != 101:
        raise RuntimeError('The source inventory differs from the verified 101-file delivery.')
    hashed = subprocess.run(['git', 'hash-object', '--stdin-paths'], cwd=ROOT,
        input='\n'.join(files) + '\n', text=True, capture_output=True, check=True)
    hashes = hashed.stdout.splitlines()
    if len(hashes) != len(files):
        raise RuntimeError('Source hashing returned an unexpected result.')
    tree = []
    manifest = []
    for path, sha in zip(files, hashes):
        if path not in blobs or blobs[path]['sha'] != sha:
            raise RuntimeError('Live source differs from the already committed tested release: ' + path)
        tree.append({'path': path, 'mode': blobs[path]['mode'], 'type': 'blob', 'sha': sha})
        manifest.append({'path': path, 'git_sha': sha,
            'sha256': hashlib.sha256((ROOT / path).read_bytes()).hexdigest()})
    preserved = [e for e in blobs.values() if e['path'].startswith('.github/')]
    for entry in preserved:
        tree.append({key: entry[key] for key in ('path', 'mode', 'type', 'sha')})
    omitted = sorted(set(blobs) - {e['path'] for e in tree})
    allowed_generated = ('node_modules/', '.local-test/', 'dist/', 'release/', 'test-results/', 'playwright-report/')
    if any(not (p.startswith(allowed_generated) or p in ('.local-audit.json', 'tsconfig.tsbuildinfo')) for p in omitted):
        raise RuntimeError('The new branch would omit an unrelated source file; publishing stopped.')
    new_tree = api('/repos/' + REPO + '/git/trees', token, 'POST', {'tree': tree})
    commit = api('/repos/' + REPO + '/git/commits', token, 'POST', {
        'message': 'Publish clean API Manager v2.0.0 source\n\nInclude tested source, documentation, examples and the existing workflow. Distribute Windows binaries and the complete ZIP as release assets. Existing branches and commit history are preserved.',
        'tree': new_tree['sha'], 'parents': [head]})
    created = api('/repos/' + REPO + '/git/refs', token, 'POST',
        {'ref': 'refs/heads/' + publish_branch, 'sha': commit['sha']})
    verify = api('/repos/' + REPO + '/git/trees/' + commit['sha'] + '?recursive=1', token)
    actual = {e['path']: e['sha'] for e in verify['tree'] if e['type'] == 'blob'}
    expected = {e['path']: e['sha'] for e in tree}
    if actual != expected or created['object']['sha'] != commit['sha']:
        raise RuntimeError('The remote source tree did not match the reviewed upload.')
    if api('/repos/' + REPO + '/git/ref/heads/' + default_branch, token)['object']['sha'] != head:
        raise RuntimeError('The default branch changed independently while the upload was running; inspect it.')
    output = {'repository': REPO, 'branch': publish_branch, 'default_branch_unchanged': True,
        'parent': head, 'commit': commit['sha'], 'source_files': len(files),
        'preserved_workflow_files': len(preserved), 'omitted_generated_files': len(omitted),
        'verified': True, 'manifest': manifest, 'url': 'https://github.com/' + REPO + '/tree/' + publish_branch}
    (ROOT / '.local-test/github-published-source.json').write_text(json.dumps(output, indent=2))
    print(json.dumps({k: v for k, v in output.items() if k != 'manifest'}, indent=2))

def upload_asset(release, path, token, expected, upload_name=None):
    endpoint = urllib.parse.urlsplit(release['upload_url'].split('{')[0])
    if endpoint.scheme != 'https' or endpoint.hostname != 'uploads.github.com':
        raise RuntimeError('Unexpected GitHub upload host; credential forwarding stopped.')
    query = urllib.parse.urlencode({'name': upload_name or path.name})
    connection = http.client.HTTPSConnection(endpoint.hostname, timeout=90)
    connection.putrequest('POST', endpoint.path + '?' + query)
    for name, value in {
        'Authorization': 'Bearer ' + token,
        'User-Agent': 'API-Manager-release-publisher',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/zip' if path.suffix == '.zip' else ('text/plain' if path.suffix == '.txt' else 'application/octet-stream'),
        'Content-Length': str(path.stat().st_size),
    }.items():
        connection.putheader(name, value)
    connection.endheaders()
    sent = 0
    last_report = time.monotonic()
    with path.open('rb') as file:
        while chunk := file.read(1024 * 1024):
            connection.send(chunk)
            sent += len(chunk)
            if time.monotonic() - last_report >= 20:
                print(json.dumps({'upload': path.name, 'percent': round(sent * 100 / path.stat().st_size)}), flush=True)
                last_report = time.monotonic()
    response = connection.getresponse()
    status = response.status
    data = json.loads(response.read())
    connection.close()
    if status != 201:
        raise RuntimeError(f'GitHub asset upload returned HTTP {status}: ' + data.get('message', 'Upload failed'))
    if data['state'] != 'uploaded' or data['size'] != path.stat().st_size or data.get('digest') != 'sha256:' + expected:
        raise RuntimeError('Uploaded asset checksum or size differs from the tested delivery: ' + path.name)
    return data

def publish_release():
    source = json.loads((ROOT / '.local-test/github-published-source.json').read_text())
    if not source.get('verified') or source['repository'] != REPO:
        raise RuntimeError('A verified source upload is required first.')
    expected = {
        'API Manager 2.0.0.exe': '2c5c96b576c5238dfc799cd2e6ae0e88907ba14cff005af24bd2d856d72992d7',
        'API Manager Setup 2.0.0.exe': '3871f84af7902be53e2b02305e5f938ed4da2d0f8454cdc02dae6a12432dfd1e',
        'API-Manager-2.0.0.zip': 'bcd2f9885a570fab3da297349e5ba54bbcaa527e708cece87824dbfd3e655169',
    }
    upload_names = {'API Manager 2.0.0.exe': 'API-Manager-2.0.0.exe',
        'API Manager Setup 2.0.0.exe': 'API-Manager-Setup-2.0.0.exe',
        'API-Manager-2.0.0.zip': 'API-Manager-2.0.0.zip'}
    paths = []
    for name, sha in expected.items():
        path = ROOT / 'release' / name
        with path.open('rb') as file:
            actual = hashlib.file_digest(file, 'sha256').hexdigest()
        if actual != sha:
            raise RuntimeError('Release file differs from the tested delivery: ' + name)
        paths.append((path, upload_names[name]))
    checksum = ROOT / '.local-test' / 'SHA256SUMS.txt'
    checksum.write_text(''.join(sha + '  ' + upload_names[name] + '\n' for name, sha in expected.items()), encoding='utf-8')
    expected = {upload_names[name]: sha for name, sha in expected.items()}
    expected[checksum.name] = hashlib.sha256(checksum.read_bytes()).hexdigest()
    paths.append((checksum, checksum.name))
    token = credentials()
    existing = api('/repos/' + REPO + '/releases', token)
    state_path = ROOT / '.local-test/github-published-release.json'
    matching = [r for r in existing if r['tag_name'] == 'v2.0.0']
    if matching:
        saved = json.loads(state_path.read_text()) if state_path.exists() else {}
        if matching[0]['id'] != saved.get('id'):
            raise RuntimeError('A v2.0.0 release already exists and was not created by this publishing run.')
        release = matching[0]
    else:
        notes = (ROOT / 'CHANGELOG.md').read_text(encoding='utf-8')
        notes = notes.split('## v2.0.0 — 2026-10-04\n', 1)[1].split('\n## v1.0.0', 1)[0].strip()
        notes = notes.replace('(docs/verification.md)', '(https://github.com/' + REPO + '/blob/' + source['commit'] + '/docs/verification.md)')
        body = ('API Manager v2.0.0 is a major upgrade to v1.0.0. It stores your API workspace locally and requires no API Manager account.\n\n'
            '## Downloads\n\n'
            '- **API Manager 2.0.0.exe**: Windows x64 portable application; run without installing.\n'
            '- **API Manager Setup 2.0.0.exe**: Windows x64 installer.\n'
            '- **API-Manager-2.0.0.zip**: complete source project, built assets, both executables, README, examples, and local tests. Extract All, then follow README.md.\n'
            '- **SHA256SUMS.txt**: SHA-256 checksums for the three downloads.\n\n'
            'The ui-update ZIP shared earlier is identical to the complete ZIP; this release provides one canonical ZIP. Workspace data remains in the application data folder. Export a backup and close v1 before upgrading. Builds are unsigned.\n\n'
            '## Release notes\n\n' + notes + '\n\n'
            '## Verification\n\n'
            'The preceding feature-complete build passed 411 automated checks. The final icon-only patch passed a production build, two targeted packaged desktop scenarios and an additional actual portable-executable smoke check. Uploaded binary and ZIP checksums match that tested delivery. '
            '[Detailed coverage and practical limits](https://github.com/' + REPO + '/blob/' + source['commit'] + '/docs/verification.md).\n')
        release = api('/repos/' + REPO + '/releases', token, 'POST', {
            'tag_name': 'v2.0.0', 'target_commitish': source['commit'], 'name': 'API Manager v2.0.0',
            'body': body, 'draft': True, 'prerelease': False})
        state_path.write_text(json.dumps({'id': release['id'], 'tag': release['tag_name'], 'draft': True, 'source_commit': source['commit']}, indent=2))
        print(json.dumps({'release': release['id'], 'state': 'draft prepared'}), flush=True)
    if release['id'] != 403376782 or not release['draft']:
        raise RuntimeError('Expected this publishing run\'s draft release; existing public releases are left untouched.')
    for asset in release['assets']:
        if asset['name'] in ('API.Manager.2.0.0.exe', 'API.Manager.Setup.2.0.0.exe'):
            canonical = 'API-Manager-Setup-2.0.0.exe' if 'Setup' in asset['name'] else 'API-Manager-2.0.0.exe'
            if asset.get('digest') != 'sha256:' + expected[canonical]:
                raise RuntimeError('The draft asset cannot be safely renamed because its digest differs.')
            api('/repos/' + REPO + '/releases/assets/' + str(asset['id']), token, 'PATCH', {'name': canonical})
        if asset['name'] == checksum.name and asset.get('digest') != 'sha256:' + expected[checksum.name]:
            if asset.get('digest') != 'sha256:3c868086e05908ad15a0ddcb8f71cefa38fad93e309356cb2a39670a00812ca1':
                raise RuntimeError('An unknown checksum asset was left untouched.')
            # Replace only the unpublished checksum created by this run; binaries remain intact.
            api('/repos/' + REPO + '/releases/assets/' + str(asset['id']), token, 'DELETE')
    release = api('/repos/' + REPO + '/releases/' + str(release['id']), token)
    body = release['body'].replace('**API Manager 2.0.0.exe**', '**API-Manager-2.0.0.exe**').replace('**API Manager Setup 2.0.0.exe**', '**API-Manager-Setup-2.0.0.exe**')
    body = body.replace('(docs/verification.md)', '(https://github.com/' + REPO + '/blob/' + source['commit'] + '/docs/verification.md)')
    api('/repos/' + REPO + '/releases/' + str(release['id']), token, 'PATCH', {'body': body})
    assets = {a['name']: a for a in release['assets']}
    for path, upload_name in paths:
        sha = expected[upload_name]
        if upload_name in assets:
            asset = assets[upload_name]
            if asset['state'] != 'uploaded' or asset['size'] != path.stat().st_size or asset.get('digest') != 'sha256:' + sha:
                raise RuntimeError('An existing asset differs from the tested file; it was left untouched: ' + path.name)
        else:
            asset = upload_asset(release, path, token, sha, upload_name)
        assets[upload_name] = asset
        print(json.dumps({'uploaded': path.name, 'size': asset['size'], 'sha256_verified': True}), flush=True)
    remote = api('/repos/' + REPO + '/releases/' + str(release['id']), token)
    if {a['name'] for a in remote['assets']} != set(expected):
        raise RuntimeError('The draft release asset inventory differs from the reviewed delivery.')
    for asset in remote['assets']:
        if asset.get('digest') != 'sha256:' + expected[asset['name']]:
            raise RuntimeError('Final draft asset digest verification failed.')
    published = api('/repos/' + REPO + '/releases/' + str(release['id']), token, 'PATCH',
        {'tag_name': 'v2.0.0', 'target_commitish': source['commit'], 'draft': False, 'make_latest': 'true'})
    tag = api('/repos/' + REPO + '/git/ref/tags/v2.0.0', token)
    if tag['object']['sha'] != source['commit'] or published['draft']:
        raise RuntimeError('Published release tag verification failed.')
    output = {'id': published['id'], 'tag': published['tag_name'], 'draft': False,
        'source_commit': source['commit'], 'url': published['html_url'], 'verified': True,
        'assets': [{'name': a['name'], 'size': a['size'], 'digest': a.get('digest'), 'url': a['browser_download_url']} for a in published['assets']]}
    state_path.write_text(json.dumps(output, indent=2))
    print(json.dumps(output, indent=2), flush=True)

def finalize_release():
    source = json.loads((ROOT / '.local-test/github-published-source.json').read_text())
    saved = json.loads((ROOT / '.local-test/github-published-release.json').read_text())
    if saved['id'] != 403376782 or source['repository'] != REPO or not source['verified']:
        raise RuntimeError('The release is not the one created by this publishing run.')
    token = credentials()
    release = api('/repos/' + REPO + '/releases/' + str(saved['id']), token)
    if release['target_commitish'] != source['commit'] or release.get('immutable'):
        raise RuntimeError('Unexpected or immutable release; finalization stopped.')
    refs = api('/repos/' + REPO + '/git/matching-refs/tags/v2.0.0', token)
    exact = [r for r in refs if r['ref'] == 'refs/tags/v2.0.0']
    if exact:
        if exact[0]['object']['sha'] != source['commit']:
            raise RuntimeError('An existing v2.0.0 tag points to another commit and was left untouched.')
    else:
        api('/repos/' + REPO + '/git/refs', token, 'POST', {'ref': 'refs/tags/v2.0.0', 'sha': source['commit']})
    api('/repos/' + REPO + '/releases/' + str(release['id']), token, 'PATCH', {
        'tag_name': 'v2.0.0', 'target_commitish': source['commit'], 'name': 'API Manager v2.0.0',
        'draft': False, 'prerelease': False, 'make_latest': 'true'})
    published = api('/repos/' + REPO + '/releases/tags/v2.0.0', token)
    tag = api('/repos/' + REPO + '/git/ref/tags/v2.0.0', token)
    expected = {'API-Manager-2.0.0.exe': '2c5c96b576c5238dfc799cd2e6ae0e88907ba14cff005af24bd2d856d72992d7',
        'API-Manager-Setup-2.0.0.exe': '3871f84af7902be53e2b02305e5f938ed4da2d0f8454cdc02dae6a12432dfd1e',
        'API-Manager-2.0.0.zip': 'bcd2f9885a570fab3da297349e5ba54bbcaa527e708cece87824dbfd3e655169',
        'SHA256SUMS.txt': hashlib.sha256((ROOT / '.local-test/SHA256SUMS.txt').read_bytes()).hexdigest()}
    if published['id'] != saved['id'] or published['draft'] or tag['object']['sha'] != source['commit']:
        raise RuntimeError('Published release version verification failed.')
    if {a['name'] for a in published['assets']} != set(expected):
        raise RuntimeError('Published release asset inventory differs from the tested delivery.')
    for asset in published['assets']:
        if asset['state'] != 'uploaded' or asset.get('digest') != 'sha256:' + expected[asset['name']]:
            raise RuntimeError('Published release checksum verification failed.')
    output = {'id': published['id'], 'tag': published['tag_name'], 'draft': False,
        'source_commit': source['commit'], 'url': published['html_url'], 'verified': True,
        'assets': [{'name': a['name'], 'size': a['size'], 'digest': a.get('digest'), 'url': a['browser_download_url']} for a in published['assets']]}
    (ROOT / '.local-test/github-published-release.json').write_text(json.dumps(output, indent=2))
    print(json.dumps(output, indent=2), flush=True)

if __name__ == '__main__':
    try:
        if len(sys.argv) > 1 and sys.argv[1] == 'source':
            publish_source()
        elif len(sys.argv) > 1 and sys.argv[1] == 'release':
            publish_release()
        elif len(sys.argv) > 1 and sys.argv[1] == 'finalize':
            finalize_release()
        else:
            inspect()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
