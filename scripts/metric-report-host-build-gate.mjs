import ts from 'typescript';
import {ALLOWED_REQUIRES} from './metric-report-host-artifacts.mjs';
/** Validate emitted CommonJS before any build outputs are written. */
export function validateMetricHostDependencies(source){
 const tree=ts.createSourceFile('metric-host.js',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
 const reject=()=>{throw new Error('Metric host dependency not allowed');};
 function visit(node){
  if(ts.isCallExpression(node)&&(ts.isIdentifier(node.expression)&&node.expression.text==='require'||node.expression.kind===ts.SyntaxKind.ImportKeyword)){
   if(node.arguments.length!==1||!ts.isStringLiteral(node.arguments[0])||!ALLOWED_REQUIRES.has(node.arguments[0].text))reject();
  }
  // Reject require aliases, property access/resolve and non-call references.
  if(ts.isIdentifier(node)&&node.text==='require'
    &&!(ts.isCallExpression(node.parent)&&node.parent.expression===node))reject();
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier
    &&(!ts.isStringLiteral(node.moduleSpecifier)||!ALLOWED_REQUIRES.has(node.moduleSpecifier.text)))reject();
  ts.forEachChild(node,visit);
 }
 visit(tree);
}
