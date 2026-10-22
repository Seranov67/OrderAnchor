"""Allowlisted submission staging/finalization; never visits private directories."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NAME = 'OrderAnchor-submission-2026-10-22-v4'
STAGE = ROOT / 'submission' / NAME
ARCHIVE = ROOT / 'dist' / (NAME + '.zip')
BLOCKED = {'node_modules', 'secrets', 'data', 'tmp', '.git', '.codex', '.agents', '.aws', '.npm-cache', 'submission', 'dist', '__pycache__'}
EVIDENCE = [
    'testnet-cycles-export-v1.json', 'testnet-cycles-verification-2026-10-22.json',
    'rpc-history-verification-2026-10-22-v2.json',
    'rpc-history-ui-recovery-2026-10-22-v2.json',
    'demo-v2-cycles-export.json',
    'demo-v2-crash-export.json',
    'rpc-history-tests-2026-10-22.tap',
    'rpc-history-failure-diagnostic-2026-10-22.json',
    'live-cycle-2026-10-22.json', 'live-place-receipt-2026-10-22.json', 'live-cancel-receipt-2026-10-22.json',
    'crash-cycle-2026-10-22.json', 'crash-place-receipt-2026-10-22.json', 'crash-cancel-receipt-2026-10-22.json', 'crash-summary-2026-10-22.json',
    'completion-check-2026-10-22.json', 'completion-tests-2026-10-22.tap', 'english-ui-tests-2026-10-22.tap',
    'first-operation-preflight-2026-10-22.json', 'verifier-tests-2026-10-22.tap', 'local-ui-tests-2026-10-22.tap',
    'orderanchor-english-ui-2026-10-22.png',
    'sdk-offline-2026-10-20.json', 'sdk-source-2026-10-20.json', 'sdk-market-2026-10-20.json', 'sdk-receipt-2026-10-20.json',
    'network-2026-10-20T15-58-29.130Z.json', 'network-2026-10-20T15-59-45.303Z.json', 'core-tests-2026-10-20.tap',
]

def sha(data):
    return hashlib.sha256(data).hexdigest()

def safe(name):
    path = Path(name)
    if path.is_absolute() or '..' in path.parts or set(path.parts) & BLOCKED:
        raise ValueError('Forbidden payload path: ' + name)
    if path.name.startswith('.env') or re.search(r'\.(?:sqlite\d*|db|dpapi|key|pem|p12|pfx|keystore)(?:-(?:wal|shm|journal))?(?:\..*)?$', name, re.I):
        raise ValueError('Private file type: ' + name)
    return path

def scan_json(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key.lower() in {'privatekey', 'mnemonic', 'seedphrase', 'serialized', 'serializedtransaction', 'rawtransaction', 'secret', 'signature', 'r', 's', 'v'}:
                raise ValueError('Private/broadcastable evidence field: ' + key)
            scan_json(child)
    elif isinstance(value, list):
        for child in value:
            scan_json(child)

def check(name, data):
    safe(name)
    if name.endswith('.md') and re.search('[\u0400-\u04ff]', data.decode('utf-8-sig')):
        raise ValueError('Non-English documentation: ' + name)
    if name.startswith('evidence/') and name.endswith('.json'):
        scan_json(json.loads(data.decode('utf-8-sig')))
    if name.endswith(('.ts', '.js', '.mjs', '.ps1', '.py', '.md', '.json', '.yml')):
        text = data.decode('utf-8-sig')
        if re.search(r'-----BEGIN (?:EC )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]+-----END', text):
            raise ValueError('Embedded private key in ' + name)
        if re.search(r'''(?i)["']?(?:privateKey|mnemonic|seedPhrase)["']?\s*[:=]\s*["']0x[0-9a-f]{64}["']''', text):
            raise ValueError('Embedded private-key literal in ' + name)
        if re.search(r'''(?i)["']?(?:privateKey|mnemonic|seedPhrase)["']?\s*[:=]\s*["'](?:[0-9a-f]{64}|[a-z]+(?: [a-z]+){11,23})["']''', text):
            raise ValueError('Embedded key or recovery phrase in ' + name)
        if re.search(r'(?:github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,})', text):
            raise ValueError('Credential token in ' + name)

def stage():
    if STAGE.exists():
        raise ValueError('Staging directory exists; refusing to overwrite')
    selected = ['README.md', 'RUN.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', 'tsconfig.json', '.nvmrc', '.gitignore', '.github/workflows/checks.yml']
    for directory in ['src', 'ui', 'test', 'scripts', 'docs']:
        selected.extend(p.relative_to(ROOT).as_posix() for p in (ROOT / directory).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.name not in {'audit-copilot-offline.mjs', 'audit-orderproof-offline.mjs', 'verify-copilot-receipts.mjs'})
    selected.extend('evidence/' + name for name in EVIDENCE)
    selected.extend('media/demo-v2/' + name for name in ['OrderAnchor-demo-en-v2.mp4', 'OrderAnchor-demo-en-v2.mp4.sha256', 'OrderAnchor-demo-en.srt', 'TRANSCRIPT.md', 'successful-recovery.png', 'DEMO-CHECKS.json', 'README.md'])
    manifest = []
    for name in sorted(set(selected)):
        source = ROOT / safe(name)
        if source.is_symlink() or any(p.is_symlink() for p in source.parents if p != ROOT.parent):
            raise ValueError('Symlink is not permitted: ' + name)
        data = source.read_bytes()
        check(name, data)
        target = STAGE / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        manifest.append({'path': name, 'bytes': len(data), 'sha256': sha(data)})
    (STAGE / 'MANIFEST.json').write_text(json.dumps({'schema': 'orderanchor-submission/v1', 'files': manifest, 'note': 'Payload hashes; this manifest excludes itself.'}, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'stage': str(STAGE), 'payloadFiles': len(manifest), 'privateFilesIncluded': 0}))

def finalize():
    manifest = json.loads((STAGE / 'MANIFEST.json').read_text(encoding='utf-8'))
    # The clean-room validation report is the only extra file admitted after staging.
    checks = STAGE / 'PACKAGE-CHECKS.json'
    if not checks.exists():
        raise ValueError('Clean-package validation report is required')
    validation = json.loads(checks.read_text(encoding='utf-8'))
    if validation.get('typecheckExit') != 0 or validation.get('testExit') != 0 or validation.get('installExit') != 0 or validation.get('publicUiSmoke') is not True:
        raise ValueError('Clean-package validation has not passed')
    if not any(f['path'] == 'PACKAGE-CHECKS.json' for f in manifest['files']):
        data = checks.read_bytes()
        manifest['files'].append({'path': 'PACKAGE-CHECKS.json', 'bytes': len(data), 'sha256': sha(data)})
    manifest['files'].sort(key=lambda f: f['path'])
    (STAGE / 'MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    payload = {}
    for item in manifest['files']:
        name = item['path']
        data = (STAGE / safe(name)).read_bytes()
        check(name, data)
        if len(data) != item['bytes'] or sha(data) != item['sha256']:
            raise ValueError('Staged payload changed: ' + name)
        payload[name] = data
    payload['MANIFEST.json'] = (STAGE / 'MANIFEST.json').read_bytes()
    ARCHIVE.parent.mkdir(exist_ok=True)
    if ARCHIVE.exists():
        raise ValueError('Archive exists; refusing to overwrite')
    with zipfile.ZipFile(ARCHIVE, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, data in sorted(payload.items()):
            info = zipfile.ZipInfo(NAME + '/' + name, date_time=(2026, 10, 22, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    with zipfile.ZipFile(ARCHIVE) as z:
        if z.testzip() is not None or len(z.namelist()) != len(payload):
            raise ValueError('Archive CRC/inventory validation failed')
        for name, data in payload.items():
            if z.read(NAME + '/' + name) != data:
                raise ValueError('Archive content mismatch')
    checksum = sha(ARCHIVE.read_bytes())
    ARCHIVE.with_suffix('.zip.sha256').write_text(checksum + '  ' + ARCHIVE.name + '\n', encoding='ascii')
    report = {'archive': ARCHIVE.name, 'sha256': checksum, 'bytes': ARCHIVE.stat().st_size, 'files': len(payload), 'allPayloadHashesVerified': True, 'crcPassed': True, 'privateFilesIncluded': 0, 'installedDependenciesIncluded': False, 'englishDocumentationChecked': True, 'cleanPackageValidation': validation}
    (ARCHIVE.parent / 'submission-checks.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['stage', 'finalize'])
    args = parser.parse_args()
    (stage if args.mode == 'stage' else finalize)()
