#!/usr/bin/env python3
"""
Fetch last 15 log lines for all running Docker containers via Docker API unix socket.
No docker CLI required — works inside the Telegraf container as long as
/var/run/docker.sock is mounted.

Output: JSON  {"<container_id_short>": ["line1", "line2", ...], ...}
Portal metric name: container_logs
Telegraf reads this via inputs.exec (data_format = "value", data_type = "string").
"""
import http.client
import json
import socket
import struct
import sys
import urllib.parse

SOCKET_PATH    = "/var/run/docker.sock"
TAIL           = 15
MAX_CONTAINERS = 20


class _UnixConn(http.client.HTTPConnection):
    def connect(self):
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.connect(SOCKET_PATH)
        self.sock = s


def _get(path: str):
    conn = _UnixConn("localhost")
    conn.request("GET", path, headers={"Accept": "application/json"})
    resp = conn.getresponse()
    return json.loads(resp.read())


def _logs(cid: str, tail: int = TAIL) -> list[str]:
    """
    Fetch container logs via Docker API.
    Docker wraps each log line in an 8-byte header:
      [stream(1)] [0,0,0(3)] [size big-endian uint32(4)]
    """
    path = f"/containers/{cid}/logs?stdout=1&stderr=1&tail={tail}&timestamps=0"
    conn = _UnixConn("localhost")
    conn.request("GET", path, headers={"Accept": "application/octet-stream"})
    resp = conn.getresponse()
    data = resp.read()

    lines = []
    i = 0
    while i + 8 <= len(data):
        size = struct.unpack(">I", data[i + 4 : i + 8])[0]
        i += 8
        if i + size > len(data):
            break
        line = data[i : i + size].decode("utf-8", errors="replace").rstrip("\n")
        if line:
            lines.append(line)
        i += size
    return lines


try:
    filt  = urllib.parse.quote('{"status":["running"]}')
    ctrs  = _get(f"/containers/json?filters={filt}")
except Exception:
    print("{}")
    sys.exit(0)

result: dict[str, list[str]] = {}
for c in ctrs[:MAX_CONTAINERS]:
    cid = (c.get("Id") or "")[:12]
    if not cid:
        continue
    try:
        lines = _logs(cid)
        if lines:
            result[cid] = lines
    except Exception:
        pass

print(json.dumps(result))
