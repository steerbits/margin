/* Served at runtime on the isolated preview origin. Never written into an artifact. */
(() => {
  const config = __MARGIN_CONFIG__;
  if (window.parent === window) return;
  let pointing = false;
  let hovered = null;
  let oldOutline = "";
  let annotations = [];
  const route = () => location.pathname + location.search + location.hash;
  const send = (type, data = {}) =>
    parent.postMessage(
      { source: "margin-artifact", channel: config.channel, type, ...data },
      config.parentOrigin,
    );
  const describe = (el) =>
    (
      el.getAttribute("aria-label") ||
      (el.tagName === "IMG" ? el.getAttribute("alt") : "") ||
      el.textContent?.trim() ||
      `<${el.tagName.toLowerCase()}>`
    ).slice(0, 10000);
  function selector(el) {
    const parts = [];
    for (
      let n = el;
      n && n !== document.documentElement && parts.length < 8;
      n = n.parentElement
    ) {
      if (
        n.id &&
        document.querySelectorAll(`#${CSS.escape(n.id)}`).length === 1
      ) {
        parts.unshift(`#${CSS.escape(n.id)}`);
        break;
      }
      const siblings = n.parentElement
        ? [...n.parentElement.children].filter((x) => x.tagName === n.tagName)
        : [n];
      parts.unshift(
        `${n.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(n) + 1})`,
      );
    }
    return parts.join(" > ");
  }
  function nodes() {
    const result = [],
      walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          n.parentElement?.closest(
            "script,style,noscript,[data-margin-overlay]",
          )
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      });
    while (walker.nextNode()) result.push(walker.currentNode);
    return result;
  }
  function clearHover() {
    if (hovered) hovered.style.outline = oldOutline;
    hovered = null;
  }
  function mode(value) {
    pointing = value;
    clearHover();
    document.documentElement.style.cursor = value ? "crosshair" : "";
    send("mode", { pointing });
  }
  function selectElement(el) {
    clearHover();
    send("selected", {
      anchor: {
        kind: "element",
        quote: describe(el),
        prefix: "",
        suffix: "",
        selector: selector(el),
        route: route(),
        documentRevision: config.revision,
      },
    });
  }
  // Installed before application scripts. Suppress activation, including pointer-down handlers.
  for (const type of [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "contextmenu",
    "touchstart",
    "touchend",
  ]) {
    window.addEventListener(
      type,
      (event) => {
        if (!pointing || !(event.target instanceof Element)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (type === "click") selectElement(event.target);
      },
      { capture: true, passive: false },
    );
  }
  window.addEventListener(
    "keydown",
    (event) => {
      if (!pointing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        mode(false);
      } else if (["Enter", " "].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (document.activeElement instanceof Element)
          selectElement(document.activeElement);
      }
    },
    true,
  );
  window.addEventListener(
    "pointermove",
    (event) => {
      if (
        !pointing ||
        !(event.target instanceof HTMLElement) ||
        hovered === event.target
      )
        return;
      clearHover();
      hovered = event.target;
      oldOutline = hovered.style.outline;
      hovered.style.outline = "2px solid #2563eb";
    },
    true,
  );
  function selectedText() {
    if (pointing) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0),
      quote = selection.toString();
    if (!quote.trim() || quote.length > 10000) return;
    const list = nodes(),
      text = list.map((n) => n.textContent).join("");
    let start = 0,
      found = false;
    for (const n of list) {
      if (n === range.startContainer) {
        start += range.startOffset;
        found = true;
        break;
      }
      start += n.textContent.length;
    }
    if (!found) start = text.indexOf(quote);
    const el =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    send("selected", {
      anchor: {
        kind: "text",
        quote,
        prefix: start >= 0 ? text.slice(Math.max(0, start - 80), start) : "",
        suffix:
          start >= 0
            ? text.slice(start + quote.length, start + quote.length + 80)
            : "",
        selector: el ? selector(el) : "",
        route: route(),
        documentRevision: config.revision,
      },
    });
  }
  window.addEventListener("mouseup", () => setTimeout(selectedText, 0));
  window.addEventListener("keyup", (event) => {
    if (event.key === "Shift") selectedText();
  });
  function resolveTarget(anchor) {
    if (anchor.route !== route()) return null;
    if (anchor.kind === "page") return document.body;
    if (anchor.kind === "element") {
      try {
        const els = document.querySelectorAll(anchor.selector);
        return els.length === 1 && describe(els[0]) === anchor.quote
          ? els[0]
          : null;
      } catch {
        return null;
      }
    }
    const list = nodes(),
      text = list.map((n) => n.textContent).join("");
    if (!anchor.quote) return null;
    const matches = [];
    for (
      let i = text.indexOf(anchor.quote);
      i >= 0;
      i = text.indexOf(anchor.quote, i + 1)
    ) {
      if (
        (!anchor.prefix || text.slice(0, i).endsWith(anchor.prefix)) &&
        (!anchor.suffix ||
          text.slice(i + anchor.quote.length).startsWith(anchor.suffix))
      )
        matches.push(i);
      if (matches.length > 1) return null;
    }
    if (matches.length !== 1) return null;
    let offset = 0,
      start = null,
      end = null;
    for (const n of list) {
      if (!start && offset + n.textContent.length > matches[0])
        start = [n, matches[0] - offset];
      if (
        start &&
        offset + n.textContent.length >= matches[0] + anchor.quote.length
      ) {
        end = [n, matches[0] + anchor.quote.length - offset];
        break;
      }
      offset += n.textContent.length;
    }
    if (!start || !end) return null;
    const range = document.createRange();
    range.setStart(...start);
    range.setEnd(...end);
    return range;
  }
  function inspect() {
    const ranges = [],
      status = {};
    for (const comment of annotations) {
      const target = resolveTarget(comment.anchor);
      status[comment.id] =
        comment.anchor.route !== route()
          ? "other-route"
          : target
            ? "found"
            : "changed";
      if (target instanceof Range) ranges.push(target);
    }
    if (CSS.highlights && window.Highlight)
      CSS.highlights.set("margin-artifact-comments", new Highlight(...ranges));
    send("anchors", { status, route: route(), revision: config.revision });
  }
  window.addEventListener("message", (event) => {
    if (
      event.source !== parent ||
      event.origin !== config.parentOrigin ||
      event.data?.channel !== config.channel
    )
      return;
    const data = event.data;
    if (data.type === "mode") mode(!!data.pointing);
    if (data.type === "page-comment")
      send("selected", {
        anchor: {
          kind: "page",
          quote: `Page: ${route()}`,
          prefix: "",
          suffix: "",
          selector: "",
          route: route(),
          documentRevision: config.revision,
        },
      });
    if (data.type === "inspect" && Array.isArray(data.comments)) {
      annotations = data.comments.slice(0, 1000);
      inspect();
    }
    if (data.type === "locate" && data.anchor) {
      const target = resolveTarget(data.anchor);
      if (target instanceof Range) {
        target.startContainer.parentElement?.scrollIntoView({
          block: "center",
        });
        if (CSS.highlights && window.Highlight)
          CSS.highlights.set("margin-artifact-active", new Highlight(target));
      } else if (target instanceof Element) {
        target.scrollIntoView({ block: "center" });
        target.animate(
          [
            { outline: "3px solid #2563eb" },
            { outline: "3px solid transparent" },
          ],
          { duration: 1800 },
        );
      }
      send("located", { found: !!target });
    }
  });
  function ready() {
    const style = document.createElement("style");
    style.textContent =
      "::highlight(margin-artifact-comments){background:#fef0b8} ::highlight(margin-artifact-active){background:#bdd8ff}";
    document.head.appendChild(style);
    send("ready", { route: route(), revision: config.revision });
    inspect();
    // Parent state/drafts survive reloads and DOM changes. Never delete annotations here.
    setInterval(() => {
      send("ready", { route: route(), revision: config.revision });
      inspect();
    }, 1500);
    setInterval(() => {
      fetch("/_margin_preview/ping").catch(() => {});
    }, 30000);
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();
})();
