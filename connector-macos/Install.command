#!/bin/sh
set -eu
cd "$(dirname "$0")"
python3 - <<'PY'
import json
from pathlib import Path
import shlex
import shutil
import sys

support = Path.home() / "Library/Application Support"
target = support / "Read Aloud with Edge"
if not Path("/Applications/Microsoft Edge.app").is_dir():
    sys.exit("Install Microsoft Edge in Applications, then run this installer again.")
target.mkdir(parents=True, exist_ok=True)
for filename in ("host.py", "worker.js"):
    shutil.copyfile(filename, target / filename)
launcher = target / "run"
launcher.write_text("#!/bin/sh\nexec " + shlex.join([sys.executable, str(target / "host.py")]) + "\n")
launcher.chmod(0o755)
for browser in ("Mozilla", "zen"):
    directory = support / browser / "NativeMessagingHosts"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "com.readaloud.edge.json").write_text(json.dumps(dict(
        name="com.readaloud.edge", description="Read Aloud Edge voice connector",
        type="stdio", path=str(launcher), allowed_extensions=["read-aloud-edge@local.codex"]
    ), indent=2))
print("Installed. In Voice Options → Configure speech API, import Aria-provider.json and choose Save and use provider.")
PY
