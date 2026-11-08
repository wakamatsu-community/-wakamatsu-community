#!/usr/bin/env python3
"""Build static site files for deployment."""

from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

IGNORED_DIRS = {
    ".git",
    ".github",
    ".vscode",
    "dist",
    "scripts",
    "secrets",
    "venv",
    ".venv",
    "node_modules",
}
IGNORED_FILES = {
    ".env",
    ".env.local",
    ".env.example",
    ".env.local.example",
}

RUNTIME_CONFIG_KEYS = [
    "GAS_WEB_APP_URL",
    "GOOGLE_CALENDAR_API_KEY",
    "GOOGLE_CALENDAR_ID",
    "FIREBASE_API_KEY",
    "FIREBASE_AUTH_DOMAIN",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_STORAGE_BUCKET",
    "FIREBASE_MESSAGING_SENDER_ID",
    "FIREBASE_APP_ID",
    "FIREBASE_MEASUREMENT_ID",
]


def normalize_gas_url(url: str) -> str:
    normalized = url.strip()
    if normalized.startswith("script.google.com/") or normalized.startswith("script.google.com"):
        normalized = "https://" + normalized.lstrip("/")
    elif normalized.startswith("www.script.google.com/") or normalized.startswith("www.script.google.com"):
        normalized = "https://" + normalized.lstrip("/")
    return normalized


def load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def should_ignore(path: Path) -> bool:
    if any(part in IGNORED_DIRS for part in path.parts):
        return True
    if path.name in IGNORED_FILES:
        return True
    if path.suffix in {".pyc", ".pyo"}:
        return True
    return False


def safe_copy(src: Path, dst: Path) -> None:
    try:
        shutil.copy2(src, dst)
    except Exception:
        with open(src, "rb") as fsrc, open(dst, "wb") as fdst:
            shutil.copyfileobj(fsrc, fdst)


def copy_workspace() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    for item in ROOT.iterdir():
        if should_ignore(item):
            continue

        target = DIST / item.name
        if item.is_dir():
            shutil.copytree(
                item,
                target,
                copy_function=safe_copy,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
            )
        else:
            safe_copy(item, target)


# Firebase Web SDK 公開接続設定 (クライアント配布用の公開値のみ。秘密鍵・パスワードは含みません)
DEFAULT_FIREBASE_CONFIG = {
    "FIREBASE_API_KEY": "AIzaSyCG1BF6gwCofHTPi0gCDZ6bpR2SEzGiEnI",
    "FIREBASE_AUTH_DOMAIN": "wakamatu-hp.firebaseapp.com",
    "FIREBASE_PROJECT_ID": "wakamatu-hp",
    "FIREBASE_STORAGE_BUCKET": "wakamatu-hp.firebasestorage.app",
    "FIREBASE_MESSAGING_SENDER_ID": "987020427074",
    "FIREBASE_APP_ID": "1:987020427074:web:aef35a2492d6a5ed6cd2db",
    "FIREBASE_MEASUREMENT_ID": "G-GYHXRC3HXP",
}


def inject_runtime_config() -> None:
    runtime_config = {}
    for key in RUNTIME_CONFIG_KEYS:
        val = os.getenv(key, "").strip()
        if not val and key in DEFAULT_FIREBASE_CONFIG:
            val = DEFAULT_FIREBASE_CONFIG[key]
        runtime_config[key] = val

    runtime_config["GAS_WEB_APP_URL"] = normalize_gas_url(runtime_config["GAS_WEB_APP_URL"])
    if not runtime_config["GAS_WEB_APP_URL"]:
        raise RuntimeError(
            "GAS_WEB_APP_URL が未設定です。"
            "ローカル検証では .env.local に GAS_WEB_APP_URL を設定するか、"
            "環境変数 GAS_WEB_APP_URL を設定してから実行してください。"
        )
    runtime_config_path = DIST / "js" / "runtime-config.js"
    runtime_config_path.parent.mkdir(parents=True, exist_ok=True)

    content = (
        "window.RUNTIME_CONFIG = "
        + json.dumps(runtime_config, ensure_ascii=False, indent=2)
        + ";\n\n"
        + "window.GAS_WEB_APP_URL = window.RUNTIME_CONFIG.GAS_WEB_APP_URL;\n"
        + "window.GAS_URL = window.RUNTIME_CONFIG.GAS_WEB_APP_URL;\n\n"
        + "const runtime = (typeof window !== \"undefined\" && window.RUNTIME_CONFIG)\n"
        + "    ? window.RUNTIME_CONFIG\n"
        + "    : {};\n\n"
        + "const defaultUserMap = {\n"
        + "    niina: \"niina@gmail.com\",\n"
        + "    officer: \"officer@gmail.com\",\n"
        + "    member: \"member@gmail.com\"\n"
        + "};\n"
        + "const customUserMap = (typeof runtime.AUTH_USER_MAP === \"object\" && runtime.AUTH_USER_MAP !== null)\n"
        + "    ? runtime.AUTH_USER_MAP\n"
        + "    : {};\n\n"
        + "const AUTH_USER_MAP = Object.freeze({\n"
        + "    ...defaultUserMap,\n"
        + "    ...customUserMap\n"
        + "});\n\n"
        + "const RUNTIME_CONFIG = Object.freeze(runtime);\n\n"
        + "if (typeof window !== \"undefined\") {\n"
        + "    window.RUNTIME_CONFIG = RUNTIME_CONFIG;\n"
        + "    window.AUTH_USER_MAP = AUTH_USER_MAP;\n"
        + "}\n\n"
        + "export { RUNTIME_CONFIG, AUTH_USER_MAP };\n"
    )
    runtime_config_path.write_text(content, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build static site files for deployment.")
    parser.add_argument("--mode", choices=["local", "ci"], default="local")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.mode == "local":
        load_env_file(ROOT / ".env.local")
    copy_workspace()
    inject_runtime_config()
    print(f"[INFO] Built site to: {DIST}")


if __name__ == "__main__":
    main()
