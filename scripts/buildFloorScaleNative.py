"""Build the floor-only dependency AAR without modifying the vendor SDK."""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

root = Path(__file__).resolve().parent.parent
jdk = Path(os.environ.get('FLOOR_JAVA_HOME', '/Applications/HBuilderX.app/Contents/HBuilderX/plugins/amazon-corretto'))
android = Path(os.environ.get('FLOOR_ANDROID_JAR', str(Path.home() / 'Library/Android/sdk/platforms/android-34/android.jar')))
sources = sorted((root / 'native/floor-scale/src').rglob('*.java'))
output = root / 'nativeplugins/TH-PlatformSDK/android/XintuoFloorScale-1.aar'

def archive(entries):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, content in sorted(entries.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, content)
    return stream.getvalue()

with tempfile.TemporaryDirectory(prefix='floor-native-') as temp:
    work = Path(temp); classes = work / 'classes'; classes.mkdir()
    subprocess.run([str(jdk / 'bin/javac'), '-source', '8', '-target', '8', '-Xlint:-options', '-classpath', str(android), '-d', str(classes), *map(str, sources)], check=True)
    tests = work / 'test'; tests.mkdir()
    subprocess.run([str(jdk / 'bin/javac'), '--release', '8', '-d', str(tests), str(root / 'native/floor-scale/src/com/xintuo/scale/OwnedResource.java'), str(root / 'native/floor-scale/test/OwnedResourceTest.java')], check=True)
    subprocess.run([str(jdk / 'bin/java'), '-cp', str(tests), 'com.xintuo.scale.OwnedResourceTest'], check=True)
    jar = archive({str(p.relative_to(classes)): p.read_bytes() for p in classes.rglob('*.class')})
    aar = archive({
        'classes.jar': jar,
        'AndroidManifest.xml': b'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.xintuo.scale"><uses-sdk android:minSdkVersion="23"/></manifest>',
        'proguard.txt': b'-keep class com.xintuo.scale.** { *; }\n',
        'R.txt': b'',
    })
    output.parent.mkdir(parents=True, exist_ok=True); output.write_bytes(aar)
    print(json.dumps({'aar': str(output), 'bytes': len(aar), 'sha256': hashlib.sha256(aar).hexdigest()}, ensure_ascii=False))
