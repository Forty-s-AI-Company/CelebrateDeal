"""Subscription transport fixtures: no provider or credentials are accessed."""
import unittest
import json
import tempfile
from pathlib import Path
from routing import route, assess_acceptance, snapshot_revision
from test_routing import available


class ClaudeCliRoutingTests(unittest.TestCase):
    def runtime(self, model='claude-opus-5-5'):
        return {**available(), 'quota': {'claude': 0},
                'claude_cli': {'available': True, 'models': {'opus': model, 'sonnet': 'claude-sonnet-5-5'}}}

    def test_quota_isolated_and_critical_stays_opus(self):
        decision=route({'task_summary':'payment review'}, self.runtime())
        self.assertEqual(decision['status'],'planned')
        self.assertEqual(decision['provider'],'claude_cli')
        self.assertEqual(decision['model'],'claude-opus-5-5')
        self.assertEqual(decision['model_key'],'opus')
        self.assertEqual(decision['observed']['model'],'unknown')

    def test_same_model_distinct_transport_after_failed_agy_attempt(self):
        runtime={**self.runtime(),'attempted_models':['opus'],'models':{'opus':{'failure':'cli_failure'}}}
        self.assertEqual(route({'task_summary':'payment review'},runtime)['provider'],'claude_cli')
        runtime['claude_cli']['available']=False
        self.assertEqual(route({'task_summary':'payment review'},runtime)['status'],'REVIEW_BLOCKED')
        runtime['claude_cli']['available']=True;runtime['claude_cli']['attempted_models']=['opus']
        self.assertEqual(route({'task_summary':'payment review'},runtime)['status'],'REVIEW_BLOCKED')

    def test_agy_is_primary_and_unknown_cli_does_not_claim_verified(self):
        runtime=self.runtime();runtime.pop('quota')
        self.assertEqual(route({'task_summary':'payment review'},runtime)['provider'],'agy_wrapper')
        runtime['agy_available']=False;runtime['claude_cli']['available']=None
        self.assertEqual(route({'task_summary':'payment review'},runtime)['status'],'REVIEW_BLOCKED')

    def test_critical_rejects_sonnet_or_spoofed_probe(self):
        for model in ('sonnet','claude-sonnet-5-5','gpt-6-astra','claude-opus-5-5;command'):
            self.assertEqual(route({'task_summary':'payment review'},self.runtime(model))['status'],'REVIEW_BLOCKED')

    def test_noncritical_uses_subscription_sonnet(self):
        decision=route({'task_summary':'ordinary scope dispute','task_type':'arbiter'},self.runtime())
        self.assertEqual(decision['model'],'claude-sonnet-5-5')
        self.assertEqual(decision['provider'],'claude_cli')

    def test_gate_requires_persisted_terminal_model_observation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'source.py').write_text('value=1\n',encoding='utf-8')
            revision=snapshot_revision(root,['source.py'])
            decision=route({'task_summary':'payment implementation','task_type':'implement',
                            'source_revision':revision,'snapshot_root':directory,
                            'snapshot_files':['source.py'],'required_checks':['unit']},self.runtime())
            def record(name,value):
                value['evidence_path']=str(root/(name+'.json'))
                Path(value['evidence_path']).write_text(json.dumps(value),encoding='utf-8')
                return value
            execution=record('execution',{'kind':'execution','revision':revision,'status':'COMPLETED',
                'source':'desktop_native','provider_terminal':True,'tool_operations':'completed'})
            check=record('unit',{'kind':'validation','revision':revision,'status':'PASS',
                'source':'validation_runner','exit_code':0,'name':'unit'})
            review=record('review',{'kind':'review','revision':revision,'status':'PASS','independent':True,
                'source':'claude_cli','role':'critical_review','model':'claude-opus-5-5','observed_model':'claude-opus-5-5'})
            evidence={'execution':execution,'checks':[check],'review':review}
            self.assertEqual(assess_acceptance(decision,evidence)['status'],'READY')
            review.pop('observed_model');record('review',review)
            self.assertIn('final_reviewer_not_qualified',assess_acceptance(decision,evidence)['blockers'])


if __name__=='__main__': unittest.main()
