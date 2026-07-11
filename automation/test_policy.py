import tempfile
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

from policy import assert_path_contained, assert_write_scope, changed_since, normalize_repo_path, path_matches, workspace_snapshot


class WritePolicyTest(unittest.TestCase):
    def test_path_prefix_does_not_match_sibling(self) -> None:
        self.assertTrue(path_matches("src/lib/payment/index.ts", "src/lib/payment/**"))
        self.assertFalse(path_matches("src/lib/payment-evil/index.ts", "src/lib/payment/**"))

    def test_path_traversal_and_absolute_paths_are_rejected(self) -> None:
        for value in ["../secret", "C:/secret", "/secret", "src/../secret"]:
            with self.assertRaises(ValueError):
                normalize_repo_path(value)

    def test_effective_scope_is_role_and_task_intersection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = {"role_id": "backend", "write_paths": ["src/**"], "forbidden_paths": ["src/admin/**"]}
            self.assertEqual(assert_write_scope(root, manifest, ["src/lib/a.ts"], ["src/lib/**"]), ["src/lib/a.ts"])
            with self.assertRaises(ValueError):
                assert_write_scope(root, manifest, ["src/app/a.ts"], ["src/lib/**"])

    def test_forbidden_path_always_wins(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest = {"role_id": "role", "write_paths": ["src/**"], "forbidden_paths": ["src/admin/**"]}
            with self.assertRaises(ValueError):
                assert_write_scope(Path(directory), manifest, ["src/admin/secret.ts"])

    def test_deleted_forbidden_path_is_still_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest = {"role_id": "role", "write_paths": ["src/**"], "forbidden_paths": ["src/admin/**"]}
            before = {"src/admin/secret.ts": "hash"}
            after: dict[str, str] = {}
            with self.assertRaises(ValueError):
                assert_write_scope(Path(directory), manifest, changed_since(before, after))

    def test_read_only_role_rejects_any_change(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                assert_write_scope(Path(directory), {"role_id": "reviewer", "write_paths": [], "forbidden_paths": []}, ["docs/a.md"])

    def test_symlink_escape_is_rejected_when_supported(self) -> None:
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory)
            link = root / "linked"
            try:
                link.symlink_to(Path(outside), target_is_directory=True)
            except OSError:
                self.skipTest("Symlinks require elevated permission on this Windows host")
            with self.assertRaises(ValueError):
                assert_path_contained(root, "linked/file.txt")

    def test_changed_since_detects_create_modify_and_delete(self) -> None:
        before = {"a": "1", "b": "2"}
        after = {"a": "3", "c": "4"}
        self.assertEqual(changed_since(before, after), ["a", "b", "c"])

    @patch("policy.subprocess.run")
    def test_snapshot_tracks_sensitive_ignored_files(self, run_mock) -> None:
        run_mock.return_value = CompletedProcess([], 0, b"", b"")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            secret = root / ".env.local"
            secret.write_text("before", encoding="utf-8")
            before = workspace_snapshot(root)
            secret.write_text("after", encoding="utf-8")
            after = workspace_snapshot(root)
            self.assertEqual(changed_since(before, after), [".env.local"])
            with self.assertRaises(ValueError):
                assert_write_scope(root, {"role_id": "writer", "write_paths": ["**"], "forbidden_paths": [".env*"]}, [".env.local"])


if __name__ == "__main__":
    unittest.main()
