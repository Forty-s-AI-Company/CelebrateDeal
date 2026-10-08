import type {Metadata} from "next";
import {resolveStudentPortalLocale} from "@/lib/student-portal-locale";
import {getCsrfToken} from "@/lib/csrf";
import {StudentPortalLanguageSwitcher} from "@/components/student-portal-language-switcher";
import {StudentPortalPwa} from "@/components/student-portal-pwa";
export const metadata:Metadata={manifest:"/portal/manifest.webmanifest"};
export default async function StudentPortalLayout({children}:{children:React.ReactNode}){const [locale,csrfToken]=await Promise.all([resolveStudentPortalLocale(),getCsrfToken()]);return <div lang={locale}><StudentPortalLanguageSwitcher locale={locale} csrfToken={csrfToken}/><StudentPortalPwa/>{children}</div>;}
