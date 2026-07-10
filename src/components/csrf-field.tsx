import { CSRF_FIELD_NAME, getCsrfToken } from "@/lib/csrf";

export async function CsrfField() {
  const token = await getCsrfToken();
  return <input type="hidden" name={CSRF_FIELD_NAME} value={token} />;
}
