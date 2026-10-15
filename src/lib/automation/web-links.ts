import type { DiscoveredWebLink } from "./work-types";
// Discovered URLs are opened by the user; the server never fetches them.
export function publicWebUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash ||
      !u.hostname.includes(".") || /(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname) ||
      /^(\d+\.){3}\d+$/.test(u.hostname) || u.hostname.includes(":") ||
      /(^|\.)(github\.com|githubusercontent\.com|npmjs\.com|example\.(com|org|net))$/.test(u.hostname)) return null;
    return u.href;
  } catch { return null; }
}
export function parseWebLinks(raw: unknown, repository: string, stamp: string): DiscoveredWebLink[] {
  if (!Array.isArray(raw) || raw.length > 12) throw new Error("웹 주소 발견 결과를 확인해주세요.");
  const links: DiscoveredWebLink[] = [];
  for (const link of raw) {
    if (!link || typeof link !== "object" || !publicWebUrl(link.url) ||
      !["homepage", "deployment", "pages", "readme"].includes(link.kind) || typeof link.environment !== "string" || link.environment.length > 100 ||
      typeof link.sourceUrl !== "string" || link.observedAt !== undefined && (typeof link.observedAt !== "string" || !Number.isFinite(Date.parse(link.observedAt)))) throw new Error("웹 주소 출처가 올바르지 않습니다.");
    const source = new URL(link.sourceUrl);
    if (source.origin !== "https://github.com" || source.username || source.password || source.search || source.hash ||
      source.pathname.toLowerCase() !== `/${repository}` && !source.pathname.toLowerCase().startsWith(`/${repository}/`)) throw new Error("다른 저장소의 웹 주소입니다.");
    if (!links.some(l => l.url === publicWebUrl(link.url))) links.push({ url: publicWebUrl(link.url)!, kind: link.kind, environment: link.environment, sourceUrl: source.href, observedAt: stamp });
  }
  return links;
}
