#!/usr/bin/env python3
"""Create a CWS ZIP with manifest.json at its root; no build dependencies."""
import argparse
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
STORE_035 = '8c053b1a8aad91b4f7df0fe98cb92fc619d4e7d2'
STORE_036 = '809dec7735a80c6df62395a26ceae3058fdeef16'
p = argparse.ArgumentParser()
p.add_argument('--version', choices=['0.3.5', '0.3.6', '0.3.7'], default='0.3.7')
p.add_argument('--output', type=Path)
args = p.parse_args()
if args.version in ['0.3.5', '0.3.6']:
    revision = STORE_035 if args.version == '0.3.5' else STORE_036
    paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', revision, 'extension/'], cwd=ROOT, text=True).splitlines()
    files = {name.removeprefix('extension/'): subprocess.check_output(['git', 'show', f'{revision}:{name}'], cwd=ROOT) for name in paths}
else:
    files = {str(path.relative_to(ROOT / 'extension')): path.read_bytes() for path in (ROOT / 'extension').rglob('*') if path.is_file()}
manifest = json.loads(files['manifest.json'])
assert manifest['version'] == args.version
assert all(not name.endswith(('.zip', '.har', '.pem', '.key')) for name in files)
if args.version == '0.3.5':
    assert not any('grok.com' in host for host in manifest['host_permissions'])
output = args.output or ROOT / 'artifacts' / f'usage-meter-{args.version}.zip'
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, content in sorted(files.items()):
        item = zipfile.ZipInfo(name, date_time=(2026, 10, 29 if args.version == '0.3.7' else 21, 0, 0, 0))
        item.compress_type = zipfile.ZIP_DEFLATED
        item.external_attr = 0o100644 << 16
        archive.writestr(item, content)
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
print(f'{output}: {len(files)} files, version {manifest["version"]}')
