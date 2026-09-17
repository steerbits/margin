export function readmeGifReferences(markdown: string) {
  if (/!\[[^\]]*\]\([^)]+\.gif\)/i.test(markdown))
    throw new Error(
      "Retina GIFs need explicit width=480 HTML embeds; Markdown would display them too large.",
    );
  const references = [...markdown.matchAll(/<img\b[^>]*>/gi)].flatMap(
    ([tag]) => {
      const attributes = Object.fromEntries(
        [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      );
      if (!attributes.src?.endsWith(".gif")) return [];
      if (attributes.width !== "480")
        throw new Error(
          `${attributes.src}: preserve the 480px README footprint`,
        );
      if (attributes.height)
        throw new Error(
          `${attributes.src}: omit fixed height so mobile scaling preserves aspect ratio`,
        );
      if (!attributes.alt)
        throw new Error(`${attributes.src}: preserve descriptive alt text`);
      return [{ path: attributes.src, caption: attributes.alt, tag }];
    },
  );
  if (!references.length) throw new Error("README contains no GIF references");
  return references;
}
