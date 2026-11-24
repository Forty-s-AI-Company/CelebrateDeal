/**
 * True only inside a deployed Vercel Function (Preview or Production). Vercel
 * injects VERCEL_ENV at runtime; a request cannot set it. `vercel dev`
 * (VERCEL_ENV=development) is a local proxy and does not qualify.
 */
export function isVercelDeployment(env: NodeJS.ProcessEnv = process.env) {
  return env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
}
