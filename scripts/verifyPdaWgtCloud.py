#!/usr/bin/env python3
"""Validate emitted cloud initialization, not unrelated URLs containing the space ID."""
import argparse
import json
import re
import zipfile


def verify(path, version):
    with zipfile.ZipFile(path) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        assert manifest['id'] == '__UNI__756A841', 'Unexpected appid'
        assert manifest['version']['name'] == version, 'Unexpected version'
        source = archive.read('app-service.js').decode('utf-8')
    candidates = re.findall(r'\[\{"provider":"alipay"[^\n]*?\}\]', source)
    for candidate in candidates:
        try:
            spaces = json.loads(candidate)
        except ValueError:
            continue
        for space in spaces:
            if (space.get('spaceId') == 'env-00jxuffegf2n'
                    and all(space.get(key) for key in ('spaceAppId', 'accessKey', 'secretKey'))):
                return
    raise AssertionError('Missing production uniCloud initialization in WGT')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('package')
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    verify(args.package, args.version)
    print('WGT app/version and production uniCloud initialization verified')
