"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from "@/lib/i18n";

export function LanguageSwitcher({ locale = "zh-TW" }: { locale?: Locale }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState<Locale>(locale);
  const onChange = (next: Locale) => {
    setValue(next);
    document.cookie = `locale=${encodeURIComponent(next)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", next);
    router.replace(`${pathname}${params.size ? `?${params.toString()}` : ""}`);
  };
  return <label className="inline-flex items-center gap-2 text-sm text-slate-600"><span className="sr-only">語言</span><select aria-label="語言" value={value} onChange={(event) => onChange(event.target.value as Locale)} className="min-h-11 rounded-md border border-border bg-white px-3 py-2 font-medium">{SUPPORTED_LOCALES.map((item) => <option key={item} value={item}>{LOCALE_LABELS[item]}</option>)}</select></label>;
}

export default LanguageSwitcher;
