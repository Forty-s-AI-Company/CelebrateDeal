import os
import unittest
from unittest.mock import patch

import windows_credentials


class WindowsCredentialTest(unittest.TestCase):
    def test_key_validation_requires_64_hex_characters(self) -> None:
        valid = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
        self.assertEqual(windows_credentials.validate_key(valid.upper()), valid)
        for value in ("short", "g" * 64, "a" * 63, "a" * 64, "0" * 64, "a" * 65):
            with self.assertRaises(windows_credentials.CredentialError):
                windows_credentials.validate_key(value)

    def test_non_windows_fails_closed(self) -> None:
        with patch("windows_credentials.os.name", "posix"):
            with self.assertRaisesRegex(windows_credentials.CredentialError, "unavailable"):
                windows_credentials.read_key()

    @patch("windows_credentials.write_key")
    def test_cli_set_reads_secret_from_stdin_not_argument(self, write_mock) -> None:
        with patch("windows_credentials.sys.stdin.readline", return_value="b" * 64 + "\n"):
            self.assertEqual(windows_credentials.main(["set"]), 0)
        write_mock.assert_called_once_with("b" * 64 + "\n")

    @patch("windows_credentials.write_key")
    @patch("windows_credentials.secrets.token_hex", return_value="0123456789abcdef" * 4)
    def test_generate_uses_csprng_without_printing_key(self, token_mock, write_mock) -> None:
        self.assertEqual(windows_credentials.main(["generate"]), 0)
        token_mock.assert_called_once_with(32)
        write_mock.assert_called_once_with("0123456789abcdef" * 4)


if __name__ == "__main__":
    unittest.main()
