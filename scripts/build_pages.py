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


def should_ignore(path: Path) -> bool:
    if any(part in IGNORED_DIRS for part in path.parts):
        return True
    if path.name in IGNORED_FILES:
        return True
    if path.suffix in {".pyc", ".pyo"}:
        return True
    return False


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
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
            )
        else:
            shutil.copy2(item, target)


def inject_runtime_config() -> None:
    runtime_config = {
        key: os.getenv(key, "").strip()
        for key in RUNTIME_CONFIG_KEYS
    }
    runtime_config_path = DIST / "js" / "runtime-config.js"
    runtime_config_path.parent.mkdir(parents=True, exist_ok=True)

    content = (
        "window.RUNTIME_CONFIG = "
        + json.dumps(runtime_config, ensure_ascii=False, indent=2)
        + ";\n\n"
        + "const runtime = (typeof window !== \"undefined\" && window.RUNTIME_CONFIG)\n"
        + "    ? window.RUNTIME_CONFIG\n"
        + "    : {};\n\n"
        + "export const RUNTIME_CONFIG = Object.freeze(runtime);\n"
    )
    runtime_config_path.write_text(content, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build static site files for deployment.")
    parser.add_argument("--mode", choices=["local", "ci"], default="local")
    return parser.parse_args()


def main() -> None:
    _args = parse_args()
    copy_workspace()
    inject_runtime_config()
    print(f"[INFO] Built site to: {DIST}")


if __name__ == "__main__":
    main()
