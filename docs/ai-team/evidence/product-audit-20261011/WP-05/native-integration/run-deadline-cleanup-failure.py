from pathlib import Path
import os,subprocess,shutil,json
root=Path.cwd();out=root/'docs/ai-team/evidence/product-audit-20261011/WP-05/native-integration'
env={k:os.environ[k] for k in ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','USERPROFILE','LOCALAPPDATA','APPDATA'] if k in os.environ}
env['DATABASE_URL']='postgresql://wp05_synthetic:wp05_synthetic_only@127.0.0.1:64506/celebratedeal_test'
checks=[]
for scenario in ['fail-after-vendor','fail-browser-close','fail-lost-form-handle']:
 report=out/('deadline-cleanup-'+scenario+'.json')
 result=subprocess.run([shutil.which('node'),str(out/'browser-deadline.cjs'),str(report),'chromium',scenario],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=60)
 data=json.loads(report.read_text(encoding='utf-8'))
 assert result.returncode==1 and data['status']=='FAIL' and data['stage']=='fixture' and data['cleanup'] is True
 assert data['cleanupRowCounts']==[0]*10
 if scenario=='fail-browser-close':assert data['browserCloseError']=='Error'
 if scenario=='fail-lost-form-handle':assert data['cleanupOwnedFormCount']==1
 checks.append({'scenario':scenario,'expected_failure':True,'cleanup':True,'zero_counts':True})
(out/'deadline-cleanup-injection-summary.json').write_text(json.dumps({'status':'PASS','checks':checks,'scope':'Synthetic fixture fault injection only; not product test acceptance.'},indent=2),encoding='utf-8')
print('Three injected failure scenarios verified; all synthetic row counts zero.')
