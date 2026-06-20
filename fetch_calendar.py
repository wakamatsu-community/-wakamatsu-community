"""GAS API から行事データを取得し Docs/events.json に保存する。"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from hashlib import sha256
from datetime import datetime, timezone
from pathlib import Path

_raw_url = os.environ.get("GAS_WEB_APP_URL", "").strip()
if not _raw_url:
    print("[ERROR] GitHub Secrets の GAS_WEB_APP_URL が未設定または誤設定です。", file=sys.stderr)
    sys.exit(1)
if "REPLACE_WITH" in _raw_url or "YOUR_DEPLOYMENT" in _raw_url:
    print("[ERROR] GitHub Secrets の GAS_WEB_APP_URL が未設定または誤設定です（プレースホルダーが含まれています）。", file=sys.stderr)
    sys.exit(1)


def normalize_gas_web_app_url(raw_url: str) -> str:
    url = raw_url.strip()
    if url.startswith("script.google.com/") or url.startswith("script.google.com"):
        url = "https://" + url.lstrip("/")
    elif url.startswith("www.script.google.com/") or url.startswith("www.script.google.com"):
        url = "https://" + url.lstrip("/")
    return url


GAS_WEB_APP_URL: str = normalize_gas_web_app_url(_raw_url)
if not GAS_WEB_APP_URL.startswith(("http://", "https://")):
    print("[ERROR] GAS_WEB_APP_URL は https:// から始まる完全なURLで指定してください。", file=sys.stderr)
    sys.exit(1)
OUTPUT_PATH = Path(__file__).resolve().parent / "Docs" / "events.json"


def normalize_events_for_compare(events: list[dict]) -> list[dict]:
    return sorted(
        [dict(event) for event in events],
        key=lambda item: (
            str(item.get("date", "")),
            str(item.get("title", "")),
            str(item.get("time", "")),
            str(item.get("place", "")),
        ),
    )


def events_fingerprint(events: list[dict]) -> str:
    payload = json.dumps(normalize_events_for_compare(events), ensure_ascii=False, separators=(",", ":"))
    return sha256(payload.encode("utf-8")).hexdigest()


def load_existing_snapshot() -> dict | None:
    if not OUTPUT_PATH.exists():
        return None

    try:
        with OUTPUT_PATH.open("r", encoding="utf-8") as f:
            existing = json.load(f)
    except Exception:
        return None

    if not isinstance(existing, dict):
        return None
    if not isinstance(existing.get("events"), list):
        return None
    return existing


def fetch_events_from_gas() -> list[dict]:
    url = GAS_WEB_APP_URL.rstrip("/") + "?action=getEvents"
    print(f"[INFO] アクセスURL: {url}")

    try:
        with urllib.request.urlopen(url, timeout=20) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        print(f"[ERROR] HTTPエラー {exc.code}: {url}", file=sys.stderr)
        raise
    except Exception as exc:
        print(f"[ERROR] 接続失敗 ({url}): {exc}", file=sys.stderr)
        raise

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

    existing = load_existing_snapshot()
    next_fingerprint = events_fingerprint(events)
    if existing is not None:
        existing_events = existing.get("events", [])
        existing_fingerprint = events_fingerprint(existing_events)
        if existing_fingerprint == next_fingerprint:
            print(f"[INFO] 予定データに変更がないため {OUTPUT_PATH} の更新をスキップしました。")
            return

    payload = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "fingerprint": next_fingerprint,
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
