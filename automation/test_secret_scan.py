import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StagedSecretScanTest(unittest.TestCase):
    def test_staged_blob_is_scanned_instead_of_working_tree(self) -> None:
        executable = ROOT / "node_modules" / ".bin" / ("tsx.cmd" if os.name == "nt" else "tsx")
        if not executable.is_file():
            self.skipTest("tsx executable is not installed")
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            subprocess.run(["git", "init", "--quiet"], cwd=repository, check=True)
            candidate = repository / "candidate.txt"
            candidate.write_text("TOKEN=ghp_" + "A" * 32 + "\n", encoding="utf-8")
            subprocess.run(["git", "add", "candidate.txt"], cwd=repository, check=True)
            candidate.write_text("TOKEN=placeholder\n", encoding="utf-8")
            completed = subprocess.run(
                [str(executable), str(ROOT / "scripts" / "secret-scan.ts"), "--staged"],
                cwd=repository, text=True, capture_output=True,
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("candidate.txt:1", completed.stderr)


if __name__ == "__main__":
    unittest.main()
