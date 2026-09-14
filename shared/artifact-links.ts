import { artifactReviewUrl } from "./artifacts.ts";

/** Recognize output links, not arbitrary remote websites or links into Margin itself. */
export function artifactLocationFromLink(
  href: string,
  marginOrigin: string,
): string | undefined {
  try {
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("//") ||
      /[\u0000-\u001f]/.test(href)
    )
      return;
    if (/^https?:/i.test(href)) {
      const url = new URL(href);
      const margin = new URL(marginOrigin);
      if (
        url.protocol !== "http:" ||
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        !url.port ||
        Number(url.port) < 1024 ||
        url.username ||
        url.password
      )
        return;
      if (
        url.port === margin.port &&
        ["localhost", "127.0.0.1"].includes(margin.hostname)
      )
        return;
      return url.href;
    }
    let path = href.split(/[?#]/, 1)[0];
    if (/^file:/i.test(href)) {
      const url = new URL(href);
      if (url.hostname && url.hostname !== "localhost") return;
      path = url.pathname;
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;
    path = decodeURIComponent(path);
    if (
      !/\.(md|markdown|html|htm)$/i.test(path) ||
      /[\u0000-\u001f]/.test(path)
    )
      return;
    return path;
  } catch {
    return;
  }
}
export function artifactOutputLink(
  href: string,
  sessionId: string,
  marginOrigin: string,
): string | undefined {
  const location = artifactLocationFromLink(href, marginOrigin);
  return location
    ? `${artifactReviewUrl(sessionId)}?location=${encodeURIComponent(location)}`
    : undefined;
}
