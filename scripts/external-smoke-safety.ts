type SmokeEnvironment = "local" | "preview" | "staging";

export type SmokePayloadClass = "empty" | "json" | "text" | "other";
export type SmokeTransportClass = "success" | "redirect" | "client_error" | "server_error" | "unknown";
export type SmokeApplicationClass = "ok" | "not_ok" | "unknown";

export type SmokeResponseObservation = {
  status: number;
  ok: boolean;
  payload: unknown;
};

type ResolveSmokeTargetOptions = {
  targetAppUrl?: string;
  smokeEnvironment?: string;
  allowStagingSmoke?: string;
  expectedHostname?: string;
};

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Fail closed before an external smoke test can contact a remote application.
 * Remote runs require three independent, explicit signals so a production URL
 * cannot be reached merely because TARGET_APP_URL was set in a shell profile.
 */
export function resolveSmokeTarget(options: ResolveSmokeTargetOptions) {
  const rawTarget = options.targetAppUrl?.trim() || "http://localhost:31023";
  let url: URL;

  try {
    url = new URL(rawTarget);
  } catch {
    throw new Error("TARGET_APP_URL must be a valid absolute URL.");
  }

  if (url.username || url.password) {
    throw new Error("TARGET_APP_URL must not contain credentials.");
  }

  const isLoopback = LOOPBACK_HOSTNAMES.has(url.hostname);
  if (isLoopback) {
    if (!(["http:", "https:"] as string[]).includes(url.protocol)) {
      throw new Error("Local smoke targets must use HTTP or HTTPS.");
    }
    return normalizeBaseUrl(url);
  }

  if (url.protocol !== "https:") {
    throw new Error("Remote smoke targets must use HTTPS.");
  }

  const environment = options.smokeEnvironment?.trim().toLowerCase() as SmokeEnvironment | undefined;
  if (environment !== "preview" && environment !== "staging") {
    throw new Error("Remote smoke requires SMOKE_ENVIRONMENT=preview or staging.");
  }

  if (options.allowStagingSmoke !== "true") {
    throw new Error("Remote smoke requires ALLOW_STAGING_SMOKE=true.");
  }

  const expectedHostname = options.expectedHostname?.trim().toLowerCase();
  if (!expectedHostname) {
    throw new Error("Remote smoke requires SMOKE_EXPECTED_HOSTNAME.");
  }
  if (expectedHostname !== url.hostname.toLowerCase()) {
    throw new Error("TARGET_APP_URL does not match SMOKE_EXPECTED_HOSTNAME.");
  }

  return normalizeBaseUrl(url);
}

/**
 * Return a bounded classification for an untrusted provider response.
 *
 * The smoke runner may inspect response bodies to decide whether a check
 * passed, but evidence output must never contain the body itself. Keeping
 * this formatter pure makes that boundary easy to test without contacting a
 * remote service.
 */
export function summarizeSmokeResponse(observation: SmokeResponseObservation) {
  return [
    `HTTP ${normalizeStatus(observation.status)}`,
    `transport=${classifyTransport(observation.status, observation.ok)}`,
    `payload=${classifyPayload(observation.payload)}`,
    `application=${classifyApplication(observation.payload)}`,
  ].join("; ");
}

/**
 * Convert arbitrary runner errors into an allowlisted category.
 *
 * Error messages can contain URLs, request headers, provider identifiers, or
 * other untrusted values, so they are deliberately discarded.
 */
export function summarizeSmokeFailure(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") {
    return "error=timeout";
  }
  if (error instanceof TypeError) {
    return "error=network_failure";
  }
  return "error=runner_failure";
}

function normalizeStatus(status: number) {
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : "unknown";
}

function classifyTransport(status: number, ok: boolean): SmokeTransportClass {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return "unknown";
  }
  if (status >= 200 && status <= 299 && ok) {
    return "success";
  }
  if (status >= 300 && status <= 399) {
    return "redirect";
  }
  if (status >= 400 && status <= 499) {
    return "client_error";
  }
  if (status >= 500 && status <= 599) {
    return "server_error";
  }
  return "unknown";
}

function classifyApplication(payload: unknown): SmokeApplicationClass {
  if (isPlainRecord(payload) && payload.ok === true) {
    return "ok";
  }
  if (isPlainRecord(payload) && payload.ok === false) {
    return "not_ok";
  }
  return "unknown";
}

function classifyPayload(payload: unknown): SmokePayloadClass {
  if (payload === null || payload === undefined || payload === "") {
    return "empty";
  }
  if (typeof payload === "string") {
    return "text";
  }
  if (isPlainRecord(payload)) {
    return "json";
  }
  return "other";
}

function isPlainRecord(payload: unknown): payload is Record<string, unknown> {
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload));
}

function normalizeBaseUrl(url: URL) {
  url.hash = "";
  url.search = "";
  // Smoke API routes are rooted at the deployment origin, never below a path
  // copied from a browser address bar.
  url.pathname = "";
  return url.toString().replace(/\/$/, "");
}
