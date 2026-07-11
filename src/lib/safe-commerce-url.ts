const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export class UnsafeCommerceUrlError extends Error {
  constructor() {
    super("Commerce URL must be an absolute HTTPS URL");
    this.name = "UnsafeCommerceUrlError";
  }
}

export function safeCommerceUrlOrNull(value: string | null | undefined) {
  if (!value || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return null;

  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === "https:") return url.toString();
    if (url.protocol === "http:" && process.env.NODE_ENV !== "production" && LOCAL_HTTP_HOSTS.has(url.hostname)) {
      return url.toString();
    }
  } catch {
    return null;
  }

  return null;
}

export function normalizeOptionalCommerceUrl(value: string | null | undefined) {
  if (!value) return null;
  const safeUrl = safeCommerceUrlOrNull(value);
  if (!safeUrl) throw new UnsafeCommerceUrlError();
  return safeUrl;
}
