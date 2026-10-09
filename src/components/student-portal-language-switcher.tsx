"use client";
import {usePathname} from "next/navigation";
import {setStudentPortalLocaleAction} from "@/app/actions/student-portal-locale-actions";
import type {StudentPortalLocale} from "@/lib/student-portal-locale";
export function StudentPortalLanguageSwitcher({locale,csrfToken}:{locale:StudentPortalLocale;csrfToken:string}){
 const pathname=usePathname();
 return <nav aria-label={locale==="en"?"Language":"語言"} className="flex items-center justify-end gap-3 bg-white px-4 py-2 text-sm"><form action={setStudentPortalLocaleAction} className="flex items-center gap-2"><input type="hidden" name="_csrf" value={csrfToken}/><input type="hidden" name="returnPath" value={pathname}/><label htmlFor="portal-locale">{locale==="en"?"Language":"語言"}</label><select id="portal-locale" name="locale" defaultValue={locale} className="min-h-11 rounded border px-2"><option value="zh-TW">繁體中文</option><option value="en">English</option></select><button className="min-h-11 rounded border px-3">{locale==="en"?"Apply":"套用"}</button></form></nav>;
}
