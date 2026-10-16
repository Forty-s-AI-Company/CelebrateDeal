import { isExplicitLocalE2eRuntime } from "@/lib/app-url";

const DEFAULT_LOGIN_SOURCE_LIMIT = 20;
const LOCAL_E2E_LOGIN_SOURCE_LIMIT = 200;
const DEFAULT_LOGIN_SOURCE_EMAIL_LIMIT = 5;

/**
 * Returns the source-wide login limit for the explicitly controlled local E2E
 * runtime. The environment is passed by the caller so this decision is made
 * at request time instead of being fixed during module evaluation or build.
 */
export function getLoginSourceLimit(env: NodeJS.ProcessEnv) {
  return isExplicitLocalE2eRuntime(env)
    ? LOCAL_E2E_LOGIN_SOURCE_LIMIT
    : DEFAULT_LOGIN_SOURCE_LIMIT;
}

/** Keep the per-account security threshold identical in local E2E and production. */
export function getLoginSourceEmailLimit() {
  return DEFAULT_LOGIN_SOURCE_EMAIL_LIMIT;
}
