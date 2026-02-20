#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
from pathlib import Path
from typing import Dict, Any, Optional


DB_DIR = Path("db")
USERS_FILE = DB_DIR / "users.txt"
LOGS_FILE = DB_DIR / "logs.txt"


def load_users_map(path: Path) -> Dict[int, Optional[int]]:
    """
    Returns mapping: user_id -> doc_id
    """
    m: Dict[int, Optional[int]] = {}
    if not path.exists():
        print(f"[WARN] users file not found: {path}")
        return m

    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            print(f"[WARN] bad JSON in users at line {i}")
            continue

        user_id = obj.get("id")
        doc_id = obj.get("doc_id")
        if isinstance(user_id, int):
            m[user_id] = doc_id if isinstance(doc_id, int) else None

    return m


def safe_get_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    return str(v)


def print_log_entry(entry: dict, user_doc_map: Dict[int, Optional[int]]) -> None:
    log_id = entry.get("id")
    user_id = entry.get("user_id")
    doc_id = user_doc_map.get(user_id) if isinstance(user_id, int) else None
    ts = entry.get("ts")

    body = safe_get_str(entry.get("body"))  # важно: body, не prompt
    response = safe_get_str(entry.get("response"))

    header_parts = []
    header_parts.append(f"id={log_id}")
    header_parts.append(f"user_id={user_id}")
    header_parts.append(f"doc_id={doc_id if doc_id is not None else '—'}")
    if ts:
        header_parts.append(f"ts={ts}")

    print("=" * 90)
    print(" | ".join(header_parts))
    print("-" * 90)
    print("BODY:")
    # body уже содержит реальные \n (если в файле они были записаны как символы новой строки)
    # Если вдруг в body лежат литералы '\\n', можно раскомментировать следующую строку:
    # body = body.replace("\\n", "\n")
    print(body if body else "—")
    print("-" * 90)
    print("RESPONSE:")
    print(response if response else "—")
    print("=" * 90)
    print()  # пустая строка между записями


def main() -> None:
    ap = argparse.ArgumentParser(description="Parse db/logs.txt and pretty-print entries.")
    ap.add_argument("--doc_id", type=int, default=None, help="Filter logs by user doc_id")
    args = ap.parse_args()
    filter_doc_id = args.doc_id

    user_doc_map = load_users_map(USERS_FILE)

    if not LOGS_FILE.exists():
        print(f"[ERROR] logs file not found: {LOGS_FILE}")
        return

    lines = LOGS_FILE.read_text(encoding="utf-8").splitlines()
    total = 0
    bad = 0

    for i, line in enumerate(lines, start=1):
        line = line.strip()
        if not line:
            continue

        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            bad += 1
            print(f"[WARN] bad JSON in logs at line {i}")
            continue

        if not isinstance(entry, dict):
            bad += 1
            print(f"[WARN] non-object JSON in logs at line {i}")
            continue

        # Фильтр по doc_id, если задан
        if filter_doc_id is not None:
            user_id = entry.get("user_id")
            doc_id = user_doc_map.get(user_id) if isinstance(user_id, int) else None
            if doc_id != filter_doc_id:
                continue

        total += 1
        print_log_entry(entry, user_doc_map)

    print(f"Done. Parsed logs: {total}. Bad lines: {bad}.")


if __name__ == "__main__":
    main()
