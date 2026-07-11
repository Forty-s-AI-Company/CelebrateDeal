import datetime as dt
import unittest

from quota_supervisor import (
    LOCAL_MODEL_ALLOWLIST,
    build_waiting_state,
    detect_quota,
    extract_reset_time,
)


TZ = dt.timezone(dt.timedelta(hours=8))
NOW = dt.datetime(2026, 7, 11, 20, 0, tzinfo=TZ)


class QuotaSupervisorTest(unittest.TestCase):
    def test_codex_usage_limit_with_future_reset_is_parsed(self) -> None:
        detection = detect_quota(
            "codex",
            "You've hit your usage limit. Upgrade to Pro or try again at Jul 12th, 2026 8:00 AM.",
            NOW,
        )
        self.assertTrue(detection.exhausted)
        self.assertEqual(detection.resume_at, "2026-07-12T08:00:00+08:00")
        self.assertEqual(detection.next_probe_at, detection.resume_at)

    def test_expired_codex_reset_falls_back_to_hourly_probe(self) -> None:
        detection = detect_quota(
            "codex",
            "You've hit your usage limit. Try again at Feb 23rd, 2026 9:01 PM.",
            NOW,
        )
        self.assertTrue(detection.exhausted)
        self.assertIsNone(detection.resume_at)
        self.assertEqual(detection.next_probe_at, "2026-07-11T21:00:00+08:00")

    def test_antigravity_reset_time_uses_local_timezone(self) -> None:
        parsed, source = extract_reset_time(
            "Reset Time: 2026-07-12 08:00:00 (Local Time)", NOW,
        )
        self.assertEqual(parsed, dt.datetime(2026, 7, 12, 8, 0, tzinfo=TZ))
        self.assertEqual(source, "provider-quota-command")

    def test_antigravity_429_without_reset_uses_hourly_probe(self) -> None:
        detection = detect_quota(
            "antigravity",
            'Error: HTTP 429 Too Many Requests {"code":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}',
            NOW,
        )
        self.assertTrue(detection.exhausted)
        self.assertIsNone(detection.resume_at)
        self.assertEqual(detection.next_probe_at, "2026-07-11T21:00:00+08:00")

    def test_far_future_reset_cannot_disable_hourly_probe(self) -> None:
        detection = detect_quota(
            "antigravity",
            "Quota exceeded. Reset Time: 2099-01-01 00:00:00 (Local Time)",
            NOW,
        )
        self.assertTrue(detection.exhausted)
        self.assertIsNone(detection.resume_at)
        self.assertEqual(detection.next_probe_at, "2026-07-11T21:00:00+08:00")

    def test_waiting_state_preserves_completed_stages_and_provider_identity(self) -> None:
        detection = detect_quota("codex", "You've hit your usage limit", NOW)
        state = build_waiting_state(detection, {
            "taskId": "T-1", "runId": "run", "currentStage": "02-test",
            "sourceRevision": "head", "pipelineDigest": "digest", "sourceFingerprint": "fingerprint",
            "stages": [
                {"stageId": "01-plan", "status": "completed"},
                {"stageId": "02-test", "status": "running"},
            ],
        })
        self.assertEqual(state["completedStages"], ["01-plan"])
        self.assertFalse(state["providerRequirementSatisfied"])
        self.assertFalse(state["capabilityEquivalent"])
        self.assertTrue(state["requiresProviderResume"])

    def test_large_or_unknown_ollama_model_is_rejected(self) -> None:
        self.assertNotIn("qwen3-coder:30b", LOCAL_MODEL_ALLOWLIST)
        detection = detect_quota("codex", "usage limit", NOW)
        with self.assertRaises(ValueError):
            build_waiting_state(detection, {}, "qwen3-coder:30b")


if __name__ == "__main__":
    unittest.main()
