import { isExplicitLocalE2eRuntime } from "@/lib/app-url";

const DEFAULT_LOGIN_SOURCE_LIMIT = 20;
const LOCAL_E2E_LOGIN_SOURCE_LIMIT = 200;

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
