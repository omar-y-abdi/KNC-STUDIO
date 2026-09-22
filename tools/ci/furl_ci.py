"""GitHub run-step shell: compact successful logs, never hide a failed command.

Use Furl's log-specific transform, not its CCR-enabled adaptive CLI. Successful
verbose logs are intentionally lossy; no original is uploaded or retrievable.
Short, failed, binary, oversized, and workflow-command logs pass through intact.
"""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import tempfile
from typing import BinaryIO

MAX_INPUT_BYTES = 8 * 1024 * 1024
MIN_LINES = 80
HEARTBEAT_SECONDS = 30


def compress(text: str) -> str:
    # Lazy import keeps failure reporting/cleanup working even without Furl.
    from furl_ctx.transforms.log_compressor import LogCompressor, LogCompressorConfig

    result = LogCompressor(LogCompressorConfig(enable_ccr=False, max_total_lines=80)).compress(text)
    if result.cache_key is not None or "<<ccr:" in result.compressed:
        raise ValueError("CI output must not require retrieval")
    return result.compressed


def render_log(log: BinaryIO, status: int, output: BinaryIO) -> None:
    def original() -> None:
        log.seek(0)
        shutil.copyfileobj(log, output, length=64 * 1024)

    log.seek(0)
    if status or os.environ.get("FURL_CI_DISABLED") == "1":
        original()
        return
    raw = log.read(MAX_INPUT_BYTES + 1)
    # Never let Furl drop/reorder Actions annotations, masks or stop-commands.
    if len(raw) > MAX_INPUT_BYTES or raw.count(b"\n") < MIN_LINES or b"::" in raw or b"##[" in raw:
        original()
        return
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        original()
        return
    try:
        compact = compress(text).encode("utf-8")
        if not compact:
            original()
            return
        if not compact.endswith(b"\n"):
            compact += b"\n"
        before, after = len(raw.splitlines()), len(compact.splitlines())
        # Include summary overhead when deciding whether output is actually smaller.
        summary = f"[furl-ci] {before} -> {after} log lines; CCR off; successful output compacted.\n".encode()
        if len(summary) + len(compact) >= len(raw):
            original()
            return
        output.write(summary + compact)
    except Exception as exc:
        # A logging dependency must never change the command's exit status.
        output.write(f"[furl-ci] compression unavailable ({type(exc).__name__}); original output follows.\n".encode())
        original()


def run(script: str) -> int:
    # Disk-backed, private and automatically deleted, including after cancellation.
    with tempfile.TemporaryFile() as log:
        # Match the workflow's original unspecified Linux shell: bash -e {0}.
        # Do not add pipefail here: that would change existing step semantics.
        child = subprocess.Popen(["bash", "-e", script], stdout=log, stderr=subprocess.STDOUT,
                                 start_new_session=True)
        cancelled = 0

        def forward(signum: int, _frame: object) -> None:
            nonlocal cancelled
            cancelled = signum
            try:
                os.killpg(child.pid, signum)
            except ProcessLookupError:
                pass

        handlers = {sig: signal.signal(sig, forward) for sig in (signal.SIGINT, signal.SIGTERM)}
        try:
            while True:
                try:
                    status = child.wait(timeout=HEARTBEAT_SECONDS)
                    break
                except subprocess.TimeoutExpired:
                    print("[furl-ci] step still running; output buffered until completion.", flush=True)
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)
        status = 128 + cancelled if cancelled else (128 - status if status < 0 else status)
        render_log(log, status, sys.stdout.buffer)
        sys.stdout.buffer.flush()
        return status


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python3 tools/ci/furl_ci.py SCRIPT")
    raise SystemExit(run(sys.argv[1]))
