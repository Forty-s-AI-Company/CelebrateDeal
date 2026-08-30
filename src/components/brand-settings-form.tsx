"use client";

import { useActionState, useState, type ChangeEvent, type ReactNode } from "react";
import Image from "next/image";
import { saveBrandSettingsActionState, type BrandSettingsActionState, type BrandSettingsFormValues } from "@/app/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { MediaUploadField, type MediaUploadPersistedValue } from "@/components/media-upload-field";

const inputClassName = "h-11 rounded-md border border-border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100";
const SAFE_PRIMARY_COLOR = "#2563eb";
const SAFE_CTA_COLOR = "#f97316";

function safeBrandColor(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/iu.test(value) ? value : fallback;
}

/** 以 WCAG 相對亮度選擇黑白前景色，讓品牌色上的文字維持最高對比。 */
export function accessibleForeground(background: string) {
  const match = /^#([0-9a-f]{6})$/iu.exec(background);
  const hex = match?.[1];
  if (!hex) return "#000000";

  const [red = 0, green = 0, blue = 0] = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);

  return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}

function safeLogoUrl(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function isPrivateOrSpecialIpv4(value: string) {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first = Number.NaN, second = Number.NaN] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function parseIpv6Segments(value: string) {
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const rawSegments = [...left, ...right];
  if (rawSegments.some((segment) => segment === "")) return null;
  const segments = rawSegments.flatMap((segment, index) => {
    if (!segment.includes(".")) return [/^[0-9a-f]{1,4}$/iu.test(segment) ? Number.parseInt(segment, 16) : Number.NaN];
    if (index !== rawSegments.length - 1) return [Number.NaN, Number.NaN];
    const octets = segment.split(".").map(Number);
    const [
      firstOctet = Number.NaN,
      secondOctet = Number.NaN,
      thirdOctet = Number.NaN,
      fourthOctet = Number.NaN,
    ] = octets;
    return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
      ? [(firstOctet << 8) | secondOctet, (thirdOctet << 8) | fourthOctet]
      : [Number.NaN, Number.NaN];
  });
  const zeroCount = halves.length === 2 ? 8 - segments.length : 0;
  if (zeroCount < (halves.length === 2 ? 1 : 0) || segments.length + zeroCount !== 8) return null;
  const expanded = halves.length === 2
    ? [...segments.slice(0, left.length), ...Array.from({ length: zeroCount }, () => 0), ...segments.slice(left.length)]
    : segments;
  return expanded.every((segment) => Number.isInteger(segment) && segment >= 0 && segment <= 0xffff) ? expanded : null;
}

function isUnsafeContactHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.+$/u, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(host)) return isPrivateOrSpecialIpv4(host);

  const segments = parseIpv6Segments(host);
  if (!segments) return false;
  const [
    firstSegment = Number.NaN,
    secondSegment = Number.NaN,
    thirdSegment = Number.NaN,
    fourthSegment = Number.NaN,
    fifthSegment = Number.NaN,
    sixthSegment = Number.NaN,
    seventhSegment = Number.NaN,
    eighthSegment = Number.NaN,
  ] = segments;
  const isAllZero = segments.every((segment) => segment === 0);
  const isLoopback = !isAllZero && [firstSegment, secondSegment, thirdSegment, fourthSegment, fifthSegment, sixthSegment, seventhSegment].every((segment) => segment === 0) && eighthSegment === 1;
  const isUniqueLocal = (firstSegment & 0xfe00) === 0xfc00;
  const isLinkLocal = (firstSegment & 0xffc0) === 0xfe80;
  const isIpv4Mapped = [firstSegment, secondSegment, thirdSegment, fourthSegment, fifthSegment].every((segment) => segment === 0) && sixthSegment === 0xffff;
  if (!isIpv4Mapped) return isAllZero || isLoopback || isUniqueLocal || isLinkLocal;

  const mappedIpv4 = [seventhSegment >> 8, seventhSegment & 0xff, eighthSegment >> 8, eighthSegment & 0xff].join(".");
  return isPrivateOrSpecialIpv4(mappedIpv4);
}

function safeContactUrl(value: string) {
  if (!value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || isUnsafeContactHostname(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function BrandHeader({ values, primaryColor, logoUrl }: { values: BrandSettingsFormValues; primaryColor: string; logoUrl: string | null }) {
  const senderName = values.senderName.trim() || values.name || "品牌名稱";
  return (
    <div className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: primaryColor, color: accessibleForeground(primaryColor) }}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-slate-900 bg-white text-xs font-semibold text-slate-950">
        {logoUrl ? (
          <Image src={logoUrl} alt={`${values.name || "品牌"} Logo`} width={32} height={32} unoptimized className="h-8 w-8 rounded object-contain" />
        ) : (
          <span aria-label="品牌 Logo 預覽佔位">Logo</span>
        )}
      </span>
      <div className="min-w-0">
        <span className="block truncate text-sm font-semibold">{values.name || "品牌名稱"}</span>
        <span className="block truncate text-xs">寄件人：{senderName}</span>
      </div>
    </div>
  );
}

function DevicePreview({
  device,
  values,
  primaryColor,
  ctaColor,
  logoUrl,
}: {
  device: "desktop" | "mobile";
  values: BrandSettingsFormValues;
  primaryColor: string;
  ctaColor: string;
  logoUrl: string | null;
}) {
  return (
    <div data-device={device} className={device === "desktop" ? "overflow-hidden rounded-xl border border-slate-200 bg-white" : "mx-auto max-w-[15rem] overflow-hidden rounded-[1.5rem] border-4 border-slate-800 bg-white"}>
      <BrandHeader values={values} primaryColor={primaryColor} logoUrl={logoUrl} />
      <div className="grid gap-3 p-4">
        <div className="h-16 rounded-lg bg-slate-100" aria-hidden="true" />
        <p className="text-xs text-slate-500">公開研討會／報名頁示意</p>
        <span className="w-fit rounded-md px-3 py-2 text-xs font-semibold" style={{ backgroundColor: ctaColor, color: accessibleForeground(ctaColor) }}>立即報名</span>
      </div>
    </div>
  );
}

function BrandPublicPreview({ values }: { values: BrandSettingsFormValues }) {
  const primaryColor = safeBrandColor(values.primaryColor, SAFE_PRIMARY_COLOR);
  const ctaColor = safeBrandColor(values.ctaColor, SAFE_CTA_COLOR);
  const logoUrl = safeLogoUrl(values.logoUrl);
  const safeContact = safeContactUrl(values.contactUrl);

  return (
    <section data-testid="brand-public-preview" aria-label="品牌公開效果預覽" className="grid gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">公開品牌效果預覽</h2>
          <p className="mt-1 text-xs text-slate-500">這是未發布的品牌效果預覽，不會變更任何公開頁面。</p>
        </div>
        <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs text-slate-600">未發布</span>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_15rem]">
        <DevicePreview device="desktop" values={values} primaryColor={primaryColor} ctaColor={ctaColor} logoUrl={logoUrl} />
        <DevicePreview device="mobile" values={values} primaryColor={primaryColor} ctaColor={ctaColor} logoUrl={logoUrl} />
      </div>
      <dl className="grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
        <div><dt className="inline font-semibold">Slug：</dt><dd className="inline break-words">{values.slug || "未設定"}</dd></div>
        <div><dt className="inline font-semibold">客服 Email：</dt><dd className="inline break-words">{values.supportEmail || "未設定"}</dd></div>
        <div><dt className="inline font-semibold">寄件人：</dt><dd className="inline break-words">{values.senderName.trim() || values.name || "品牌名稱"}</dd></div>
        <div data-contact-url-state={values.contactUrl ? (safeContact ? "safe" : "invalid") : "empty"}>
          <dt className="inline font-semibold">聯絡網址：</dt>
          <dd className="inline break-words">
            {safeContact ? <a className="text-primary underline" href={safeContact}>{values.contactUrl}</a> : values.contactUrl ? <span>{values.contactUrl}（目前不會成為可點連結）</span> : "未設定"}
          </dd>
        </div>
        <div><dt className="inline font-semibold">時區：</dt><dd className="inline break-words">{values.timezone || "未設定"}</dd></div>
      </dl>
    </section>
  );
}

export function BrandSettingsForm({
  initialValues,
  csrfField,
}: {
  initialValues: BrandSettingsFormValues;
  csrfField: ReactNode;
}) {
  const initialState: BrandSettingsActionState = {
    status: "idle",
    message: "",
    values: initialValues,
  };
  const [state, formAction, pending] = useActionState(saveBrandSettingsActionState, initialState);
  const [editedValues, setEditedValues] = useState<Partial<BrandSettingsFormValues>>({});
  const [logoUploadBlocked, setLogoUploadBlocked] = useState(false);
  // The Server Action state is the authoritative base after a round trip;
  // local edits overlay only the field currently being changed, so every input
  // remains controlled without an effect-driven cascading render.
  const values = { ...state.values, ...editedValues };

  function updateValue(key: keyof BrandSettingsFormValues) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setEditedValues((current) => ({ ...current, [key]: event.target.value }));
    };
  }

  return (
    <form action={formAction} aria-busy={pending} className="grid gap-4">
      {csrfField}
      {state.status === "error" ? (
        <p role="alert" aria-live="assertive" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          品牌名稱
          <input name="name" required value={values.name} onChange={updateValue("name")} className={inputClassName} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          品牌 Slug
          <input name="slug" required value={values.slug} onChange={updateValue("slug")} className={inputClassName} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          主要色
          <input name="primaryColor" type="color" value={values.primaryColor} onChange={updateValue("primaryColor")} className="h-11 w-full rounded-md border border-border bg-white p-1" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          CTA 色
          <input name="ctaColor" type="color" value={values.ctaColor} onChange={updateValue("ctaColor")} className="h-11 w-full rounded-md border border-border bg-white p-1" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          時區
          <input name="timezone" required value={values.timezone} onChange={updateValue("timezone")} className={inputClassName} />
          <span className="text-xs font-normal text-slate-500">請使用 IANA 時區，例如 Asia/Taipei。</span>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          客服 Email
          <input name="supportEmail" type="email" value={values.supportEmail} onChange={updateValue("supportEmail")} className={inputClassName} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          寄件人名稱
          <input name="senderName" maxLength={80} placeholder="留白時使用品牌名稱" value={values.senderName} onChange={updateValue("senderName")} className={inputClassName} />
          <span className="text-xs font-normal text-slate-500">顯示在品牌寄件資訊；最多 80 字元，不含控制字元。</span>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          聯絡網址
          <input name="contactUrl" type="url" maxLength={2048} placeholder="https://example.com/contact" value={values.contactUrl} onChange={updateValue("contactUrl")} className={inputClassName} />
          <span className="text-xs font-normal text-slate-500">僅接受 HTTPS 絕對網址；不接受帳密、本機或內部 IP。</span>
        </label>
      </div>

      <MediaUploadField
        kind="image"
        label="品牌 Logo"
        description="直接上傳品牌 Logo；完成後儲存表單即可套用。"
        defaultUrl={values.logoUrl}
        defaultAssetId={values.logoAssetId ?? ""}
        urlInputName="logoUrl"
        assetIdInputName="logoAssetId"
        statusInputName="logoUploadPhase"
        allowExternalUrlFallback
        onValueChange={(media: MediaUploadPersistedValue) => {
          setEditedValues((current) => ({
            ...current,
            logoUrl: media.url,
            logoAssetId: media.assetId || undefined,
          }));
        }}
        onBlockingChange={setLogoUploadBlocked}
      />

      {logoUploadBlocked ? (
        <p role="alert" aria-live="assertive" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Logo 上傳尚未完成，請完成上傳或移除未完成的檔案後再儲存。
        </p>
      ) : null}

      <BrandPublicPreview values={values} />

      <div className="flex justify-end">
        <FormSubmitButton
          disabled={logoUploadBlocked}
          pendingChildren="儲存中…"
          pendingMessage="正在儲存品牌設定，請勿重複送出。"
        >
          儲存品牌設定
        </FormSubmitButton>
      </div>
    </form>
  );
}
