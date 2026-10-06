import {cookies} from "next/headers";
export type StudentPortalLocale="zh-TW"|"en";
export const STUDENT_PORTAL_LOCALE_COOKIE="celebratedeal_portal_locale";
/** Locale is only a UI preference; never use it as an identity selector. */
export function normalizeStudentPortalLocale(value:unknown):StudentPortalLocale{return value==="en"?"en":"zh-TW";}
export async function resolveStudentPortalLocale(){return normalizeStudentPortalLocale((await cookies()).get(STUDENT_PORTAL_LOCALE_COOKIE)?.value);}
export function safeStudentPortalReturnPath(value:unknown){return value==="/portal/start/welcome"?value:typeof value==="string"&&value.length<=400&&/^\/portal(?:\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/login|\/notifications|\/learn\/[A-Za-z0-9_-]{1,160}(?:\/community(?:\/(?!data(?:\/|$))[A-Za-z0-9_-]{1,128})?)?)?)?\/?$/u.test(value)?value:"/portal/";}
