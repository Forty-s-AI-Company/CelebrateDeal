"use server";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {assertServerActionSecurity} from "@/lib/csrf";
import {getCanonicalAppUrl} from "@/lib/app-url";
import {normalizeStudentPortalLocale,safeStudentPortalReturnPath,STUDENT_PORTAL_LOCALE_COOKIE} from "@/lib/student-portal-locale";
/** CSRF-protected preference change never alters a session or entitlement. */
export async function setStudentPortalLocaleAction(formData:FormData){
 await assertServerActionSecurity(formData);
 (await cookies()).set(STUDENT_PORTAL_LOCALE_COOKIE,normalizeStudentPortalLocale(formData.get("locale")),{httpOnly:true,sameSite:"lax",secure:new URL(getCanonicalAppUrl()).protocol==="https:",path:"/portal",maxAge:365*24*60*60});
 redirect(safeStudentPortalReturnPath(formData.get("returnPath")));
}
