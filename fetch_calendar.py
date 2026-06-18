"""GAS API から行事データを取得し Docs/events.json に保存する。"""

from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

GAS_URL = "https://script.google.com/macros/s/REPLACE_WITH_YOUR_DEPLOYMENT_ID/exec"
OUTPUT_PATH = Path(__file__).resolve().parent / "Docs" / "events.json"


def fetch_events_from_gas() -> list[dict]:
    query = urllib.parse.urlencode({"type": "calendar_events"})
    url = f"{GAS_URL}?{query}"

    with urllib.request.urlopen(url, timeout=20) as response:
        body = response.read().decode("utf-8")

    payload = json.loads(body)
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        if isinstance(payload.get("events"), list):
            return payload["events"]
        if isinstance(payload.get("data"), list):
            return payload["data"]
    return []


def save_events(events: list[dict]) -> None:
    """予定リストを JSON ファイルとして保存する。"""
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "events": events,
    }
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"[INFO] {len(events)} 件の予定を {OUTPUT_PATH} に保存しました。")


def main() -> None:
    try:
        events = fetch_events_from_gas()
    except Exception as exc:  # noqa: BLE001
        print(f"[ERROR] GAS API からイベント取得に失敗しました: {exc}", file=sys.stderr)
        sys.exit(1)

    save_events(events)


if __name__ == "__main__":
    main()
