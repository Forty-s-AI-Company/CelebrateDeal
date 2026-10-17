const ts=require('typescript'),fs=require('node:fs'),path=require('node:path');
const root=process.cwd(),files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(p.endsWith('.tsx')&&!p.includes('.test.')&&!p.includes('harness'))files.push(p);}}
walk(path.join(root,'src/components/landing-pages'));
const results=[];
for(const file of files){const text=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function visit(n){
  const labelAttribute=ts.isStringLiteral(n)&&ts.isJsxAttribute(n.parent)&&['title','label','placeholder','aria-label'].includes(n.parent.name.text);
  const labelProperty=ts.isStringLiteral(n)&&ts.isPropertyAssignment(n.parent)&&['label','title','description'].includes(n.parent.name.getText(tree));
  if(ts.isJsxText(n)||labelAttribute||labelProperty){const value=n.text.trim();if(/[A-Za-z]{2,}/.test(value))results.push({file:path.relative(root,file).replaceAll('\\','/'),line:tree.getLineAndCharacterOfPosition(n.getStart(tree)).line+1,text:value});}
  ts.forEachChild(n,visit);
 }visit(tree);
}
fs.writeFileSync(process.argv[2],JSON.stringify(results,null,2));
console.log(JSON.stringify({matches:results.length,files:new Set(results.map(x=>x.file)).size}));
