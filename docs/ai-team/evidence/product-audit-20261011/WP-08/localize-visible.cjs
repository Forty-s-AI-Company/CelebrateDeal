const ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base='docs/ai-team/evidence/product-audit-20261011/WP-08';
const manifest=JSON.parse(fs.readFileSync(base+'/batch1-before.json','utf8'));
const filenames=['funnel-element-inspector.tsx','funnel-goal-picker.tsx','funnel-list.tsx','funnel-page-editor.tsx','funnel-step-pages-editor.tsx','funnel-template-gallery-picker.tsx'];
const replacements=[['Popup Section','彈出視窗區塊'],['Raw HTML','自訂 HTML'],['Create funnel','建立一頁式網站'],['Funnel steps','網站步驟'],['Funnel step','網站步驟'],['Funnel','一頁式網站'],['Webinar','網路研討會'],['Popups','彈出視窗'],['Popup','彈出視窗'],['Elements','元件'],['Blocks','版型區塊'],['Section','區塊'],['Row','欄列'],['FAQ','常見問題'],['Undo','復原'],['Redo','重做'],['URL Path','網址路徑'],['Automation','自動化規則'],['Exit intent','離開頁面時顯示'],['Padding','內距'],['Border','邊框'],['Shadow','陰影'],['English','英文'],['Tracking','追蹤設定'],['Breadcrumb','目前位置'],['SEO','搜尋引擎'],['Select template','選擇模板']];
for(const name of filenames){const file='src/components/landing-pages/'+name;if(!fs.existsSync(file))continue;
 const text=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),edits=[];
 function visit(n){const attr=ts.isStringLiteral(n)&&ts.isJsxAttribute(n.parent)&&['title','label','placeholder','aria-label'].includes(n.parent.name.text);
 const prop=ts.isStringLiteral(n)&&ts.isPropertyAssignment(n.parent)&&['label','title','description'].includes(n.parent.name.getText(tree));
 if(ts.isJsxText(n)||attr||prop){let value=n.text;for(const [from,to] of replacements)value=value.replaceAll(from,to);if(value!==n.text)edits.push({start:ts.isJsxText(n)?n.pos:n.getStart(tree),end:n.end,value:ts.isJsxText(n)?value:JSON.stringify(value)});}
 ts.forEachChild(n,visit);}visit(tree);
 if(edits.length){if(!manifest.some(x=>x.file===file)){const data=fs.readFileSync(file),before=base+'/before/'+manifest.length+'.txt';fs.writeFileSync(before,data);manifest.push({file,before,sha256:crypto.createHash('sha256').update(data).digest('hex')});}
 let result=text;for(const e of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,e.start)+e.value+result.slice(e.end);fs.writeFileSync(file,result);console.log(JSON.stringify({file,edits:edits.length}));}
}
fs.writeFileSync(base+'/batch1-before.json',JSON.stringify(manifest,null,2));
