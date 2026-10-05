"use client";

import { StrictMode, useState } from "react";
import { WorkspaceEditor } from "./workspace-editor";
import { createEmptyPageDocument } from "@/lib/funnel-page-document";

/** Synthetic parent deliberately echoes cloned documents, matching persistence
 * parsing without loading accounts, application configuration or a database. */
export function FunnelEditorBrowserHarness() {
  const [document, setDocument] = useState(() => createEmptyPageDocument("editor_fixture"));
  const [changes, setChanges] = useState(0);
  const [disabled, setDisabled] = useState(false);
  const [revision, setRevision] = useState(1);
  return <main>
    <h1>編輯器生命週期驗證</h1>
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
