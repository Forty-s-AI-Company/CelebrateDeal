/** Vitest stand-in for `next/font/google`: the real loaders only exist after Next's SWC transform. */
function loader(options: { variable?: string } = {}) {
  return { className: "", variable: options.variable ? `mock-font${options.variable}` : "", style: { fontFamily: "system-ui" } };
}
export const Noto_Sans_TC = loader;
export const Noto_Serif_TC = loader;
export const LXGW_WenKai_TC = loader;
export const Space_Grotesk = loader;
