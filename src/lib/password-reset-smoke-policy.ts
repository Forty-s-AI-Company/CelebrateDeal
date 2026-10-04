import { isExplicitLocalE2eRuntime } from "@/lib/app-url";

/** Keep the mail smoke action available only outside deployed production. */
export function isPasswordResetSmokeEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV !== "production" || isExplicitLocalE2eRuntime(env);
}
