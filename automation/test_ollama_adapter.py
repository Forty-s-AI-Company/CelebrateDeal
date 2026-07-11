import unittest
from pathlib import Path

from adapters.base_adapter import AdapterRequest
from adapters.ollama_adapter import OllamaAdapter


class OllamaAdapterTest(unittest.TestCase):
    def test_structured_status_is_required(self) -> None:
        self.assertTrue(OllamaAdapter.requires_output_status)

    def test_embedding_model_cannot_be_used_for_generation(self) -> None:
        request = AdapterRequest(
            role_id="local-supervisor", prompt="test", workdir=Path.cwd(),
            requested_model="nomic-embed-text:latest", requested_reasoning="low",
        )
        with self.assertRaises(ValueError):
            OllamaAdapter().build_command(request, "ollama")

    def test_unknown_or_large_model_is_rejected(self) -> None:
        request = AdapterRequest(
            role_id="local-supervisor", prompt="test", workdir=Path.cwd(),
            requested_model="qwen3-coder:30b", requested_reasoning="low",
        )
        with self.assertRaises(ValueError):
            OllamaAdapter().build_command(request, "ollama")

    def test_generation_command_forces_json_and_hides_thinking(self) -> None:
        request = AdapterRequest(
            role_id="local-supervisor", prompt="test", workdir=Path.cwd(),
            requested_model="qwen2.5-coder:1.5b", requested_reasoning="low",
        )
        command = OllamaAdapter().build_command(request, "ollama")
        self.assertIn("--format", command)
        self.assertTrue(any('"status"' in part and '"passed"' in part for part in command))
        self.assertIn("--hidethinking", command)
        self.assertIn("--think=false", command)
        self.assertIn("--nowordwrap", command)

    def test_local_schema_rejects_missing_or_extra_fields(self) -> None:
        adapter = OllamaAdapter()
        self.assertIsNone(adapter.parse_output_status('{"status":"passed"}'))
        self.assertIsNone(adapter.parse_output_status('{"status":"passed","summary":"ok","findings":[],"actual_model":"x","extra":true}'))
        self.assertEqual(adapter.parse_output_status('{"status":"passed","summary":"ok","findings":[],"actual_model":"x"}'), "passed")


if __name__ == "__main__":
    unittest.main()
