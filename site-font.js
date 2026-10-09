// site-font.js — applies the extension's chosen Font (Appearance settings
// in the popup) to the actual web pages you visit, not just the popup
// itself. Off by default — only runs once the person turns on
// "Also apply this font to websites" in Settings.
//
// v2: a plain `* { font-family: X !important }` stylesheet rule (v1)
// often lost to a site's OWN font-family rule — for two `!important`
// declarations the browser breaks the tie by specificity, and `*` has the
// lowest possible specificity (zero), so almost anything more specific on
// the page beats it, even a plain `body { font-family: ... }`. To
// reliably win, this sets font-family directly as an INLINE !important
// style on every element via the DOM — inline !important outranks any
// external stylesheet rule regardless of that rule's own specificity or
// !important flag. A MutationObserver re-applies it to anything a site
// adds/re-renders afterwards (SPAs, infinite scroll, etc.).
(function () {
  const MARK = "data-arunpro-font";
  const FONTFACE_STYLE_ID = "__arunpro_site_fontface__";

  let observer = null;

  function quoteName(name) {
    return `"${String(name).replace(/"/g, '\\"')}"`;
  }

  // The website font is independent from the extension's own popup font —
  // websiteFontFamily === "" means "no separate choice made, fall back to
  // the same fontFamily the popup uses" (this is also exactly what every
  // extension built before this field existed already has saved, so
  // nothing changes for them). Setting websiteFontFamily to anything else
  // makes websites use that instead, regardless of what the popup itself
  // is set to.
  function resolveFontCSS(s) {
    if (!s || !s.applyFontToWebsites) return null;

    const family = s.websiteFontFamily || s.fontFamily;
    const typedName = s.websiteFontFamily ? s.websiteCustomFontFamilyName : s.customFontFamilyName;

    if (family === "__custom__" && s.customFontDataUrl) {
      return {
        family: "ArunUserSiteFont, sans-serif",
        fontFace: `@font-face { font-family: "ArunUserSiteFont"; src: url(${s.customFontDataUrl}); }`
      };
    }
    if (family === "__typed__" && typedName && typedName.trim()) {
      return { family: `${quoteName(typedName.trim())}, sans-serif`, fontFace: "" };
    }
    if (family && family !== "__typed__" && family !== "__custom__") {
      return { family, fontFace: "" };
    }
    return null;
  }

  function ensureFontFace(fontFaceCSS) {
    let tag = document.getElementById(FONTFACE_STYLE_ID);
    if (fontFaceCSS) {
      if (!tag) {
        tag = document.createElement("style");
        tag.id = FONTFACE_STYLE_ID;
        (document.head || document.documentElement).appendChild(tag);
      }
      tag.textContent = fontFaceCSS;
    } else if (tag) {
      tag.remove();
    }
  }

  function styleOne(el, family) {
    if (!el || el.nodeType !== 1) return;
    if (family) {
      el.style.setProperty("font-family", family, "important");
      el.setAttribute(MARK, "1");
    } else if (el.hasAttribute(MARK)) {
      el.style.removeProperty("font-family");
      el.removeAttribute(MARK);
    }
  }

  function styleTree(root, family) {
    styleOne(root, family);
    if (root.querySelectorAll) {
      root.querySelectorAll("*").forEach((el) => styleOne(el, family));
    }
  }

  function apply(s) {
    const resolved = resolveFontCSS(s);
    ensureFontFace(resolved ? resolved.fontFace : "");

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    const family = resolved ? resolved.family : null;
    if (document.documentElement) styleTree(document.documentElement, family);

    if (family) {
      observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          m.addedNodes.forEach((n) => styleTree(n, family));
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  try {
    chrome.storage.local.get("uiSettings", (r) => apply(r.uiSettings));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.uiSettings) apply(changes.uiSettings.newValue);
    });
  } catch {
    // Extension context can be invalidated (reload/update) while a tab is
    // still open — fail silently rather than throwing on every page.
  }
})();
