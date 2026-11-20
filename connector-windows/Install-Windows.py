"""Register the per-user native messaging host for Zen and Firefox."""
import json
import os
from pathlib import Path
import shutil
import sys
import winreg

source = Path(__file__).resolve().parent
target = Path(os.environ["LOCALAPPDATA"]) / "ReadAloudEdge"
target.mkdir(parents=True, exist_ok=True)
for name in ("host.py", "worker.js"):
    shutil.copy2(source / name, target / name)

runner = target / "run.bat"
runner.write_text('@echo off\r\n"%s" -u "%s"\r\n' % (sys.executable, target / "host.py"), encoding="ascii")
manifest = target / "com.readaloud.edge.json"
manifest.write_text(json.dumps({
    "name": "com.readaloud.edge",
    "description": "Read Aloud Edge voice connector",
    "type": "stdio",
    "path": str(runner),
    "allowed_extensions": ["read-aloud-edge@local.codex"],
}, indent=2), encoding="utf-8")
with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Mozilla\NativeMessagingHosts\com.readaloud.edge") as key:
    winreg.SetValueEx(key, "", 0, winreg.REG_SZ, str(manifest))
print("Installed Read Aloud Edge connector for this Windows user.")
print("Import Aria-provider.json in Read Aloud > Voice Options > Configure speech API.")
