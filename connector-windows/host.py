"""Firefox native host for Edge's installed speech voices on Windows."""
import contextlib
import http.server
import json
import msvcrt
import os
from pathlib import Path
import queue
import secrets
import shutil
import struct
import subprocess
import sys
import tempfile
import threading

for stream in (sys.stdin, sys.stdout):
    msvcrt.setmode(stream.fileno(), os.O_BINARY)

SCRIPT = Path(__file__).with_name("worker.js").read_bytes()
TOKEN = secrets.token_urlsafe(32)
commands = queue.Queue()
write_lock = threading.Lock()
finished = threading.Event()


def find_edge():
    for root in (os.environ.get("PROGRAMFILES(X86)"), os.environ.get("PROGRAMFILES"), os.environ.get("LOCALAPPDATA")):
        if root:
            path = Path(root) / "Microsoft" / "Edge" / "Application" / "msedge.exe"
            if path.is_file():
                return str(path)
    raise FileNotFoundError("Microsoft Edge was not found. Install Edge and try again.")


def emit(message):
    data = json.dumps(message, ensure_ascii=False).encode()
    with write_lock:
        sys.stdout.buffer.write(struct.pack("=I", len(data)) + data)
        sys.stdout.buffer.flush()


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, data=b"", mime="text/plain"):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        with contextlib.suppress(BrokenPipeError, ConnectionResetError):
            self.wfile.write(data)

    def local(self):
        return self.headers.get("Host") == self.server.authority

    def do_GET(self):
        if self.local() and self.path == "/":
            self.reply(200, b'<!doctype html><meta charset=utf-8><title>Read Aloud</title><script defer src="/worker.js"></script>', "text/html")
        elif self.local() and self.path == "/worker.js":
            self.reply(200, SCRIPT, "text/javascript")
        else:
            self.reply(404)

    def do_POST(self):
        if not self.local() or not secrets.compare_digest(self.headers.get("X-Reader", ""), TOKEN):
            return self.reply(403)
        if self.path == "/next":
            try:
                command = commands.get(timeout=12)
            except queue.Empty:
                command = {}
            return self.reply(200, json.dumps(command).encode(), "application/json")
        if self.path != "/event":
            return self.reply(404)
        size = int(self.headers.get("Content-Length", "0"))
        if not 0 < size <= 512000:
            return self.reply(400)
        emit(json.loads(self.rfile.read(size)))
        self.reply(204)


def receive():
    try:
        while True:
            header = sys.stdin.buffer.read(4)
            if len(header) != 4:
                return
            size, = struct.unpack("=I", header)
            if size > 262144:
                return
            commands.put(json.loads(sys.stdin.buffer.read(size)))
    finally:
        finished.set()


def main():
    with http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        server.authority = "127.0.0.1:%s" % server.server_port
        profile = tempfile.mkdtemp(prefix="read-aloud-edge-")
        process = None
        try:
            process = subprocess.Popen([
                find_edge(), "--headless=new", "--no-first-run", "--no-default-browser-check",
                "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling",
                "--user-data-dir=" + profile, "http://" + server.authority + "/#" + TOKEN
            ], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            threading.Thread(target=receive, daemon=True).start()
            while not finished.wait(.25):
                if process.poll() is not None:
                    emit({"kind": "failure", "message": "The Edge voice process exited."})
                    break
        finally:
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        with contextlib.suppress(BrokenPipeError):
            emit({"kind": "failure", "message": str(error)})
