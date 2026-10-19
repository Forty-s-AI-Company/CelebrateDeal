/**
 * Sentry 資料最小化設定與送出前過濾（F-143）。
 *
 * 預設情況下 Sentry 會收集 cookies、完整 headers、網址參數與堆疊變數，其中可能含
 * Email、電話、卡號、session / CSRF / 付款 token。這裡的做法是兩層防護：
 *
 * 1. `sentryDataCollection`：從來源就不收集 cookies、query params、body、堆疊變數，
 *    headers 只留白名單。
 * 2. `scrubSentryEvent` 等 `beforeSend*`：即使其他欄位（錯誤訊息、extra、breadcrumb、
 *    log）夾帶個資，也在送出前遮蔽。
 *
 * 只使用純函式與常數，Node、Edge 與瀏覽器三個 runtime 都能載入。
 */

export const REDACTED = "[Filtered]";

/** 只收集不含個資的必要 headers；其餘（cookie、authorization、referer、x-forwarded-for…）一律不送。 */
export const REQUEST_HEADER_ALLOWLIST = ["accept", "accept-language", "content-length", "content-type", "host", "user-agent"] as const;
export const RESPONSE_HEADER_ALLOWLIST = ["cache-control", "content-length", "content-type"] as const;

/**
 * 對應 `@sentry/nextjs` 10 的 `dataCollection` 選項（取代已棄用的 `sendDefaultPii`）。
 * 未設定 `sendDefaultPii`：它預設為 false，且與 `dataCollection` 並存時會被忽略。
 */
export type SentryDataCollectionConfig = {
  userInfo: boolean;
  cookies: boolean;
  httpHeaders: { request: { allow: string[] }; response: { allow: string[] } };
  httpBodies: never[];
  queryParams: boolean;
  genAI: { inputs: boolean; outputs: boolean };
  stackFrameVariables: boolean;
};

export const sentryDataCollection: SentryDataCollectionConfig = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { allow: [...REQUEST_HEADER_ALLOWLIST] },
    response: { allow: [...RESPONSE_HEADER_ALLOWLIST] },
  },
  httpBodies: [],
  queryParams: false,
  genAI: { inputs: false, outputs: false },
  stackFrameVariables: false,
};

/** 欄位名稱以「單字」比對（camelCase 與分隔符都會拆開），避免把 `span`、`footprint` 之類誤判成敏感欄位。 */
const SENSITIVE_KEY_WORDS: ReadonlySet<string> = new Set([
  "password", "passwd", "pwd", "passcode", "secret", "secrets", "token", "tokens", "authorization", "auth",
  "credential", "credentials", "cookie", "cookies", "session", "csrf", "xsrf", "signature", "sig", "otp", "mfa",
  "totp", "recovery", "card", "cvv", "cvc", "iban", "email", "emails", "phone", "mobile", "tel", "address",
  "birthday", "birthdate", "ssn", "passport", "apikey", "hashinfo", "encryptinfo",
]);
const SENSITIVE_KEY_COMPOUNDS = ["hashinfo", "encryptinfo", "apikey", "accesskey", "privatekey", "secretkey", "tradesha", "idnumber", "nationalid"];

export function isSensitiveKey(key: string): boolean {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((word) => SENSITIVE_KEY_WORDS.has(word))) return true;
  const joined = words.join("");
  return SENSITIVE_KEY_COMPOUNDS.some((compound) => joined.includes(compound));
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi;
const BEARER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const PREFIXED_KEY_PATTERN = /\b(?:sk|pk|rk|whsec|xox[abprs]|ghp|gho|ghs|github_pat|glpat|AKIA|ya29)[-_A-Za-z0-9]{12,}/g;
const KEY_VALUE_PATTERN =
  /\b([A-Za-z0-9_.-]*(?:pass(?:word|wd)?|secret|token|authorization|api[_-]?key|apikey|csrf|session|signature|cookie|hashinfo|encryptinfo)[A-Za-z0-9_.-]*)(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&,;]+)/gi;
// 信用卡：13～19 位數字，可用空白或連字號分隔（以 Luhn 檢查降低誤判）。
const CARD_PATTERN = /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g;
// 台灣手機／市話與國際格式電話（至少 8 位數，含可選的 +國碼與分隔符）。
const PHONE_PATTERN = /(?<![\d.])(?:\+?886[ -]?|\+?\d{1,3}[ -])?\(?0?\d{1,4}\)?[ -]?\d{3,4}[ -]?\d{3,4}(?![\d.])/g;
// 沒有明確前綴的長 token：32 碼以上的 hex，或 40 碼以上的 base64/base64url。
const LONG_HEX_PATTERN = /\b[a-f0-9]{32,}\b/gi;
const LONG_OPAQUE_PATTERN = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{40,}\b/g;
const URL_QUERY_PATTERN = /(\bhttps?:\/\/[^\s"'<>?#]*|(?<=^|[\s"'(])\/[^\s"'<>?#]*)\?[^\s"'<>#]*/gi;

function luhnValid(digits: string) {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function scrubCardNumbers(text: string) {
  return text.replace(CARD_PATTERN, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits) ? REDACTED : match;
  });
}

function scrubPhoneNumbers(text: string) {
  return text.replace(PHONE_PATTERN, (match) => {
    const digits = match.replace(/\D/g, "");
    // 至少 8 碼才視為電話，避免把訂單序號、金額或毫秒時間戳記誤遮。
    if (digits.length < 8 || digits.length > 15) return match;
    const looksLikePhone = /^\+?(886|\d{1,3}[ -])/.test(match.trim()) || /^0\d/.test(digits) || /[ -]/.test(match);
    return looksLikePhone ? REDACTED : match;
  });
}

/** 遮蔽字串中的 Email、電話、卡號、token 樣式，並移除網址的 query string。 */
export function scrubString(value: string): string {
  if (!value) return value;
  let text = value;
  text = text.replace(URL_QUERY_PATTERN, (_match, base: string) => `${base}?${REDACTED}`);
  text = text.replace(BEARER_PATTERN, (_match, scheme: string) => `${scheme} ${REDACTED}`);
  text = text.replace(JWT_PATTERN, REDACTED);
  text = text.replace(PREFIXED_KEY_PATTERN, REDACTED);
  text = text.replace(KEY_VALUE_PATTERN, (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`);
  // 長 token 要先於卡號／電話處理，否則 token 內的數字片段會被當成電話切碎。
  text = text.replace(LONG_HEX_PATTERN, REDACTED);
  text = text.replace(LONG_OPAQUE_PATTERN, REDACTED);
  text = text.replace(EMAIL_PATTERN, REDACTED);
  text = scrubCardNumbers(text);
  text = scrubPhoneNumbers(text);
  return text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const MAX_DEPTH = 8;

/**
 * 事件的結構欄位（識別碼、版本、時間、堆疊位置）不是使用者輸入，原樣保留。
 * 若連它們一起過濾，event_id、trace_id、release、debug_id 會被遮成無效值，事件會被 Relay 拒收或無法對應 source map。
 */
const PRESERVED_LEAF_KEYS: ReadonlySet<string> = new Set([
  "event_id", "trace_id", "span_id", "parent_span_id", "release", "dist", "environment", "debug_id",
  "timestamp", "start_timestamp", "level", "platform", "sampled", "sample_rate", "sample_rand", "op", "origin", "status",
  "filename", "abs_path", "function", "module", "package", "lineno", "colno", "in_app",
  "instruction_addr", "image_addr", "symbol_addr", "code_file", "code_id", "image_size",
]);

/** 整棵子樹原樣保留（SDK 與符號化需要的中繼資料，不含使用者資料）。 */
const PRESERVED_SUBTREE_KEYS: ReadonlySet<string> = new Set(["sdk", "debug_meta", "modules", "sdkProcessingMetadata"]);

function isPreservedKey(key: string) {
  return PRESERVED_LEAF_KEYS.has(key) || PRESERVED_SUBTREE_KEYS.has(key) || key.startsWith("sentry.");
}

/** 深度走訪任意結構：敏感欄位名稱整個遮蔽，其餘字串逐一過濾。不修改輸入。 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  if (!isPlainObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isPreservedKey(key) && (PRESERVED_SUBTREE_KEYS.has(key) || typeof item !== "object" || item === null)) {
      result[key] = item;
      continue;
    }
    result[key] = isSensitiveKey(key) && item !== null && item !== undefined && item !== ""
      ? REDACTED
      : scrubValue(item, depth + 1);
  }
  return result;
}

function filterHeaders(headers: unknown, allowlist: readonly string[]) {
  if (!isPlainObject(headers)) return undefined;
  const allowed = new Set(allowlist);
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (allowed.has(name.toLowerCase())) result[name] = typeof value === "string" ? scrubString(value) : value;
  }
  return result;
}

// SDK 的事件型別是 interface（沒有 index signature），所以用 object 當約束，內部再轉型處理。
type SentryLikeEvent = object;
type EventShape = {
  user?: Record<string, unknown>;
  request?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * 通用事件過濾（錯誤與交易共用）。回傳新物件，不修改輸入；永遠不丟棄事件，只遮蔽內容。
 */
export function scrubSentryEvent<T extends SentryLikeEvent>(input: T): T {
  const event = input as EventShape;
  const scrubbed = scrubValue(event) as EventShape;

  // 使用者資訊只保留不透明的內部 ID，不送 email、username、IP。
  if (event.user && typeof event.user === "object") {
    const id = event.user.id;
    scrubbed.user = id === undefined || id === null ? undefined : { id: String(id) };
    if (scrubbed.user === undefined) delete scrubbed.user;
  }

  if (event.request && typeof event.request === "object") {
    const request: Record<string, unknown> = { ...(scrubbed.request ?? {}) };
    delete request.cookies;
    delete request.data;
    delete request.query_string;
    const headers = filterHeaders(event.request.headers, REQUEST_HEADER_ALLOWLIST);
    if (headers) request.headers = headers;
    else delete request.headers;
    if (typeof event.request.url === "string") request.url = scrubString(event.request.url);
    scrubbed.request = request;
  }

  return scrubbed as unknown as T;
}

type SentryLikeBreadcrumb = object;

export function scrubSentryBreadcrumb<T extends SentryLikeBreadcrumb>(breadcrumb: T): T {
  return scrubValue(breadcrumb) as T;
}

type SentryLikeLog = object;

export function scrubSentryLog<T extends SentryLikeLog>(log: T): T {
  return scrubValue(log) as T;
}

/** 交給 `Sentry.init` 的過濾 hooks；型別刻意放寬，避免綁定特定 SDK 版本的事件型別。 */
export const sentryBeforeSend = <T extends SentryLikeEvent>(event: T): T => scrubSentryEvent(event);
export const sentryBeforeSendTransaction = <T extends SentryLikeEvent>(event: T): T => scrubSentryEvent(event);
export const sentryBeforeBreadcrumb = <T extends SentryLikeBreadcrumb>(breadcrumb: T): T => scrubSentryBreadcrumb(breadcrumb);
export const sentryBeforeSendLog = <T extends SentryLikeLog>(log: T): T => scrubSentryLog(log);

/** 取樣率：輪詢類 route 幾乎不取樣，付款／結帳／webhook 全取樣，其餘 10%。 */
export const TRACE_SAMPLE_RATES = {
  polling: 0.005,
  critical: 1,
  default: 0.1,
  development: 1,
} as const;

const POLLING_PATH_PATTERN = /^\/api\/(live-|stream-usage|analytics|presence|heartbeat)/;
const CRITICAL_PATH_PATTERN = /^\/(api\/(payments|webhooks|checkout|commerce|refunds?)|checkout|lp\/[^/]+\/[^/]+\/checkout)(\/|$)/;

function pathFromName(name: string) {
  const match = /(?:^|\s)(\/[^\s?#]*)/.exec(name);
  return match?.[1] ?? "";
}

export function resolveTraceSampleRate(
  context: { name?: string; attributes?: Record<string, unknown> | undefined },
  isDevelopment: boolean,
): number {
  if (isDevelopment) return TRACE_SAMPLE_RATES.development;
  const attributePath = context.attributes?.["url.path"] ?? context.attributes?.["http.target"];
  const path = typeof attributePath === "string" && attributePath ? attributePath.split("?")[0] : pathFromName(context.name ?? "");
  if (CRITICAL_PATH_PATTERN.test(path)) return TRACE_SAMPLE_RATES.critical;
  if (POLLING_PATH_PATTERN.test(path)) return TRACE_SAMPLE_RATES.polling;
  return TRACE_SAMPLE_RATES.default;
}

type SamplerContext = {
  name?: string;
  attributes?: Record<string, unknown> | undefined;
  inheritOrSampleWith: (fallbackSampleRate: number) => number;
};

/**
 * 伺服器與瀏覽器共用的取樣器。
 * - 付款／結帳／webhook：固定 1，不沿用上游決定（否則從 10% 的商品頁發出的結帳 API 會被丟掉）。
 * - 輪詢類：固定 0.005，不沿用上游決定（否則會被上游的 10% 帶高）。
 * - 其餘：沿用上游 trace 的決定，沒有上游時 10%，讓一般頁面的 trace 保持完整。
 */
export function createTracesSampler(isDevelopment: boolean) {
  return (context: SamplerContext): number => {
    const rate = resolveTraceSampleRate(context, isDevelopment);
    return rate === TRACE_SAMPLE_RATES.default ? context.inheritOrSampleWith(rate) : rate;
  };
}
