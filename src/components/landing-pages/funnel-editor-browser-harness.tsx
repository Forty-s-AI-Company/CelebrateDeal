"use client";

import { StrictMode, useState } from "react";
import { WorkspaceEditor } from "./workspace-editor";
import { createFunnelFlow } from "@/lib/funnel-flow";
import { createFunnelStepPages } from "@/lib/funnel-step-pages";
import { createEmptyPageDocument } from "@/lib/funnel-page-document";

/** Synthetic parent deliberately echoes cloned documents, matching persistence
 * parsing without loading accounts, application configuration or a database. */
export function FunnelEditorBrowserHarness() {
  const [document, setDocument] = useState(() => createEmptyPageDocument("editor_fixture"));
  const [changes, setChanges] = useState(0);
  const [disabled, setDisabled] = useState(false);
  const [revision, setRevision] = useState(1);
  const [flowMode, setFlowMode] = useState(false);
  if (flowMode) return <FunnelFlowBrowserHarness />;
  return <main>
    <h1>編輯器生命週期驗證</h1>
    <button onClick={() => setFlowMode(true)}>測試多步驟流程</button>
    <button onClick={() => setDocument(structuredClone(document))}>回傳相同文件</button>
    <button onClick={() => {
      const next = createEmptyPageDocument(document.id, "外部還原");
      next.settings.seo.title = "外部版本";
      setDocument(next);
    }}>載入外部版本</button>
    <button onClick={() => setDisabled((value) => !value)}>切換唯讀</button>
    <button onClick={() => { setRevision((value) => value + 1); setDocument(structuredClone(document)); }}>模擬儲存成功</button>
    <output data-testid="persistence-revision">{revision}</output>
    <output data-testid="change-count">{changes}</output>
    <output data-testid="parent-document">{JSON.stringify(document)}</output>
    <StrictMode><WorkspaceEditor content={document} pending={disabled} revision={revision} commerceProducts={[]} forms={[]} onValidityChange={() => undefined} onLegacyChange={() => undefined} onDocumentChange={(next) => {
      if (!("root" in next)) throw new Error("Expected a synthetic PageDocument");
      setChanges((count) => count + 1);
      setDocument(structuredClone(next));
    }} /></StrictMode>
  </main>;
}

/** Uses the delivered workspace component with synthetic controlled state;
 * persistence/permission integration requires separate database acceptance. */
function FunnelFlowBrowserHarness() {
  const create = () => createFunnelStepPages(createFunnelFlow({ id: "flow_fixture", name: "測試流程", goal: "audience", domain: "fixture" })!)!;
  const [state, setState] = useState(create);
  const [disabled, setDisabled] = useState(false);
  const [changes, setChanges] = useState(0);
  return <main>
    <button onClick={() => setState(structuredClone(state))}>回傳相同流程</button>
    <button onClick={() => setState(create())}>載入外部流程</button>
    <button onClick={() => setDisabled((value) => !value)}>切換唯讀</button>
    <output data-testid="flow-document">{JSON.stringify(state)}</output>
    <output data-testid="change-count">{changes}</output>
    <StrictMode><WorkspaceEditor content={state} pending={disabled} revision={1} commerceProducts={[]} forms={[]} onValidityChange={() => undefined} onLegacyChange={() => undefined} onDocumentChange={(next) => {
      if (!("pages" in next)) throw new Error("Expected synthetic multi-step flow");
      setChanges((count) => count + 1);
      setState(structuredClone(next));
    }} /></StrictMode>
  </main>;
}
