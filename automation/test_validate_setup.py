import tempfile
import unittest
from pathlib import Path

from validate_setup import directory_digest


class SetupValidationTest(unittest.TestCase):
    def test_skill_digest_is_stable_across_line_endings(self) -> None:
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            first_root = Path(first)
            second_root = Path(second)
            (first_root / "SKILL.md").write_bytes(b"line one\nline two\n")
            (second_root / "SKILL.md").write_bytes(b"line one\r\nline two\r\n")
            self.assertEqual(directory_digest(first_root), directory_digest(second_root))


if __name__ == "__main__":
    unittest.main()
