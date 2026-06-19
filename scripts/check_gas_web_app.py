#!/usr/bin/env python3
"""Preflight check for GAS Web App endpoint.

This script verifies that both GET and POST requests to the configured
GAS Web App URL return JSON responses with HTTP 2xx.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def fail(message: str) -> None:
    print(f"ERROR: {message}")
    sys.exit(1)


def summarize(text: str, limit: int = 200) -> str:
    normalized = " ".join(str(text or "").split())
    if len(normalized) <= limit:
        return normalized
    return normalized[:limit] + "..."


def normalize_gas_url(url: str) -> str:
    normalized = url.strip()
    if normalized.startswith("script.google.com/") or normalized.startswith("script.google.com"):
        normalized = "https://" + normalized.lstrip("/")
    elif normalized.startswith("www.script.google.com/") or normalized.startswith("www.script.google.com"):
        normalized = "https://" + normalized.lstrip("/")
    return normalized


def request_json(url: str, method: str, payload: dict | None = None) -> dict:
    data = None
    headers = {"Accept": "application/json"}

    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "text/plain;charset=utf-8"

    req = urllib.request.Request(url, method=method, data=data, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            status = int(response.getcode() or 0)
            raw = response.read().decode("utf-8", errors="replace")
            content_type = response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else ""
        fail(f"{method} failed with HTTP {e.code}. body={summarize(body)}")
    except Exception as e:  # noqa: BLE001
        fail(f"{method} request failed: {e}")

    if status < 200 or status >= 300:
        fail(f"{method} failed with HTTP {status}")

    try:
        parsed = json.loads(raw)
    except Exception:  # noqa: BLE001
        if "スクリプト関数が見つかりません: doPost" in raw:
            fail(
                "POST endpoint is missing doPost in deployed GAS. "
                "Apps Script の公開中バージョンに doPost が含まれていません。"
                " doPost を含む最新コードで Webアプリを再デプロイし、"
                "その /exec URL を .env.local と GitHub Secrets に設定してください。"
            )
        fail(
            f"{method} returned non-JSON. "
            f"content-type={content_type or '<none>'}, body={summarize(raw)}"
        )

    if not isinstance(parsed, dict):
        fail(f"{method} returned JSON but not an object: {type(parsed).__name__}")

    return parsed


def main() -> None:
    gas_url = normalize_gas_url(os.environ.get("GAS_WEB_APP_URL", ""))
    if not gas_url:
        fail("GAS_WEB_APP_URL is empty")

    if not gas_url.startswith(("http://", "https://")):
        fail("GAS_WEB_APP_URL must start with http:// or https://")
    if "script.google.com/macros/s/" not in gas_url or not gas_url.endswith("/exec"):
        fail("GAS_WEB_APP_URL format looks invalid (expected deployed /exec URL)")

    get_url = gas_url + ("&" if "?" in gas_url else "?") + urllib.parse.urlencode({"action": "health"})
    get_result = request_json(get_url, "GET")

    post_result = request_json(
        gas_url,
        "POST",
        payload={"action": "health"},
    )

    get_data = get_result.get("data") if isinstance(get_result, dict) else None
    post_data = post_result.get("data") if isinstance(post_result, dict) else None
    if not isinstance(get_data, dict) or not isinstance(post_data, dict):
        fail("Health response shape is invalid (missing data object)")
    if str(get_data.get("hasDoPost", "")).lower() != "true" or str(post_data.get("hasDoPost", "")).lower() != "true":
        fail("Health response indicates doPost is not available in deployed GAS")

    print(
        "OK: GAS endpoint preflight passed "
        f"(build={get_data.get('build', 'unknown')}, GET keys={sorted(get_result.keys())}, POST keys={sorted(post_result.keys())})"
    )


if __name__ == "__main__":
    main()
