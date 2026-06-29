#!/usr/bin/env python3
import json
import os
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs


ROOT = Path(__file__).resolve().parents[1]
STATE_FILE = ROOT / "collab-state.json"


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
    tmp = STATE_FILE.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as file:
        json.dump(state, file, ensure_ascii=False, indent=2)
    tmp.replace(STATE_FILE)


def read_body():
    length = int(os.environ.get("CONTENT_LENGTH") or "0")
    if length <= 0:
        return {}
    return json.loads(sys.stdin.read(length) or "{}")


def send(payload, status="200 OK"):
    print(f"Status: {status}")
    print("Content-Type: application/json; charset=utf-8")
    print()
    print(json.dumps(payload, ensure_ascii=False))


def public_state(state, current_member_id=None):
    payload = {
        "members": state["members"],
        "votes": state["votes"],
        "customDestinations": state["customDestinations"],
    }
    if current_member_id:
        payload["currentMemberId"] = current_member_id
    return payload


def main():
    query = parse_qs(os.environ.get("QUERY_STRING") or "")
    path = (query.get("action", [""])[0] or os.environ.get("PATH_INFO") or "/state").strip("/")
    method = os.environ.get("REQUEST_METHOD", "GET").upper()
    state = read_state()

    if method == "GET" and path == "state":
        send(public_state(state))
        return

    if method == "POST" and path == "member":
        body = read_body()
        name = str(body.get("name", "")).strip()
        class_name = str(body.get("className", "avatar-a")).strip() or "avatar-a"
        if not name:
            send({"error": "name required"}, "400 Bad Request")
            return
        member = {
            "id": uuid.uuid4().hex[:10],
            "name": name,
            "className": class_name,
            "clientJoinId": str(body.get("clientJoinId", "")),
            "joinedAt": int(time.time()),
        }
        state["members"].append(member)
        write_state(state)
        send(public_state(state, member["id"]))
        return

    if method == "POST" and path == "vote":
        body = read_body()
        member_id = str(body.get("memberId", ""))
        destination_id = str(body.get("destinationId", ""))
        vote_type = str(body.get("voteType", ""))
        if vote_type not in ("heart", "veto") or not member_id or not destination_id:
            send({"error": "invalid vote"}, "400 Bad Request")
            return
        votes = state["votes"].setdefault(destination_id, {"heart": [], "veto": []})
        votes.setdefault("heart", [])
        votes.setdefault("veto", [])
        already_selected = member_id in votes[vote_type]
        votes["heart"] = [item for item in votes["heart"] if item != member_id]
        votes["veto"] = [item for item in votes["veto"] if item != member_id]
        if not already_selected:
            votes[vote_type].append(member_id)
        write_state(state)
        send(public_state(state))
        return

    if method == "POST" and path == "destination":
        body = read_body()
        member_id = str(body.get("memberId", ""))
        destination = body.get("destination") or {}
        destination_id = str(destination.get("id", ""))
        if not member_id or not destination_id:
            send({"error": "invalid destination"}, "400 Bad Request")
            return
        state["customDestinations"] = [
            item for item in state["customDestinations"] if item.get("id") != destination_id
        ]
        state["customDestinations"].insert(0, destination)
        state["votes"][destination_id] = destination.get("votes", {"heart": [member_id], "veto": []})
        write_state(state)
        send(public_state(state))
        return

    send({"error": "not found"}, "404 Not Found")


if __name__ == "__main__":
    main()
