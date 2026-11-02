"""Run actual floor GATT Java source against deterministic Android boundary stubs.

This is lifecycle/failure replay, not Android or Native.js integration acceptance.
All generated classes stay in a temporary directory; stubs never enter the AAR.
"""
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
jdk = Path(os.environ.get('FLOOR_JAVA_HOME', '/Applications/HBuilderX.app/Contents/HBuilderX/plugins/amazon-corretto'))
source = root / 'native/floor-scale/src/com/xintuo/scale'
tests = root / 'native/floor-scale/test'
sources = [source / 'OwnedResource.java', source / 'FloorScaleGatt.java',
           tests / 'OwnedResourceTest.java', tests / 'FloorScaleGattTest.java',
           *sorted((tests / 'stubs').rglob('*.java'))]
with tempfile.TemporaryDirectory(prefix='floor-gatt-test-') as temporary:
    subprocess.run([str(jdk / 'bin/javac'), '--release', '8', '-Xlint:all', '-d', temporary, *map(str, sources)], check=True)
    for test in ['com.xintuo.scale.OwnedResourceTest', 'com.xintuo.scale.FloorScaleGattTest']:
        subprocess.run([str(jdk / 'bin/java'), '-ea', '-cp', temporary, test], check=True, timeout=30)
