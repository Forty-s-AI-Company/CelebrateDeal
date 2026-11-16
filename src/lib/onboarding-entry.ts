/** The one place merchants see their 上線任務; other entry points lead here. */
export const ONBOARDING_HOME_PATH = "/onboarding";

type SearchParams = Record<string, string | string[] | undefined>;

/** Builds `path` with the incoming query kept as-is (repeated keys included) for a retired route. */
export function pathWithSearchParams(path: string, searchParams: SearchParams | undefined) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  const serialized = query.toString();
  return serialized ? `${path}?${serialized}` : path;
}
