"""Offline policy regressions; synthetic receipts never claim live AGY success."""
import json
import tempfile
import unittest
from pathlib import Path
from routing import route, assess_acceptance, snapshot_revision
from test_routing import available, offline_review


class FinalReviewTests(unittest.TestCase):
    def test_unknown_provider_requires_discovery_without_fallback(self):
        for task in ({"task_type":"review"}, {"task_type":"security_review"}, {"task_type":"arbiter"}):
            decision=route({"task_summary":"bounded task", **task})
            self.assertEqual(decision["status"], "AGY_DISCOVERY_REQUIRED")
            self.assertEqual(decision["provider_availability"], "NOT_CHECKED")
            self.assertNotIn("model", decision)
            self.assertEqual(decision["fallback_events"][0]["reason"], "discovery_required")

    def test_failure_categories_preserved_and_critical_never_gpt(self):
        for category in ("AUTH_REQUIRED", "HOST_PERMISSION_BLOCKED", "AGY_NOT_INSTALLED", "MODEL_UNAVAILABLE", "AGY_RUNTIME_ERROR"):
            decision=route({"task_summary":"payment review"}, {"agy_available":False,"agy_failure_category":category})
            self.assertEqual(decision["status"], "REVIEW_BLOCKED")
            self.assertEqual(decision["provider_availability"], "CALL_FAILED")
            self.assertEqual(decision["provider_failure_category"], category)
            self.assertNotIn("model_key", decision)

    def test_ordinary_arbitration_uses_claude_or_noncritical_gemini(self):
        task={"task_summary":"scope dispute", "task_type":"arbiter"}
        self.assertEqual(route(task,available())["model_key"],"sonnet")
        fallback=route(task,{**available(),"models":{"sonnet":{"failure":"cli_failure"}}})
        self.assertEqual(fallback["model_key"],"gemini_high")
        self.assertFalse(fallback["candidate_findings_only"])
        blocked=route({**task,"risk_categories":["permission"]},{**available(),"quota":{"claude":0}})
        self.assertEqual(blocked["status"],"REVIEW_BLOCKED")

    def test_repair_scope_cannot_expand_itself(self):
        task={"task_summary":"repair review", "task_type":"review", "snapshot_files":["a.py","b.py","c.py"],
              "review_changed_files":["a.py"], "review_dependencies":["b.py"]}
        self.assertEqual(route(task,available())["review_scope_files"],["a.py","b.py"])
        with self.assertRaisesRegex(ValueError,"SCOPE_EXPANSION_REQUIRES_AUTHORIZATION"):
            route({**task,"review_dependencies":["new.py"]},available())
        expanded=route({**task,"review_dependencies":["new.py"],"authorized_scope_expansion":["new.py"]},available())
        self.assertEqual(expanded["review_scope_files"],["a.py","new.py"])

    def test_gate_minor_not_blocking_major_and_stale_are_blocking(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'source.py';source.write_text('value=1\n',encoding='utf-8')
            revision=snapshot_revision(root,['source.py'])
            decision=route({'task_summary':'bounded implementation','task_type':'implement','source_revision':revision,
                            'snapshot_root':directory,'snapshot_files':['source.py'],'required_checks':['unit']},available())
            def record(name,value):
                path=root/(name+'.json');value['evidence_path']=str(path)
                path.write_text(json.dumps(value),encoding='utf-8');return value
            execution=record('execution',{'kind':'execution','revision':revision,'status':'COMPLETED','source':'desktop_native',
                                         'provider_terminal':True,'tool_operations':'completed'})
            check=record('unit',{'kind':'validation','revision':revision,'status':'PASS','source':'validation_runner','exit_code':0,'name':'unit'})
            review=offline_review(decision,root)
            evidence={'execution':execution,'checks':[check],'review':review}
            self.assertEqual(assess_acceptance(decision,evidence)['status'],'READY')
            for severity in ('MINOR','NIT'):
                self.assertEqual(assess_acceptance(decision,{**evidence,'findings':[{'severity':severity,'disposition':'unresolved'}]})['status'],'READY')
            for severity in ('MAJOR','BLOCKER'):
                for disposition in ('unresolved','confirmed'):
                    self.assertIn('finding_unresolved',assess_acceptance(decision,{**evidence,'findings':[{'severity':severity,'disposition':disposition}]})['blockers'])
            fake={**review,'model':'gpt-6-astra'}
            tampered={**decision,'review_plan':[{**decision['review_plan'][0],'model':'gpt-6-astra'}]}
            record('review',fake)
            self.assertIn('final_reviewer_not_qualified',assess_acceptance(tampered,{**evidence,'review':fake})['blockers'])
            source.write_text('value=2\n',encoding='utf-8')
            self.assertIn('snapshot_changed',assess_acceptance(decision,evidence)['blockers'])
