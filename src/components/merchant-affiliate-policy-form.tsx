"use client";
import { useActionState, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { saveMerchantAffiliatePolicyAction } from "@/app/actions/merchant-affiliate-policy-actions";
import type { MerchantAffiliateTerms } from "@/lib/affiliate-tier-policy";
import { FormErrorSummary, focusFirstInvalidField, useFieldMessages } from "@/components/ui";
import { MerchantAffiliateCommissionEstimate } from "@/components/merchant-affiliate-commission-estimate";
import { PERCENT_INPUT_PATTERN, percentTextToPercentWire } from "@/lib/percent-bps";
import {
  draftFromTerms, draftToTerms, MAX_POLICY_OVERRIDES, MAX_POLICY_TIERS, MAX_POLICY_UPLINES, parsePolicyQuantity, policyFieldKey, validatePolicyDraft,
  type MerchantAffiliatePolicyDraft, type PolicyFieldError,
} from "@/lib/merchant-affiliate-policy-draft";

const subscribeNever = () => () => {};
/** 欄位鍵只由 `validatePolicyDraft` 產生（英數與連字號）；摘要連結以它當錨點。 */
const SAFE_FIELD_KEY = /^[A-Za-z0-9-]+$/u;
const policyControlId = (fieldKey: string) => `policy-field-${fieldKey}`;
const inputBase = "min-h-11 w-full rounded border px-3 py-2";
/** 商品佣金超過這個數量才顯示篩選。 */
const OVERRIDE_FILTER_THRESHOLD = 6;

const SECTIONS = [
  { id: "policy-cap", label: "總上限" },
  { id: "policy-tiers", label: "成交件數階梯" },
  { id: "policy-uplines", label: "團隊上線佣金" },
  { id: "policy-overrides", label: "商品直接佣金" },
  { id: "policy-estimate", label: "佣金試算" },
] as const;

/**
 * 比例欄位：畫面上的輸入框（無 name）顯示百分比；實際送出的是旁邊的隱藏欄位，值由
 * `percentTextToPercentWire` 換算（整數運算、不四捨五入；不合法時送伺服器必拒的 `invalid:` 值）。
 * 隱藏欄位只在 React 接手後才會跟著輸入更新，所以 hydrate 前輸入框是 readOnly，避免送出舊值。
 */
function PercentField({ label, name, fieldKey, value, onChange, error, hint, editable }: {
  label: string; name: string; fieldKey: string; value: string; onChange: (value: string) => void; error?: string; hint?: string; editable: boolean;
}) {
  const field = useFieldMessages(error, hint);
  return <div className="grid gap-1.5">
    <label className="grid gap-1 text-sm font-medium text-slate-800">{label}
      <input className={`${inputBase} ${field.controlClass}`} type="text" inputMode="decimal" autoComplete="off" required pattern={PERCENT_INPUT_PATTERN}
        readOnly={!editable} value={value} onChange={event => onChange(event.target.value)} id={policyControlId(fieldKey)} data-policy-field={fieldKey} {...field.controlProps} />
    </label>
    {field.messages}
    <input type="hidden" name={name} value={percentTextToPercentWire(value)} />
  </div>;
}

/** 件數欄位：直接以 name 送出畫面上的值（伺服器只收 1 到 10 位整數）。 */
function QuantityField({ label, name, fieldKey, value, onChange, error, required }: {
  label: string; name: string; fieldKey: string; value: string; onChange: (value: string) => void; error?: string; required?: boolean;
}) {
  const field = useFieldMessages(error);
  return <div className="grid gap-1.5">
    <label className="grid gap-1 text-sm font-medium text-slate-800">{label}
      <input className={`${inputBase} ${field.controlClass}`} name={name} type="number" min="1" step="1" required={required} value={value}
        onChange={event => onChange(event.target.value)} id={policyControlId(fieldKey)} data-policy-field={fieldKey} {...field.controlProps} />
    </label>
    {field.messages}
  </div>;
}

function Section({ id, title, description, children }: { id: string; title: string; description: ReactNode; children: ReactNode }) {
  return <section id={id} aria-labelledby={`${id}-title`} className="grid scroll-mt-6 gap-4">
    <header className="grid gap-1 border-b border-slate-200 pb-2">
      <h2 id={`${id}-title`} tabIndex={-1} className="rounded text-base font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{title}</h2>
      <p className="text-sm text-slate-600">{description}</p>
    </header>
    {children}
  </section>;
}

const buttonClass = "min-h-11 rounded border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export function MerchantAffiliatePolicyForm({ initial, revision, csrfToken, csrfFieldName, products }: {
  initial: MerchantAffiliateTerms | null; revision: number; csrfToken: string; csrfFieldName: string; products: Array<{ id: string; name: string }>;
}) {
  const [draft, setDraft] = useState<MerchantAffiliatePolicyDraft>(() => draftFromTerms(initial));
  const nextOverrideId = useRef(draft.overrides.length);
  const [state, action, pending] = useActionState(saveMerchantAffiliatePolicyAction, { message: "", revision: null });
  const [blocked, setBlocked] = useState<{ state: typeof state; count: number; focus: boolean } | null>(null);
  const [overrideFilter, setOverrideFilter] = useState("");
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const formRef = useRef<HTMLFormElement>(null);

  const liveErrors = useMemo(() => validatePolicyDraft(draft), [draft]);
  const terms = useMemo(() => draftToTerms(draft), [draft]);
  const serverError = Boolean(state.message) && state.revision === null;
  const clientBlocked = blocked !== null && blocked.state === state;
  // 送出被擋下或伺服器退回後，才顯示（並隨輸入即時更新）欄位錯誤。
  const shown: Record<string, PolicyFieldError> = clientBlocked || serverError ? liveErrors : {};
  const errorCount = Object.keys(shown).length;
  const summaryMessage = clientBlocked && errorCount ? `發布前請先修正 ${errorCount} 個欄位。` : serverError ? state.message : null;
  const summaryErrors = Object.fromEntries(Object.entries(shown).map(([key, error]) => [key, `${error.label}：${error.message}`]));
  const errorOf = (key: string) => shown[key]?.message;

  useEffect(() => { if (blocked?.focus) focusFirstInvalidField(formRef.current); }, [blocked]);
  // 伺服器退回時，等欄位恢復可編輯（pending 結束）後聚焦第一個錯誤欄位；沒有可定位的欄位就聚焦摘要。
  useEffect(() => { if (serverError && !pending) focusFirstInvalidField(formRef.current); }, [serverError, pending, state]);

  /** 摘要裡的連結：聚焦那一列的欄位（瀏覽器會捲到它）；欄位停用（送出中）時不動。 */
  function focusField(key: string) {
    if (!SAFE_FIELD_KEY.test(key)) return;
    const control = formRef.current?.querySelector<HTMLElement>(`[data-policy-field="${key}"]`);
    if (control && !control.matches(":disabled")) control.focus();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement && submitter.value === "pause") return; // 暫停不需要合法的政策內容。
    if (Object.keys(liveErrors).length === 0) return;
    event.preventDefault();
    setBlocked(previous => ({ state, count: (previous?.count ?? 0) + 1, focus: true }));
  }
  // 瀏覽器原生驗證（pattern／required）擋下送出時不會觸發 submit；同樣顯示欄位錯誤與摘要。
  // 焦點交給瀏覽器（它會聚焦第一個原生不合法欄位並顯示提示），這裡不再移動。
  function handleInvalid() {
    setBlocked(previous => previous?.state === state ? previous : { state, count: (previous?.count ?? 0) + 1, focus: false });
  }

  const update = (change: (current: MerchantAffiliatePolicyDraft) => MerchantAffiliatePolicyDraft) => setDraft(current => change(current));
  const setTier = (index: number, patch: Partial<MerchantAffiliatePolicyDraft["tiers"][number]>) => update(current => ({ ...current, tiers: current.tiers.map((tier, position) => position === index ? { ...tier, ...patch } : tier) }));
  const setUpline = (index: number, ratePercent: string) => update(current => ({ ...current, uplines: current.uplines.map((level, position) => position === index ? { ratePercent } : level) }));
  const setOverride = (uiId: number, patch: Partial<MerchantAffiliatePolicyDraft["overrides"][number]>) => update(current => ({ ...current, overrides: current.overrides.map(item => item.uiId === uiId ? { ...item, ...patch } : item) }));
  function addTier() {
    update(current => {
      const last = current.tiers.at(-1)!;
      const end = parsePolicyQuantity(last.maxQuantity), start = parsePolicyQuantity(last.minQuantity);
      const nextStart = end !== null ? end + 1 : start !== null ? start + 1 : null;
      return { ...current, tiers: [...current.tiers, { minQuantity: nextStart === null ? "" : String(nextStart), maxQuantity: "", ratePercent: last.ratePercent }] };
    });
  }

  const productName = (id: string) => products.find(product => product.id === id)?.name ?? "";
  const filter = overrideFilter.trim().toLowerCase();
  const rowHasError = (uiId: number) => Boolean(liveErrors[policyFieldKey.overrideProduct(uiId)] || liveErrors[policyFieldKey.overrideRate(uiId)]);
  // 篩選只隱藏列（hidden 屬性），欄位仍在表單裡一起送出；有問題的列（含選單裡找不到的商品）一律顯示，
  // 才不會有看不到的必填欄位擋住送出。
  const overrideVisible = (item: MerchantAffiliatePolicyDraft["overrides"][number]) => {
    const name = productName(item.productId);
    return !filter || !name || name.toLowerCase().includes(filter) || rowHasError(item.uiId);
  };
  const visibleOverrides = draft.overrides.filter(overrideVisible).length;
  const estimateProducts = draft.overrides.filter(item => item.productId && productName(item.productId)).map(item => ({ id: item.productId, name: productName(item.productId) }))
    .filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);

  return <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
    <div className="grid min-w-0 gap-4">
      <nav aria-label="佣金政策段落" className="rounded-md border border-slate-200 bg-white p-2">
        <ol className="flex flex-wrap gap-1">
          {SECTIONS.map((section, index) => <li key={section.id}><a href={`#${section.id}`} className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><span aria-hidden="true" className="text-xs text-slate-500">{index + 1}</span>{section.label}</a></li>)}
        </ol>
      </nav>
      <form ref={formRef} key={state.revision ?? revision} action={action} onSubmit={handleSubmit} onInvalidCapture={handleInvalid} className="grid gap-8 rounded-xl border border-slate-200 bg-white p-5">
        <input type="hidden" name={csrfFieldName} value={csrfToken} />
        <input type="hidden" name="expectedRevision" value={state.revision ?? revision} />
        <FormErrorSummary message={summaryMessage} errors={summaryErrors} fieldHref={key => SAFE_FIELD_KEY.test(key) ? `#${policyControlId(key)}` : undefined} onFieldSelect={focusField} />
        {hydrated ? null : <p data-policy-loading="" className="text-sm text-slate-600">頁面載入完成後才能修改佣金比例。</p>}
        <fieldset disabled={pending} className="grid gap-8">
          <Section id="policy-cap" title="佣金總比例上限" description="直接佣金最高的一階（或商品）加上所有上線層級，合計不可超過這個比例。">
            <div className="max-w-xs">
              <PercentField label="佣金總比例上限（%）" name="maxTotalPercent" fieldKey={policyFieldKey.maxTotal()} value={draft.maxTotalPercent} onChange={value => update(current => ({ ...current, maxTotalPercent: value }))} error={errorOf(policyFieldKey.maxTotal())} hint="填 30 代表 30%，最多兩位小數。" editable={hydrated} />
            </div>
          </Section>

          <Section id="policy-tiers" title="成交件數階梯" description={`依新政策開始後累計已付款件數計算，退款不會倒扣件數。最後一階的結束件數留空。已設定 ${draft.tiers.length}／${MAX_POLICY_TIERS} 階。`}>
            <ol className="grid gap-3">
              {draft.tiers.map((tier, index) => <li key={index} data-policy-row={`tier-${index}`} className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-3">
                <QuantityField label={`第 ${index + 1} 階起始件數`} name="tierStart" fieldKey={policyFieldKey.tierStart(index)} required value={tier.minQuantity} onChange={value => setTier(index, { minQuantity: value })} error={errorOf(policyFieldKey.tierStart(index))} />
                <QuantityField label={`第 ${index + 1} 階結束件數`} name="tierEnd" fieldKey={policyFieldKey.tierEnd(index)} value={tier.maxQuantity} onChange={value => setTier(index, { maxQuantity: value })} error={errorOf(policyFieldKey.tierEnd(index))} />
                <PercentField label={`第 ${index + 1} 階直接佣金（%）`} name="tierRate" fieldKey={policyFieldKey.tierRate(index)} value={tier.ratePercent} onChange={value => setTier(index, { ratePercent: value })} error={errorOf(policyFieldKey.tierRate(index))} editable={hydrated} />
              </li>)}
            </ol>
            <div className="flex flex-wrap gap-3">
              <button type="button" className={buttonClass} disabled={draft.tiers.length >= MAX_POLICY_TIERS} onClick={addTier}>新增階梯</button>
              <button type="button" className={buttonClass} disabled={draft.tiers.length <= 1} onClick={() => update(current => ({ ...current, tiers: current.tiers.slice(0, -1) }))}>移除最後階梯</button>
            </div>
          </Section>

          <Section id="policy-uplines" title="團隊上線佣金" description={`沿有效團隊關係固定層級，最多八層；缺少受益人時不會將後續層級往前挪。已設定 ${draft.uplines.length}／${MAX_POLICY_UPLINES} 層。`}>
            {draft.uplines.length ? <ol className="grid gap-3 sm:grid-cols-2">
              {draft.uplines.map((level, index) => <li key={index} data-policy-row={`upline-${index}`}>
                <PercentField label={`第 ${index + 1} 層佣金（%）`} name="uplineRate" fieldKey={policyFieldKey.uplineRate(index)} value={level.ratePercent} onChange={value => setUpline(index, value)} error={errorOf(policyFieldKey.uplineRate(index))} editable={hydrated} />
              </li>)}
            </ol> : <p className="text-sm text-slate-600">目前沒有上線層級，只有推廣者本人領佣金。</p>}
            <div className="flex flex-wrap gap-3">
              <button type="button" className={buttonClass} disabled={draft.uplines.length >= MAX_POLICY_UPLINES} onClick={() => update(current => ({ ...current, uplines: [...current.uplines, { ratePercent: "0" }] }))}>新增上線層級</button>
              <button type="button" className={buttonClass} disabled={!draft.uplines.length} onClick={() => update(current => ({ ...current, uplines: current.uplines.slice(0, -1) }))}>移除最後層級</button>
            </div>
          </Section>

          <Section id="policy-overrides" title="商品直接佣金" description={`指定商品取代件數階梯的直接佣金，團隊上線比例仍適用。已設定 ${draft.overrides.length}／${MAX_POLICY_OVERRIDES} 筆。`}>
            {draft.overrides.length >= OVERRIDE_FILTER_THRESHOLD ? <div className="grid gap-1.5 sm:max-w-sm">
              <label className="grid gap-1 text-sm font-medium text-slate-800">篩選商品佣金
                <input type="search" className={`${inputBase} border-border-control focus:border-primary`} value={overrideFilter} onChange={event => setOverrideFilter(event.target.value)} autoComplete="off"
                  // 篩選框在 <form> 內：Enter 會隱式送出（發布政策），這裡只篩選、不送出。輸入法選字中的 Enter 不攔。
                  onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }} />
              </label>
              <p className="text-xs text-slate-600" role="status" data-override-filter-status="">{filter ? `顯示 ${visibleOverrides}／${draft.overrides.length} 筆；需要修正的商品一律顯示。` : `共 ${draft.overrides.length} 筆。`}</p>
            </div> : null}
            {draft.overrides.length ? <ol className="grid gap-3">
              {draft.overrides.map((override, index) => <OverrideRow key={override.uiId} index={index} uiId={override.uiId} hidden={!overrideVisible(override)}
                productId={override.productId} ratePercent={override.ratePercent} products={products} editable={hydrated}
                productError={errorOf(policyFieldKey.overrideProduct(override.uiId))} rateError={errorOf(policyFieldKey.overrideRate(override.uiId))}
                onProduct={value => setOverride(override.uiId, { productId: value })} onRate={value => setOverride(override.uiId, { ratePercent: value })}
                onRemove={() => update(current => ({ ...current, overrides: current.overrides.filter(item => item.uiId !== override.uiId) }))} />)}
            </ol> : <p className="text-sm text-slate-600">目前沒有商品佣金，所有商品都依件數階梯計算。</p>}
            <div><button type="button" className={buttonClass} disabled={draft.overrides.length >= MAX_POLICY_OVERRIDES || !products.length} onClick={() => update(current => ({ ...current, overrides: [...current.overrides, { productId: "", ratePercent: "0", uiId: nextOverrideId.current++ }] }))}>新增商品佣金</button></div>
          </Section>

          <div className="flex flex-wrap gap-3">
            <button name="intent" value="publish" className="min-h-11 rounded bg-blue-700 px-4 font-semibold text-white hover:bg-blue-800">{pending ? "處理中…" : "發布佣金政策"}</button>
            <button name="intent" value="pause" formNoValidate className={buttonClass} disabled={(state.revision ?? revision) === 0}>暫停新結帳政策</button>
          </div>
        </fieldset>
        {state.message && !serverError ? <p role="status" aria-live="polite">{state.message}</p> : null}
      </form>
    </div>
    <MerchantAffiliateCommissionEstimate terms={terms} products={estimateProducts} />
  </div>;
}

function OverrideRow({ index, uiId, hidden, productId, ratePercent, products, editable, productError, rateError, onProduct, onRate, onRemove }: {
  index: number; uiId: number; hidden: boolean; productId: string; ratePercent: string; products: Array<{ id: string; name: string }>; editable: boolean;
  productError?: string; rateError?: string; onProduct: (value: string) => void; onRate: (value: string) => void; onRemove: () => void;
}) {
  const field = useFieldMessages(productError);
  return <li hidden={hidden} data-policy-row={`override-${uiId}`} className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-[2fr_1fr_auto]">
    <div className="grid gap-1.5">
      {/* 選單不包在 <label> 裡：否則標籤文字會連同選項文字一起算進名稱。 */}
      <label htmlFor={policyControlId(policyFieldKey.overrideProduct(uiId))} className="text-sm font-medium text-slate-800">佣金商品 {index + 1}</label>
      <select name="overrideProduct" className={`${inputBase} ${field.controlClass}`} required value={productId} onChange={event => onProduct(event.target.value)} id={policyControlId(policyFieldKey.overrideProduct(uiId))} data-policy-field={policyFieldKey.overrideProduct(uiId)} {...field.controlProps}>
        <option value="">選擇商品</option>
        {products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
      </select>
      {field.messages}
    </div>
    <PercentField label={`商品 ${index + 1} 佣金（%）`} name="overrideRate" fieldKey={policyFieldKey.overrideRate(uiId)} value={ratePercent} onChange={onRate} error={rateError} editable={editable} />
    <button type="button" className={`${buttonClass} self-end`} onClick={onRemove}>移除商品 {index + 1}</button>
  </li>;
}
