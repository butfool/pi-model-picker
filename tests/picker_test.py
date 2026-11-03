#!/usr/bin/env python3
"""End-to-end smoke test for the packaged extension.

Starts the real Pi TUI inside a temporary agent directory, opens /model-ui, and
checks how configured thinking levels render in the model list and inspector.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

import pexpect

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
ANSI = re.compile(
    r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)"
    r"|\x1b\[[0-9;?]*[A-Za-z]"
    r"|\x1b[()][A-Za-z0-9]"
)

MODELS = [
    {"id": "reasoned", "name": "Reasoned", "reasoning": True},
    {"id": "plain", "name": "Plain", "reasoning": True},
    {
        "id": "clamped",
        "name": "Clamped",
        "reasoning": True,
        "thinkingLevelMap": {
            "off": None,
            "minimal": None,
            "low": "low",
            "medium": None,
            "high": "high",
        },
    },
]

CASES = [
    {
        "name": "configured level renders in the list and as a slider",
        "model": "probe/reasoned",
        "expected": ["Reasoned [medium]", "THINKING  medium", "━"],
        "forbidden": [],
    },
    {
        "name": "model without a configured level stays bare",
        "model": "probe/plain",
        "expected": ["Plain"],
        "forbidden": ["THINKING"],
    },
    {
        "name": "unsupported configured level reports the clamped value",
        "model": "probe/clamped",
        "expected": ["Clamped [high]", "THINKING  high", "(configured medium)"],
        "forbidden": [],
    },
]


def strip_ansi(text: str) -> str:
    return ANSI.sub("", text)


def write_agent(agent_dir: Path) -> None:
    agent_dir.mkdir(parents=True, exist_ok=True)
    models = {
        "providers": {
            "probe": {
                "name": "Probe",
                "baseUrl": "http://127.0.0.1:9/v1",
                "api": "openai-completions",
                "apiKey": "probe-key",
                "models": MODELS,
            }
        }
    }
    settings = {
        "quietStartup": True,
        "defaultProvider": "probe",
        "defaultModel": "reasoned",
        "packages": [str(PACKAGE_ROOT)],
        "modelThinkingLevels": {
            "probe/reasoned": "medium",
            "probe/clamped": "medium",
        },
    }
    for name, payload in (("models.json", models), ("settings.json", settings)):
        (agent_dir / name).write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")


def read_until(child: pexpect.spawn, needle: str, timeout: float = 30.0) -> str:
    chunks: list[str] = []
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            chunks.append(child.read_nonblocking(65536, timeout=0.2))
        except pexpect.TIMEOUT:
            continue
        except pexpect.EOF:
            break
        if needle in strip_ansi("".join(chunks)):
            break
    return "".join(chunks)


def capture(child: pexpect.spawn, seconds: float) -> str:
    chunks: list[str] = []
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            chunks.append(child.read_nonblocking(65536, timeout=0.2))
        except pexpect.TIMEOUT:
            continue
        except pexpect.EOF:
            break
    return "".join(chunks)


def run_picker(agent_dir: Path, work_dir: Path, model: str) -> str:
    env = dict(os.environ, PI_CODING_AGENT_DIR=str(agent_dir))
    child = pexpect.spawn(
        "pi",
        [
            "--model", model,
            "--no-session",
            "--offline",
            "--no-mcp",
            "--no-skills",
            "--no-context-files",
        ],
        cwd=str(work_dir),
        env=env,
        dimensions=(40, 120),
        encoding="utf-8",
        timeout=30,
    )
    try:
        provider, model_id = model.split("/", 1)
        startup = read_until(child, f"({provider}) {model_id}")
        capture(child, 0.5)
        child.send("/model-ui\r")
        picker = read_until(child, "MODEL STUDIO")
        picker += capture(child, 1.0)
        child.send("\x1b")
        capture(child, 0.5)
        child.send("\x03")
        capture(child, 0.5)
    finally:
        child.close(force=True)
    return strip_ansi(startup + picker)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="pi-model-picker-") as tmp:
        root = Path(tmp)
        agent_dir = root / "agent"
        work_dir = root / "work"
        work_dir.mkdir()
        write_agent(agent_dir)

        failures = 0
        for case in CASES:
            text = run_picker(agent_dir, work_dir, case["model"])
            problems = [f"missing {item!r}" for item in case["expected"] if item not in text]
            problems += [f"unexpected {item!r}" for item in case["forbidden"] if item in text]
            if problems:
                failures += 1
                print(f"FAIL  {case['name']}: {', '.join(problems)}")
                print("\n".join(text.splitlines()[-30:]))
            else:
                print(f"PASS  {case['name']}")

        return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
