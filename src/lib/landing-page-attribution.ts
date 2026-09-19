/** Only carry marketing parameters to our registration route, never arbitrary query data. */
export function registrationAttributionHref(href: string, search: string, pageId?: string) {
  if (!/^\/form\/[^/?#]+(?:[?#]|$)/u.test(href)) return href;
  const destination = new URL(href, "https://landing.invalid");
  const source = new URLSearchParams(search);
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "share"]) {
    const value = source.get(key);
    if (value && !destination.searchParams.has(key)) destination.searchParams.set(key, value.slice(0, 160));
  }
  if (pageId) destination.searchParams.set("lp", pageId);
  return `${destination.pathname}${destination.search}${destination.hash}`;
}
