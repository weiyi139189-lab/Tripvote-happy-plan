#!/usr/bin/env python3
import json
import mimetypes
import os
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
STATE_FILE = Path(os.environ.get("TRIPVOTE_STATE_FILE", ROOT / "collab-state.json")).expanduser()
STATE_LOCK = Lock()


def default_state():
    return {"members": [], "votes": {}, "customDestinations": []}


def read_state():
    if not STATE_FILE.exists():
        return default_state()
    try:
        with STATE_FILE.open("r", encoding="utf-8") as file:
            state = json.load(file)
    except json.JSONDecodeError:
        return default_state()
    state.setdefault("members", [])
    state.setdefault("votes", {})
    state.setdefault("customDestinations", [])
    return state


def write_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as file:
        json.dump(state, file, ensure_ascii=False, indent=2)
    tmp.replace(STATE_FILE)


def public_state(state, current_member_id=None):
    result = {
        "members": state["members"],
        "votes": state["votes"],
        "customDestinations": state["customDestinations"],
    }
    if current_member_id:
        result["currentMemberId"] = current_member_id
    return result


class Handler(BaseHTTPRequestHandler):
    def _json(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self._json({"ok": True})
            return

        if parsed.path == "/api/state":
            self._json(public_state(read_state()))
            return

        path = unquote(parsed.path)
        if path == "/":
            path = "/index.html"
        file_path = (ROOT / path.lstrip("/")).resolve()
        if not str(file_path).startswith(str(ROOT)) or not file_path.exists() or file_path.is_dir():
            self.send_error(404)
            return

        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/member":
            body = self._read_json()
            name = str(body.get("name", "")).strip()
            class_name = str(body.get("className", "avatar-a")).strip() or "avatar-a"
            if not name:
                self._json({"error": "name required"}, 400)
                return
            with STATE_LOCK:
                state = read_state()
                member = {
                    "id": uuid.uuid4().hex[:10],
                    "name": name,
                    "className": class_name,
                    "clientJoinId": str(body.get("clientJoinId", "")),
                    "joinedAt": int(time.time()),
                }
                state["members"].append(member)
                write_state(state)
            self._json(public_state(state, member["id"]))
            return

        if parsed.path == "/api/vote":
            body = self._read_json()
            member_id = str(body.get("memberId", ""))
            destination_id = str(body.get("destinationId", ""))
            vote_type = str(body.get("voteType", ""))
            if vote_type not in ("heart", "veto") or not member_id or not destination_id:
                self._json({"error": "invalid vote"}, 400)
                return
            with STATE_LOCK:
                state = read_state()
                votes = state["votes"].setdefault(destination_id, {"heart": [], "veto": []})
                votes.setdefault("heart", [])
                votes.setdefault("veto", [])
                already_selected = member_id in votes[vote_type]
                votes["heart"] = [item for item in votes["heart"] if item != member_id]
                votes["veto"] = [item for item in votes["veto"] if item != member_id]
                if not already_selected:
                    votes[vote_type].append(member_id)
                write_state(state)
            self._json(public_state(state))
            return

        if parsed.path == "/api/destination":
            body = self._read_json()
            member_id = str(body.get("memberId", ""))
            destination = body.get("destination") or {}
            destination_id = str(destination.get("id", ""))
            if not member_id or not destination_id:
                self._json({"error": "invalid destination"}, 400)
                return
            with STATE_LOCK:
                state = read_state()
                state["customDestinations"] = [
                    item for item in state["customDestinations"] if item.get("id") != destination_id
                ]
                state["customDestinations"].insert(0, destination)
                state["votes"][destination_id] = destination.get("votes", {"heart": [member_id], "veto": []})
                write_state(state)
            self._json(public_state(state))
            return

        self.send_error(404)

    def log_message(self, format, *args):
        print("%s - %s" % (self.address_string(), format % args))


def main():
    port = int(os.environ.get("PORT", "4180"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"TripVote collaboration server running at http://0.0.0.0:{port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
