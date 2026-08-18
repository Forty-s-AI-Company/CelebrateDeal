type SmokeEnvironment = "local" | "preview" | "staging";

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

function normalizeBaseUrl(url: URL) {
  url.hash = "";
  url.search = "";
  // Smoke API routes are rooted at the deployment origin, never below a path
  // copied from a browser address bar.
  url.pathname = "";
  return url.toString().replace(/\/$/, "");
}
