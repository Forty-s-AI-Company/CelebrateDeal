import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class WindowsSupervisorScriptTest(unittest.TestCase):
    def test_scheduler_uses_absolute_python_and_unified_supervisor_without_secret(self) -> None:
        text = (ROOT / "automation" / "register-supervisor-task.ps1").read_text(encoding="utf-8")
        self.assertIn("Get-Command python -CommandType Application", text)
        self.assertIn("Select-Object -First 1", text)
        self.assertIn("autonomous_supervisor.py", text)
        self.assertIn("-Execute $python", text)
        self.assertNotIn("npm.cmd", text)
        self.assertNotIn("AI_PIPELINE_ATTESTATION_KEY", text)

    def test_key_store_uses_absolute_python_and_internal_generator(self) -> None:
        text = (ROOT / "automation" / "store-attestation-key.ps1").read_text(encoding="utf-8")
        self.assertIn("Get-Command python -CommandType Application", text)
        self.assertIn("Select-Object -First 1", text)
        self.assertIn("windows_credentials.py\") generate", text)
        self.assertNotIn("Read-Host", text)


if __name__ == "__main__":
    unittest.main()
