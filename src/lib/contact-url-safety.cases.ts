/**
 * Shared case table for brand contact URLs (#655 review). The server check
 * (`contact-url-safety.ts`), the email snapshot (`email-delivery-pii.ts`) and
 * the brand settings preview in the browser (`contact-url-rules.ts`) must give
 * the same result for every case; `contact-url-safety.test.ts` runs each one.
 *
 * `expected` is the normalized URL that is accepted, or null when the URL is
 * refused. Adding a refusal is fine; turning a refusal into an acceptance
 * loosens the SSRF rules and needs a security review.
 */
export type ContactUrlCase = {
  name: string;
  input: string;
  expected: string | null;
};

export const CONTACT_URL_REFUSED_CASES: readonly ContactUrlCase[] = [
  // Shape
  { name: "empty", input: "", expected: null },
  { name: "whitespace only", input: "   ", expected: null },
  { name: "not a URL", input: "contact us", expected: null },
  { name: "http", input: "http://example.test/contact", expected: null },
  { name: "ftp", input: "ftp://example.test/contact", expected: null },
  { name: "javascript scheme", input: "javascript:alert(1)", expected: null },
  { name: "data scheme", input: "data:text/html,hi", expected: null },
  { name: "username", input: "https://user@example.test/contact", expected: null },
  { name: "username and password", input: "https://user:pass@example.test/contact", expected: null },
  { name: "password only", input: "https://:pass@example.test/contact", expected: null },
  { name: "invalid IPv4 octet", input: "https://999.1.1.1/", expected: null },
  { name: "invalid IPv6", input: "https://[1::2::3]/", expected: null },

  // localhost
  { name: "localhost", input: "https://localhost/contact", expected: null },
  { name: "localhost uppercase with trailing dot", input: "https://LOCALHOST./contact", expected: null },
  { name: "localhost with port", input: "https://localhost:8443/contact", expected: null },
  { name: "subdomain of localhost", input: "https://shop.localhost/contact", expected: null },

  // Private and special IPv4
  { name: "0.0.0.0", input: "https://0.0.0.0/", expected: null },
  { name: "0.0.0.0 shorthand", input: "https://0/", expected: null },
  { name: "10/8", input: "https://10.0.0.1/contact", expected: null },
  { name: "127/8", input: "https://127.0.0.1/contact", expected: null },
  { name: "127/8 upper end", input: "https://127.255.255.254/", expected: null },
  { name: "127/8 trailing dot", input: "https://127.0.0.1./contact", expected: null },
  { name: "cloud metadata 169.254.169.254", input: "https://169.254.169.254/latest/meta-data/", expected: null },
  { name: "172.16/12 lower end", input: "https://172.16.0.1/", expected: null },
  { name: "172.16/12 upper end", input: "https://172.31.255.255/", expected: null },
  { name: "192.168/16", input: "https://192.168.1.1/", expected: null },

  // IPv4 written in forms `new URL()` rewrites to dotted decimal
  { name: "loopback as one decimal number", input: "https://2130706433/", expected: null },
  { name: "loopback with a hex first octet", input: "https://0x7f.0.0.1/", expected: null },
  { name: "loopback with omitted octets", input: "https://127.1/", expected: null },
  { name: "loopback as one hex number", input: "https://0x7f000001/", expected: null },
  { name: "loopback as one octal number", input: "https://017700000001/", expected: null },
  { name: "loopback with an octal first octet", input: "https://0177.0.0.1/", expected: null },
  { name: "10/8 with omitted octets", input: "https://10.1/", expected: null },
  { name: "metadata address in hex octets", input: "https://0xa9.0xfe.0xa9.0xfe/", expected: null },
  { name: "192.168.1.1 as one decimal number", input: "https://3232235777/", expected: null },

  // IPv6
  { name: "IPv6 loopback", input: "https://[::1]/contact", expected: null },
  { name: "IPv6 loopback, full form", input: "https://[0:0:0:0:0:0:0:1]/contact", expected: null },
  { name: "IPv6 unspecified", input: "https://[::]/contact", expected: null },
  { name: "IPv6 unique local fc00::/7", input: "https://[fc00::1]/", expected: null },
  { name: "IPv6 unique local fd00::/8", input: "https://[fd12:3456::1]/", expected: null },
  { name: "IPv6 link local", input: "https://[fe80::1]/", expected: null },
  { name: "IPv6 link local upper end", input: "https://[febf::1]/", expected: null },
  { name: "IPv4-mapped loopback, dotted", input: "https://[::ffff:127.0.0.1]/", expected: null },
  { name: "IPv4-mapped loopback, hex", input: "https://[::ffff:7f00:1]/", expected: null },
  { name: "IPv4-mapped 10/8", input: "https://[::ffff:10.0.0.1]/contact", expected: null },
  { name: "IPv4-mapped 192.168/16", input: "https://[::ffff:192.168.0.1]/", expected: null },
  { name: "IPv4-mapped metadata address", input: "https://[::ffff:169.254.169.254]/", expected: null },

  // Special IPv4 ranges (A3-01)
  { name: "CGNAT 100.64/10 lower end", input: "https://100.64.0.0/", expected: null },
  { name: "CGNAT 100.64/10 middle", input: "https://100.100.100.100/", expected: null },
  { name: "CGNAT 100.64/10 upper end", input: "https://100.127.255.255/", expected: null },
  { name: "192.0.0/24 lower end", input: "https://192.0.0.0/", expected: null },
  { name: "192.0.0/24 upper end", input: "https://192.0.0.255/", expected: null },
  { name: "198.18/15 lower end", input: "https://198.18.0.0/", expected: null },
  { name: "198.18/15 upper end", input: "https://198.19.255.255/", expected: null },
  { name: "multicast 224/4 lower end", input: "https://224.0.0.1/", expected: null },
  { name: "multicast 224/4 upper end", input: "https://239.255.255.255/", expected: null },
  { name: "reserved 240/4 lower end", input: "https://240.0.0.1/", expected: null },
  { name: "reserved 240/4 upper end", input: "https://255.255.255.254/", expected: null },
  { name: "broadcast 255.255.255.255", input: "https://255.255.255.255/", expected: null },
  { name: "CGNAT as one decimal number", input: "https://1681915905/", expected: null },

  // IPv6 forms that embed or reserve IPv4 / site-local (A3-01)
  { name: "IPv4-compatible loopback, hex", input: "https://[::7f00:1]/", expected: null },
  { name: "IPv4-compatible loopback, dotted", input: "https://[::127.0.0.1]/", expected: null },
  { name: "IPv4-compatible 10/8", input: "https://[::a00:1]/", expected: null },
  { name: "IPv4-compatible metadata address", input: "https://[::a9fe:a9fe]/", expected: null },
  { name: "IPv4-compatible CGNAT", input: "https://[::6440:1]/", expected: null },
  { name: "NAT64 loopback", input: "https://[64:ff9b::7f00:1]/", expected: null },
  { name: "NAT64 10/8, dotted", input: "https://[64:ff9b::10.0.0.1]/", expected: null },
  { name: "NAT64 metadata address", input: "https://[64:ff9b::a9fe:a9fe]/", expected: null },
  { name: "NAT64 192.168/16", input: "https://[64:ff9b::c0a8:101]/", expected: null },
  { name: "6to4 loopback", input: "https://[2002:7f00:1::]/", expected: null },
  { name: "6to4 10/8", input: "https://[2002:a00:1::1]/", expected: null },
  { name: "6to4 metadata address", input: "https://[2002:a9fe:a9fe::1]/", expected: null },
  { name: "6to4 192.168/16", input: "https://[2002:c0a8:101::1]/", expected: null },
  { name: "site-local fec0::/10 lower end", input: "https://[fec0::1]/", expected: null },
  { name: "site-local fec0::/10 upper end", input: "https://[feff::1]/", expected: null },
];

export const CONTACT_URL_ACCEPTED_CASES: readonly ContactUrlCase[] = [
  { name: "plain https URL", input: "https://example.test/contact", expected: "https://example.test/contact" },
  { name: "query and fragment kept", input: "https://example.test/contact?from=email#help", expected: "https://example.test/contact?from=email#help" },
  { name: "surrounding whitespace trimmed", input: "  https://example.test/help  ", expected: "https://example.test/help" },
  { name: "host lowercased and root path added", input: "https://EXAMPLE.test", expected: "https://example.test/" },
  { name: "custom port", input: "https://example.test:8443/contact", expected: "https://example.test:8443/contact" },
  { name: "localhost only as a label", input: "https://localhost.example.test/", expected: "https://localhost.example.test/" },
  { name: "name that starts with digits", input: "https://127.example.test/", expected: "https://127.example.test/" },
  { name: "public IPv4", input: "https://8.8.8.8/", expected: "https://8.8.8.8/" },
  { name: "just below 172.16/12", input: "https://172.15.255.255/", expected: "https://172.15.255.255/" },
  { name: "just above 172.16/12", input: "https://172.32.0.1/", expected: "https://172.32.0.1/" },
  { name: "next to 192.168/16", input: "https://192.169.0.1/", expected: "https://192.169.0.1/" },
  { name: "next to 169.254/16", input: "https://169.253.0.1/", expected: "https://169.253.0.1/" },
  { name: "next to 127/8", input: "https://128.0.0.1/", expected: "https://128.0.0.1/" },
  { name: "public IPv4 with omitted octets", input: "https://8.8/", expected: "https://8.0.0.8/" },
  { name: "public IPv6", input: "https://[2001:db8::1]/", expected: "https://[2001:db8::1]/" },
  { name: "IPv4-mapped public address", input: "https://[::ffff:8.8.8.8]/", expected: "https://[::ffff:808:808]/" },
  { name: "just below CGNAT 100.64/10", input: "https://100.63.255.255/", expected: "https://100.63.255.255/" },
  { name: "just above CGNAT 100.64/10", input: "https://100.128.0.0/", expected: "https://100.128.0.0/" },
  { name: "just below 192.0.0/24", input: "https://191.255.255.255/", expected: "https://191.255.255.255/" },
  { name: "just above 192.0.0/24", input: "https://192.0.1.0/", expected: "https://192.0.1.0/" },
  { name: "just below 198.18/15", input: "https://198.17.255.255/", expected: "https://198.17.255.255/" },
  { name: "just above 198.18/15", input: "https://198.20.0.0/", expected: "https://198.20.0.0/" },
  { name: "just below multicast 224/4", input: "https://223.255.255.255/", expected: "https://223.255.255.255/" },
  { name: "IPv4-compatible public address", input: "https://[::808:808]/", expected: "https://[::808:808]/" },
  { name: "NAT64 public address", input: "https://[64:ff9b::808:808]/", expected: "https://[64:ff9b::808:808]/" },
  { name: "next to NAT64 prefix", input: "https://[64:ff9b:1::7f00:1]/", expected: "https://[64:ff9b:1::7f00:1]/" },
  { name: "6to4 public address", input: "https://[2002:808:808::1]/", expected: "https://[2002:808:808::1]/" },
  { name: "next to 6to4 prefix", input: "https://[2003:7f00:1::1]/", expected: "https://[2003:7f00:1::1]/" },
  { name: "internationalized name", input: "https://bücher.example/", expected: "https://xn--bcher-kva.example/" },
];

export const CONTACT_URL_CASES: readonly ContactUrlCase[] = [...CONTACT_URL_REFUSED_CASES, ...CONTACT_URL_ACCEPTED_CASES];
