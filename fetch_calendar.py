"""GAS API から行事データを取得し Docs/events.json に保存する。"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from hashlib import sha256
from datetime import datetime, timezone
from pathlib import Path

# 個人情報サニタイズ用正規表現 (電話番号・メールアドレス)
PHONE_REGEX = re.compile(r"(\d{2,4}-\d{2,4}-\d{4}|\b0\d{9,10}\b)")
EMAIL_REGEX = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")

def sanitize_public_text(text: str) -> str:
    """公開テキストから個人情報（電話番号・メールアドレス）をサニタイズする。"""
    if not text:
        return ""
    sanitized = PHONE_REGEX.sub("[連絡先保護]", text)
    sanitized = EMAIL_REGEX.sub("[メール保護]", sanitized)
    return sanitized

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


def fetch_json_from_url(url: str) -> list[dict]:
    try:
        with urllib.request.urlopen(url, timeout=20) as response:
            body = response.read().decode("utf-8")
    except Exception as exc:
        print(f"[WARN] 取得失敗 ({url}): {exc}", file=sys.stderr)
        return []

    payload = json.loads(body)
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        if isinstance(payload.get("data"), list):
            return payload["data"]
        if isinstance(payload.get("events"), list):
            return payload["events"]
    return []


def fetch_events_from_gas() -> list[dict]:
    # 1. 町内会公式行事 (getTownEvents)
    town_url = GAS_WEB_APP_URL.rstrip("/") + "?action=getTownEvents"
    print(f"[INFO] 公式行事取得: {town_url}")
    town_events = fetch_json_from_url(town_url)

    # 2. 会員企画・追加イベント (getEvents)
    comm_url = GAS_WEB_APP_URL.rstrip("/") + "?action=getEvents"
    print(f"[INFO] 企画イベント取得: {comm_url}")
    comm_events = fetch_json_from_url(comm_url)

    # 要件6: 公開行事のみを抽出し、会員限定・未承認の行事や個人情報を排除する
    ALLOWED_KEYS = {"id", "title", "start", "end", "place", "description", "category", "allDay"}

    # 企画イベントの承認状態・公開性チェック
    valid_comm_events = []
    for item in comm_events:
        if not isinstance(item, dict):
            continue
        status = str(item.get("status") or "").lower()
        if status and status not in ("approved", "published"):
            print(f"[INFO] 未承認または下書きの企画イベントを除外しました: {item.get('title')}")
            continue
        is_public = item.get("isPublic")
        if is_public is False or str(is_public).lower() in ("false", "0"):
            print(f"[INFO] 非公開の企画イベントを除外しました: {item.get('title')}")
            continue
        valid_comm_events.append(item)

    combined: list[dict] = []
    seen_keys: set[str] = set()

    for item in town_events + valid_comm_events:
        if not isinstance(item, dict):
            continue
        title = sanitize_public_text(str(item.get("title") or item.get("summary") or "").strip())
        start = str(item.get("start") or item.get("startDate") or item.get("date") or "").strip()
        if not title or not start:
            continue

        key = f"{title}_{start[:10]}"
        if key in seen_keys:
            continue
        seen_keys.add(key)

        # 許可リスト方式で公開属性のみを出力
        event_obj = {
            "id": str(item.get("id") or item.get("eventId") or key),
            "title": title,
            "start": start,
            "end": str(item.get("end") or item.get("endDate") or "").strip(),
            "place": sanitize_public_text(str(item.get("place") or item.get("location") or "").strip()),
            "description": sanitize_public_text(str(item.get("description") or item.get("note") or "").strip()),
            "category": str(item.get("category") or "町内行事").strip(),
            "allDay": bool(item.get("allDay") or len(start) == 10),
        }
        # 許可リスト以外のキーが紛れ込まないよう厳格フィルタ
        safe_obj = {k: v for k, v in event_obj.items() if k in ALLOWED_KEYS}
        combined.append(safe_obj)

    print(f"[INFO] 取得完了: 公式行事={len(town_events)}件, 企画イベント(承認済)={len(valid_comm_events)}件, 合計={len(combined)}件")
    return combined


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
