"""Run with: python3 -m unittest discover -s tools/ci -p 'test_furl_ci.py' -v."""

import io
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import furl_ci


class RenderTests(unittest.TestCase):
    def render(self, raw, status=0):
        output = io.BytesIO()
        furl_ci.render_log(io.BytesIO(raw), status, output)
        return output.getvalue()

    def test_short_and_empty_output_are_byte_exact(self):
        for raw in (b"", b"fine", b"stdout\nstderr\n", b"Swedish: \xc3\xa5\xc3\xa4\xc3\xb6\n"):
            with self.subTest(raw=raw), patch.object(furl_ci, "compress", side_effect=AssertionError):
                self.assertEqual(self.render(raw), raw)

    def test_failed_steps_keep_every_byte_without_calling_furl(self):
        raw = b"noise\n" * 500 + b"Error: important failure\n    at file.ts:42\n"
        with patch.object(furl_ci, "compress", side_effect=AssertionError):
            self.assertEqual(self.render(raw, 23), raw)

    def test_success_is_compacted_and_measured(self):
        raw = b"INFO repetitive progress\n" * 500
        with patch.object(furl_ci, "compress", return_value="Finished: 500 items\n"):
            output = self.render(raw)
        self.assertLess(len(output), len(raw))
        self.assertIn(b"Finished: 500 items", output)
        self.assertIn(b"CCR off", output)
        self.assertIn(b"500 ->", output)

    def test_compressor_failure_preserves_logs(self):
        raw = b"progress\n" * 500
        with patch.object(furl_ci, "compress", side_effect=RuntimeError("private details")):
            output = self.render(raw)
        self.assertTrue(output.endswith(raw))
        self.assertIn(b"original output", output)
        self.assertNotIn(b"private details", output)

    def test_larger_or_empty_compression_is_rejected(self):
        raw = b"line\n" * 500
        for candidate in ("", raw.decode() * 2):
            with self.subTest(candidate=len(candidate)), patch.object(furl_ci, "compress", return_value=candidate):
                self.assertEqual(self.render(raw), raw)

    def test_workflow_commands_and_invalid_utf8_are_not_rewritten(self):
        for prefix in (b"::add-mask::secret\n", b"prefix ::warning::message\n", b"##[warning]message\n", b"\xff\n"):
            raw = prefix + b"noise\n" * 500
            with self.subTest(prefix=prefix), patch.object(furl_ci, "compress", side_effect=AssertionError):
                self.assertEqual(self.render(raw), raw)

    def test_large_logs_are_streamed_without_compression(self):
        raw = b"line\n" * 500
        with patch.object(furl_ci, "MAX_INPUT_BYTES", 100), patch.object(furl_ci, "compress", side_effect=AssertionError):
            self.assertEqual(self.render(raw), raw)

    def test_opt_out_retains_original_output(self):
        raw = b"line\n" * 500
        with patch.dict(os.environ, {"FURL_CI_DISABLED": "1"}), patch.object(furl_ci, "compress", side_effect=AssertionError):
            self.assertEqual(self.render(raw), raw)


class ShellTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.script = Path(self.directory.name) / "step with spaces.sh"
        self.wrapper = Path(furl_ci.__file__).resolve()

    def run_script(self, body, env=None):
        self.script.write_text(body)
        return subprocess.run([sys.executable, str(self.wrapper), str(self.script)], capture_output=True,
                              cwd=self.directory.name, env=env, timeout=10)

    def test_stdout_stderr_and_nonzero_exit_are_preserved(self):
        result = self.run_script("echo output; echo diagnostic >&2; exit 23\n")
        self.assertEqual(result.returncode, 23)
        self.assertEqual(result.stdout, b"output\ndiagnostic\n")

    def test_fail_fast_and_exit_trap_survive(self):
        result = self.run_script("trap 'echo cleanup' EXIT\nfalse\necho must-not-run\n")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"cleanup\n")

    def test_original_default_bash_pipeline_semantics_are_preserved(self):
        result = self.run_script("false | true\necho original-default\n")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b"original-default\n")

    def test_environment_and_github_output_file_are_preserved(self):
        output = Path(self.directory.name) / "github-output"
        env = {**os.environ, "GITHUB_OUTPUT": str(output), "EXAMPLE": "unchanged value"}
        result = self.run_script('printf "key=%s\\n" "$EXAMPLE" >> "$GITHUB_OUTPUT"\n', env)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(output.read_text(), "key=unchanged value\n")

    def test_process_substitution_and_aggregate_status_survive(self):
        result = self.run_script('while read -r value; do echo "$value"; done < <(printf "one\\ntwo\\n")\nstatus=0\nfalse || status=1\necho continued\nexit "$status"\n')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"one\ntwo\ncontinued\n")

    def test_term_reaches_shell_and_cleanup_runs(self):
        ready = Path(self.directory.name) / "ready"
        self.script.write_text(f"trap 'echo cleanup' EXIT\ntrap 'exit 143' TERM\ntouch '{ready}'\nsleep 30\n")
        process = subprocess.Popen([sys.executable, str(self.wrapper), str(self.script)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 5
            while not ready.exists() and time.monotonic() < deadline and process.poll() is None:
                time.sleep(0.02)
            self.assertTrue(ready.exists(), "child shell did not start")
            process.send_signal(signal.SIGTERM)
            stdout, _ = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 143)
            self.assertIn(b"cleanup", stdout)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()


class FurlIntegrationTests(unittest.TestCase):
    """Mandatory in CI: these import the actual pinned native Furl wheel."""

    def test_real_furl_reduces_noise_and_retains_warning_and_summary_without_ccr(self):
        from furl_ctx.transforms.log_compressor import LogCompressor

        raw = ("npm info downloading package\n" * 1000
               + "npm WARN deprecated example-package: use replacement\n"
               + "Test Suites: 12 passed, 12 total\n")
        with patch.object(LogCompressor, "_persist_to_python_ccr", side_effect=AssertionError("CCR must stay disabled")):
            compact = furl_ci.compress(raw)
        self.assertLess(len(compact), len(raw) // 2)
        self.assertIn("npm WARN deprecated example-package", compact)
        self.assertIn("Test Suites:", compact)
        self.assertNotIn("<<ccr:", compact)
        print(f"Furl fixture: {len(raw.encode())} -> {len(compact.encode())} bytes; CCR off")

    def test_successful_step_uses_real_furl_end_to_end(self):
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "success.sh"
            script.write_text("for i in {1..1000}; do echo 'npm info downloading package'; done\necho 'Test Suites: 12 passed, 12 total'\n")
            result = subprocess.run([sys.executable, str(Path(furl_ci.__file__).resolve()), str(script)], capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0)
        self.assertIn(b"[furl-ci] 1001 ->", result.stdout)
        self.assertIn(b"Test Suites:", result.stdout)
        self.assertLess(len(result.stdout), 14000)
        self.assertNotIn(b"<<ccr:", result.stdout)

    def test_real_furl_cannot_hide_a_failing_step(self):
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "fail.sh"
            script.write_text("for i in {1..300}; do echo 'npm info noise'; done\necho 'unique failure diagnostic' >&2\nexit 17\n")
            result = subprocess.run([sys.executable, str(Path(furl_ci.__file__).resolve()), str(script)], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 17)
        self.assertEqual(result.stdout.count(b"npm info noise\n"), 300)
        self.assertIn(b"unique failure diagnostic", result.stdout)


if __name__ == "__main__":
    unittest.main()
