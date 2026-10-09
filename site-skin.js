// site-skin.js — applies the "Skin" saved in the popup's Skin tab
// (background image, page frame border, element/card borders, text color)
// to the actual site you're on.
//
// Resolution order: a per-site override (siteSkins[domain]) always wins;
// otherwise falls back to the global default (siteSkinDefault), if set.
//
// Same pattern as site-font.js: reads its own storage keys, re-applies on
// live changes via chrome.storage.onChanged, and re-applies to anything a
// site adds afterwards (SPA route changes, infinite scroll) — so a saved
// skin survives navigation within the site without needing a full reload.
(function () {
  const BG_LAYER_ID = "__arunpro_site_bg__";
  const BG_VIDEO_ID = "__arunpro_site_bgvideo__";
  const FRAME_LAYER_ID = "__arunpro_site_frame__";
  const EL_BORDER_STYLE_ID = "__arunpro_site_elborder__";
  const TRANSPARENCY_STYLE_ID = "__arunpro_site_transparency__";
  const PICKED_STYLE_ID = "__arunpro_site_picked__";
  const PICKED_MARK_ATTR = "data-arunpro-pick";
  const GROUP_MARK_ATTR = "data-arunpro-group";
  const COLOR_MARK = "data-arunpro-color";

  // Generic, works-on-any-site fallback for the "Force site background
  // see-through" toggle — walks DOWN from <body> through whichever child
  // covers most of the viewport at each level (a handful of levels,
  // stopping once nothing large enough is left), and only clears the
  // background on THAT chain of outer wrapper panels. Deliberately does
  // NOT touch every div/section/li site-wide — that was the earlier
  // approach and it also wiped out actual content (message bubbles, chat
  // rows, cards), leaving pages looking solid-black with invisible text.
  const FORCE_TRANS_MARK = "data-arunpro-forcetrans";

  function clearForceTransparentChain() {
    document.querySelectorAll(`[${FORCE_TRANS_MARK}]`).forEach((el) => {
      el.style.removeProperty("background-color");
      el.style.removeProperty("background-image");
      el.style.removeProperty("color");
      el.removeAttribute(FORCE_TRANS_MARK);
    });
  }

  function applyForceTransparentChain(opacityPct) {
    clearForceTransparentChain();
    const body = document.body;
    if (!body) return;
    const alpha = Math.min(100, Math.max(0, opacityPct ?? 0)) / 100;

    // "Fixed" vs "variable" content — never touch actual live/media
    // elements themselves (a playing video, a canvas animation, an
    // embedded frame): their own pixels ARE the content, so fading them
    // would break what the person is actually there to watch/use. Plain
    // <img> is included too, since images rarely paint via
    // background-color anyway — nothing meaningful to fade on them.
    // Everything else that paints its OWN solid background — every
    // email row, card, panel, sidebar entry, wherever it sits in the
    // tree — gets faded. This replaces the old "walk down through the
    // single biggest wrapper, 8 levels max" approach: that missed sites
    // like Gmail entirely, because Gmail's actual opacity comes from
    // hundreds of individually-colored row/panel elements, not one
    // wrapper chain — fading only the outer shell left every row still
    // solid white underneath.
    const LIVE_MEDIA_TAGS = new Set(["VIDEO", "CANVAS", "IFRAME", "EMBED", "OBJECT", "IMG"]);

    function walk(el, depth) {
      if (depth > 14 || !el || el.nodeType !== 1) return; // depth cap: safety net, not expected to bite
      if (el.id === BG_LAYER_ID || el.id === FRAME_LAYER_ID || el.id === BG_VIDEO_ID) return;
      if (LIVE_MEDIA_TAGS.has(el.tagName)) return;

      const cs = getComputedStyle(el);
      if (cs.display === "none") return; // nothing visible to fade, and no point walking its subtree
      // Skip rotated/skewed/scaled elements — same reasoning as before:
      // fading a rotated decorative element (an angled ribbon/banner
      // graphic) lets the fixed, NOT-rotated wallpaper layer show through
      // in that element's rotated shape, which reads as a random
      // diagonal streak rather than a clean fade.
      if (cs.transform && cs.transform !== "none") return;

      const bg = cs.backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        const withAlpha = colorWithAlpha(bg, alpha) || "transparent";
        el.style.setProperty("background-color", withAlpha, "important");
        el.style.setProperty("background-image", "none", "important");
        el.setAttribute(FORCE_TRANS_MARK, "1");
      }

      // Font/text also fades with the same slider — the person asked for
      // this explicitly ("sabki opacity, font bhi"). Icons/form controls
      // (NON_TEXT_TAGS) never get a fade color set directly, but CSS
      // `color` still inherits down into them from whichever ancestor DID
      // get faded — an icon using fill:currentColor would silently fade
      // anyway. Explicitly reset those instead of just skipping them.
      if (!NON_TEXT_TAGS.has(el.tagName)) {
        const fg = cs.color;
        const fgWithAlpha = colorWithAlpha(fg, alpha);
        if (fgWithAlpha) {
          el.style.setProperty("color", fgWithAlpha, "important");
          el.setAttribute(FORCE_TRANS_MARK, "1");
        }
      } else {
        el.style.setProperty("color", "initial", "important");
        el.setAttribute(FORCE_TRANS_MARK, "1");
      }

      for (const child of el.children) walk(child, depth + 1);
    }

    walk(body, 0);
  }

  // Sites whose own layout is nearly 100% opaque panels (Gmail, YouTube,
  // WhatsApp Web, ...) need their known top-level containers forced
  // transparent, or a background image behind them has no visible gap to
  // show through at all. Best-effort: these change their internal class
  // names on redesigns, so a selector below can go stale over time.
  const KNOWN_TRANSPARENT_SELECTORS = {
    "mail.google.com": ["body", ".nH", ".aeF", ".ar4", ".no", ".ain"],
    "youtube.com": ["html", "body", "ytd-app", "#content", "#page-manager", "ytd-masthead"],
    "web.whatsapp.com": ["html", "body", "#app"],
    "google.com": ["body", "#main", "#cnt", "#rcnt", "#center_col", "#appbar"],
    "docs.google.com": ["body", ".docs-material"],
    "drive.google.com": ["body", "#drive_main_page"],
    "calendar.google.com": ["body"],
    "onlinedegree.iitm.ac.in": ["body", "#root", "#app", "main"]
  };

  // Kept out of the element-border and text-color rules below: bordering
  // or recoloring these tends to visually clash with a site's own button
  // styling, or makes icons/form controls disappear (their color often
  // comes from currentColor / their own background, not plain text).
  const INTERACTIVE_EXCLUDE =
    ":not(button):not(a):not(input):not(select):not(textarea):not([role='button'])" +
    ":not(:has(> button)):not(:has(> a)):not(:has(> input)):not(:has(> select))";
  const NON_TEXT_TAGS = new Set(["SVG", "PATH", "IMG", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]);
  // Same exclusion list as NON_TEXT_TAGS, as a CSS selector fragment —
  // used for the new per-element / per-group font color rules below.
  const INTERACTIVE_TEXT_EXCLUDE =
    ":not(svg):not(path):not(img):not(button):not(input):not(select):not(textarea)";

  let activeSkin = { hasBg: false, hasFrame: false, forceTransparent: false };
  let colorObserver = null;

  function getDomain() {
    return location.hostname.replace(/^www\./, "");
  }

  function ensureBgLayer() {
    let el = document.getElementById(BG_LAYER_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = BG_LAYER_ID;
      el.style.cssText = [
        "position:fixed", "inset:0", "z-index:-1", "pointer-events:none",
        "background-repeat:no-repeat", "background-position:center",
        "background-size:cover"
      ].join(";");
      (document.body || document.documentElement).prepend(el);
    }
    return el;
  }

  function ensureBgVideoLayer() {
    let el = document.getElementById(BG_VIDEO_ID);
    if (!el) {
      el = document.createElement("video");
      el.id = BG_VIDEO_ID;
      el.autoplay = true;
      el.loop = true;
      el.muted = true;
      el.playsInline = true;
      el.style.cssText = [
        "position:fixed", "inset:0", "width:100%", "height:100%", "z-index:-1", "pointer-events:none"
      ].join(";");
      (document.body || document.documentElement).prepend(el);
    }
    return el;
  }

  function ensureFrameLayer() {
    let el = document.getElementById(FRAME_LAYER_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = FRAME_LAYER_ID;
      el.style.cssText = [
        "position:fixed", "inset:0", "z-index:2147483647", "pointer-events:none",
        "box-sizing:border-box"
      ].join(";");
      (document.body || document.documentElement).appendChild(el);
    }
    return el;
  }

  function ensureStyleTag(id) {
    let tag = document.getElementById(id);
    if (!tag) {
      tag = document.createElement("style");
      tag.id = id;
      (document.head || document.documentElement).appendChild(tag);
    }
    return tag;
  }

  function styleOneColor(el, color) {
    if (!el || el.nodeType !== 1) return;
    if (NON_TEXT_TAGS.has(el.tagName)) {
      // Even though we never set `color` ON an icon/img/button directly,
      // CSS `color` still INHERITS down from whichever ancestor we DID
      // color — an icon using fill:currentColor would silently fade to
      // match anyway. Block that inheritance explicitly instead of
      // just skipping the element outright.
      if (color) {
        el.style.setProperty("color", "initial", "important");
        el.setAttribute(COLOR_MARK, "reset");
      } else if (el.getAttribute(COLOR_MARK) === "reset") {
        el.style.removeProperty("color");
        el.removeAttribute(COLOR_MARK);
      }
      return;
    }
    if (color) {
      el.style.setProperty("color", color, "important");
      el.setAttribute(COLOR_MARK, "1");
    } else if (el.hasAttribute(COLOR_MARK)) {
      el.style.removeProperty("color");
      el.removeAttribute(COLOR_MARK);
    }
  }

  function styleTreeColor(root, color) {
    styleOneColor(root, color);
    if (root.querySelectorAll) {
      root.querySelectorAll("*").forEach((el) => styleOneColor(el, color));
    }
  }

  function apply(siteSkins, defaultSkin) {
    const s = (siteSkins && siteSkins[getDomain()]) || defaultSkin || null;

    // Background video takes priority over image/solid color when set —
    // same fixed full-viewport layer approach, just a <video> instead of
    // a div with background-image (browsers won't animate a video via
    // background-image, it has to be a real <video> element).
    if (s && s.bgVideoDataUrl) {
      const vid = ensureBgVideoLayer();
      if (vid.dataset.src !== s.bgVideoDataUrl) {
        vid.src = s.bgVideoDataUrl;
        vid.dataset.src = s.bgVideoDataUrl;
        vid.play().catch(() => {}); // autoplay can be blocked until a user gesture on some sites
      }
      vid.style.objectFit = s.bgFit === "stretch" ? "fill" : (s.bgFit === "contain" ? "contain" : "cover");
      vid.style.opacity = String(Math.min(100, Math.max(0, s.bgOpacity ?? 70)) / 100);
      const vblur = Math.min(20, Math.max(0, s.bgBlur || 0));
      vid.style.filter = vblur ? `blur(${vblur}px)` : "none";
      vid.style.transform = vblur ? "scale(1.08)" : "scale(1)";
      const staleBg = document.getElementById(BG_LAYER_ID);
      if (staleBg) staleBg.remove();
    } else {
      const staleVid = document.getElementById(BG_VIDEO_ID);
      if (staleVid) staleVid.remove();
    }

    // Background image / solid color + opacity + fit + blur
    if (s && !s.bgVideoDataUrl && (s.bgImageDataUrl || s.bgColorEnabled)) {
      const bg = ensureBgLayer();
      bg.style.backgroundImage = s.bgImageDataUrl ? `url(${s.bgImageDataUrl})` : "none";
      bg.style.backgroundColor = s.bgColorEnabled ? (s.bgColor || "#101018") : "transparent";
      bg.style.backgroundSize = s.bgFit === "stretch" ? "100% 100%" : (s.bgFit === "contain" ? "contain" : "cover");
      bg.style.opacity = String(Math.min(100, Math.max(0, s.bgOpacity ?? 70)) / 100);
      const blur = Math.min(20, Math.max(0, s.bgBlur || 0));
      // Same trick as the popup's own background layer: scale up slightly
      // so blur-softened edges get pushed off-screen instead of leaving a
      // faint transparent halo around the viewport.
      bg.style.filter = blur ? `blur(${blur}px)` : "none";
      bg.style.transform = blur ? "scale(1.08)" : "scale(1)";
    } else {
      const bg = document.getElementById(BG_LAYER_ID);
      if (bg) bg.remove();
    }

    // Force known opaque sites' own top-level panels transparent so the
    // background layer above actually has somewhere to show through —
    // only needed (and only applied) when a background image/color is
    // active. Known-site selectors (curated, safe) are always used when
    // the domain matches. "Force site background see-through" now runs
    // the outer-panel-chain walk above instead of a blanket selector —
    // that blanket version used to also wipe out actual content (chat
    // bubbles, list rows), not just the page's outer canvas.
    const transTag = document.getElementById(TRANSPARENCY_STYLE_ID);
    const hasBgSource = !!(s && (s.bgImageDataUrl || s.bgColorEnabled || s.bgVideoDataUrl));
    const knownSelectors = KNOWN_TRANSPARENT_SELECTORS[getDomain()] || [];
    if (hasBgSource && knownSelectors.length) {
      ensureStyleTag(TRANSPARENCY_STYLE_ID).textContent =
        knownSelectors.map(sel => `${sel} { background-color: transparent !important; background-image: none !important; }`).join("\n");
    } else if (transTag) {
      transTag.remove();
    }
    if (hasBgSource && s.forceTransparentEnabled) {
      applyForceTransparentChain(s.forceTransparentOpacity ?? 0);
    } else {
      clearForceTransparentChain();
    }

    // Full-page frame border — a fixed overlay, not a real border on
    // <html>, so it can't get clipped or shift the page's own layout.
    if (s && s.frameEnabled) {
      const frame = ensureFrameLayer();
      frame.style.border = `${s.frameWidth || 6}px solid ${s.frameColor || "#7c9cff"}`;
    } else {
      const frame = document.getElementById(FRAME_LAYER_ID);
      if (frame) frame.remove();
    }

    // Borders on the page's own boxes/cards/containers. Best-effort and
    // intentionally broad (site DOM structure varies too much to target
    // "cards" precisely) — targets common block-level containers rather
    // than every single element, to avoid bordering every span/text node.
    const borderTag = document.getElementById(EL_BORDER_STYLE_ID);
    if (s && s.elBorderEnabled) {
      const tag = ensureStyleTag(EL_BORDER_STYLE_ID);
      const w = s.elBorderWidth || 1;
      const c = s.elBorderColor || "#7c9cff";
      tag.textContent =
        `div${INTERACTIVE_EXCLUDE}, section${INTERACTIVE_EXCLUDE}, article${INTERACTIVE_EXCLUDE}, ` +
        `aside${INTERACTIVE_EXCLUDE}, header${INTERACTIVE_EXCLUDE}, footer${INTERACTIVE_EXCLUDE}, ` +
        `nav${INTERACTIVE_EXCLUDE}, li${INTERACTIVE_EXCLUDE}, table${INTERACTIVE_EXCLUDE}, ` +
        `form${INTERACTIVE_EXCLUDE}, main${INTERACTIVE_EXCLUDE}, figure${INTERACTIVE_EXCLUDE} ` +
        `{ border: ${w}px solid ${c} !important; box-sizing: border-box !important; }`;
    } else if (borderTag) {
      borderTag.remove();
    }

    // Custom text color — applied as an inline !important style on every
    // element (mirrors site-font.js), since a plain stylesheet rule loses
    // specificity ties against a site's own color rules.
    if (colorObserver) { colorObserver.disconnect(); colorObserver = null; }
    const color = (s && s.textColorEnabled) ? (s.textColor || "#ffffff") : null;
    if (document.documentElement) styleTreeColor(document.documentElement, color);
    if (color) {
      colorObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          m.addedNodes.forEach((n) => styleTreeColor(n, color));
        }
      });
      colorObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    // Individually-picked elements (via the popup's "Pick an element"
    // tool) — each gets its own color/opacity, independent of everything
    // else above. Runs regardless of whether a background image is set,
    // since this is also useful standalone (just dimming one panel).
    // Each matched element gets tagged with a marker attribute; the
    // actual look is driven entirely through one injected stylesheet
    // (rather than inline styles) so an image-kind pick can use a
    // ::before overlay — the only way to fade *just* the image without
    // also fading the element's own text/children.
    // `isolation: isolate; z-index: 0` on the picked element itself (new
    // this session — fixes the "picture/color I put on an element just
    // doesn't show up" bug). A picked element only had `position:
    // relative` before, with no explicit z-index — and per CSS,
    // position:relative WITHOUT a z-index does NOT create a new stacking
    // context. That meant the ::before overlay's `z-index: -1` escaped
    // upward into whatever stacking context the element's ANCESTORS
    // belonged to, instead of staying confined behind just this element
    // — so on real sites it could end up rendering behind the page's own
    // background, i.e. invisible. Adding isolation/z-index here forces
    // the element to own its own stacking context, so its ::before stays
    // trapped directly behind it and nothing else.
    const STACK_FIX = "position: relative !important; isolation: isolate !important; z-index: 0 !important;";

    document.querySelectorAll(`[${PICKED_MARK_ATTR}]`).forEach((el) => el.removeAttribute(PICKED_MARK_ATTR));
    document.querySelectorAll(`[${GROUP_MARK_ATTR}]`).forEach((el) => el.removeAttribute(GROUP_MARK_ATTR));
    const pickedTag = document.getElementById(PICKED_STYLE_ID);
    const rules = [];

    if (s && Array.isArray(s.pickedElements) && s.pickedElements.length) {
      s.pickedElements.forEach((pe, idx) => {
        let els;
        try { els = document.querySelectorAll(pe.selector); } catch { els = []; }
        if (!els.length) return;
        els.forEach((el) => el.setAttribute(PICKED_MARK_ATTR, String(idx)));

        const sel = `[${PICKED_MARK_ATTR}="${idx}"]`;
        if (pe.removed) {
          rules.push(`${sel} { display: none !important; }`);
          return;
        }

        const alpha = Math.min(100, Math.max(0, pe.opacity ?? 100)) / 100;

        if (pe.customImageDataUrl) {
          // The person uploaded their own image for this exact box — this
          // always wins over the site's original image/color.
          // imageSizeMode picks HOW the image scales into this box:
          //   "percent" (default) — background-size: Z% — auto-fits each
          //     box's own dimensions independently (a "same crop %"
          //     look, but not literally the same pixel size everywhere).
          //   "height"/"width" — a literal pixel value shared by every
          //     synced box, so the image is the SAME HEIGHT (or WIDTH)
          //     in every one of them, with the other dimension free —
          //     this is what "same height/length across all sections"
          //     specifically asked for, distinct from just matching %.
          const posX = Math.min(100, Math.max(0, pe.imagePosX ?? 50));
          const posY = Math.min(100, Math.max(0, pe.imagePosY ?? 50));
          const mode = pe.imageSizeMode || "percent";
          let bgSize;
          if (mode === "height") {
            bgSize = `auto ${Math.max(10, pe.imageSizePx ?? 200)}px`;
          } else if (mode === "width") {
            bgSize = `${Math.max(10, pe.imageSizePx ?? 200)}px auto`;
          } else {
            bgSize = `${Math.min(400, Math.max(50, pe.imageZoom ?? 100))}%`;
          }
          rules.push(`${sel} { ${STACK_FIX} background-image: none !important; background-color: transparent !important; }`);
          rules.push(
            `${sel}::before { content: ""; position: absolute; inset: 0; background-image: url(${pe.customImageDataUrl}); ` +
            `background-repeat: no-repeat; background-size: ${bgSize}; background-position: ${posX}% ${posY}%; opacity: ${alpha}; z-index: -1; pointer-events: none; }`
          );
        } else {
          const showImage = pe.kind === "image" && pe.originalImage && !pe.removeImage && !pe.useCustomColor;

          if (showImage) {
            rules.push(`${sel} { ${STACK_FIX} background-image: none !important; background-color: transparent !important; }`);
            rules.push(
              `${sel}::before { content: ""; position: absolute; inset: 0; background-image: ${pe.originalImage}; ` +
              `background-size: cover; background-position: center; opacity: ${alpha}; z-index: -1; pointer-events: none; }`
            );
          } else {
            const finalColor = pe.useCustomColor
              ? hexToRgbString(pe.customColor, alpha)
              : colorWithAlpha(pe.originalColor, alpha);
            if (finalColor) {
              rules.push(`${sel} { background-color: ${finalColor} !important; background-image: none !important; }`);
            }
          }
        }

        // Per-element font/text color (new this session) — didn't exist
        // before; only whole-site text color and per-element background
        // color existed. Separate plain CSS rule, independent of the
        // background handling above. Default to white when textColor is
        // missing entirely — this happens for elements that were picked
        // BEFORE this feature existed, where turning the toggle on alone
        // (with no stored textColor at all) used to silently do nothing.
        if (pe.textColorEnabled) {
          const c = pe.textColor || "#ffffff";
          // ${sel} alone (no exclusion) used to force color onto the
          // picked element ITSELF even when it was, say, a button or icon
          // wrapper. And even with descendants excluded by tag, CSS
          // `color` still INHERITS down into any excluded child anyway
          // (:not() only stops the rule from targeting that child
          // directly — inheritance from its parent's own color happens
          // regardless) — so an icon using fill:currentColor could still
          // silently fade/vanish. Both are covered now: the self-selector
          // gets the same tag exclusion, and icons get an explicit reset.
          rules.push(`${sel}${INTERACTIVE_TEXT_EXCLUDE}, ${sel} *${INTERACTIVE_TEXT_EXCLUDE} { color: ${c} !important; }`);
          rules.push(`${sel} svg, ${sel} img { color: initial !important; }`);
        }
      });
    }

    // Picked GROUPS ("🧩 Auto-pick a group" — new this session): one click
    // on a container auto-grabs its direct child boxes as a group; ONE
    // uploaded image is then laid across all of them like a single
    // picture behind a grid of windows (mosaic), auto-cropped per box —
    // no manual cropping needed. Works via `background-attachment: fixed`
    // on each member's own ::before: every member gets the SAME image,
    // SAME background-size (the group's total footprint in px) and SAME
    // background-position (the group's top-left, in viewport px).
    // Because fixed attachment positions the image relative to the
    // VIEWPORT rather than to each element, every box's ::before
    // automatically reveals exactly the slice of that one image lined up
    // with its own on-screen position — the boxes stay seamlessly
    // aligned with each other even while the page scrolls, no per-box
    // cropping math needed. Trade-off (inherent to this CSS technique,
    // not a bug): the image itself stays glued to the viewport rather
    // than scrolling normally with the page content, so as you scroll,
    // which slice of the picture shows through each box will shift —
    // works best for boxes that are all visible together without much
    // scrolling (e.g. a card grid, a nav strip).
    if (s && Array.isArray(s.pickedGroups) && s.pickedGroups.length) {
      s.pickedGroups.forEach((g, gidx) => {
        const members = [];
        (g.selectors || []).forEach((sel2) => {
          try { const el = document.querySelector(sel2); if (el) members.push(el); } catch {}
        });
        if (!members.length) return;
        members.forEach((el) => el.setAttribute(GROUP_MARK_ATTR, String(gidx)));

        const sel = `[${GROUP_MARK_ATTR}="${gidx}"]`;

        if (g.customImageDataUrl) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          members.forEach((el) => {
            const r = el.getBoundingClientRect();
            minX = Math.min(minX, r.left); minY = Math.min(minY, r.top);
            maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom);
          });
          const W = Math.max(1, Math.round(maxX - minX));
          const H = Math.max(1, Math.round(maxY - minY));
          const alpha = Math.min(100, Math.max(0, g.opacity ?? 100)) / 100;
          rules.push(`${sel} { ${STACK_FIX} background-image: none !important; background-color: transparent !important; }`);
          rules.push(
            `${sel}::before { content: ""; position: absolute; inset: 0; background-image: url(${g.customImageDataUrl}); ` +
            `background-repeat: no-repeat; background-attachment: fixed; background-size: ${W}px ${H}px; ` +
            `background-position: ${Math.round(-minX)}px ${Math.round(-minY)}px; opacity: ${alpha}; z-index: -1; pointer-events: none; }`
          );
        }
        if (g.textColorEnabled) {
          const c = g.textColor || "#ffffff";
          rules.push(`${sel}${INTERACTIVE_TEXT_EXCLUDE}, ${sel} *${INTERACTIVE_TEXT_EXCLUDE} { color: ${c} !important; }`);
          rules.push(`${sel} svg, ${sel} img { color: initial !important; }`);
        }
      });
    }

    if (rules.length) ensureStyleTag(PICKED_STYLE_ID).textContent = rules.join("\n");
    else if (pickedTag) pickedTag.remove();

    activeSkin = {
      hasBg: !!(s && (s.bgImageDataUrl || s.bgColorEnabled || s.bgVideoDataUrl)),
      hasFrame: !!(s && s.frameEnabled),
      forceTransparent: !!(hasBgSource && s.forceTransparentEnabled),
      hasGroups: !!(s && Array.isArray(s.pickedGroups) && s.pickedGroups.length)
    };
  }

  function colorWithAlpha(colorStr, alphaFraction) {
    if (!colorStr) return null;
    const m = colorStr.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(",").map((s) => parseFloat(s));
    const [r, g, b] = parts;
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    // rgb(...) has no 4th component -> fully opaque (1). Critical: an
    // element with NO natural background (very common for a plain text
    // element — a span, a heading) reports its computed background as
    // rgba(0, 0, 0, 0) — transparent black. Ignoring that original alpha
    // and just applying the requested opacity turned "pick a text-only
    // element" into "the whole box goes solid black", because 0-alpha
    // black at 100% opacity became fully opaque black. Multiplying
    // through the ORIGINAL alpha instead means a naturally-transparent
    // element stays transparent no matter what opacity is requested.
    const origAlpha = parts.length > 3 ? parts[3] : 1;
    const finalAlpha = origAlpha * alphaFraction;
    return `rgba(${r}, ${g}, ${b}, ${finalAlpha})`;
  }

  function hexToRgbString(hex, alphaFraction) {
    const m = String(hex).replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return null;
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alphaFraction})`;
  }

  // Builds a short, re-findable-ish CSS selector for a picked element —
  // prefers its id, otherwise a tag+nth-of-type chain up to a few
  // ancestors. Best-effort: on a heavily dynamic SPA that reshuffles its
  // DOM on every load, a picked selector can stop matching after a
  // reload — the person just re-picks it in that case, same as any
  // userstyle/selector-based tool.
  function getStableSelector(el) {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    let node = el;
    for (let i = 0; i < 5 && node && node.nodeType === 1 && node !== document.body; i++) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((sib) => sib.tagName === node.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function getLabel(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `<${tag}> #${el.id}`;
    if (el.classList.length) return `<${tag}> .${el.classList[0]}`;
    return `<${tag}> element`;
  }

  // ---- Element picker (triggered by the popup's "Pick an element"
  // button). The popup itself closes the instant the person clicks the
  // actual page (standard Chrome behavior for extension popups), so the
  // whole pick-and-save flow has to live entirely in this content script
  // — it saves straight to storage, then the person reopens the popup to
  // see it in the list and tune its opacity. ----
  let pickerActive = false;
  let pickerOverlay = null;
  let pickerBanner = null;
  let pickerMode = "style"; // "style" (recolor/fade), "remove" (hide completely),
                             // or "group" (auto-pick a container's direct children as one group)

  function stopPicker() {
    pickerActive = false;
    document.removeEventListener("mousemove", onPickerMouseMove, true);
    document.removeEventListener("click", onPickerClick, true);
    document.removeEventListener("keydown", onPickerKeyDown, true);
    if (pickerOverlay) { pickerOverlay.remove(); pickerOverlay = null; }
    if (pickerBanner) { pickerBanner.remove(); pickerBanner = null; }
  }

  function onPickerMouseMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === pickerOverlay || el === pickerBanner || pickerBanner?.contains(el)) return;
    const r = el.getBoundingClientRect();
    const color = pickerMode === "remove" ? "220,70,70" : pickerMode === "group" ? "80,200,150" : "124,156,255";
    pickerOverlay.style.cssText = [
      "position:fixed", `top:${r.top}px`, `left:${r.left}px`, `width:${r.width}px`, `height:${r.height}px`,
      `background:rgba(${color},0.25)`, `outline:2px solid rgb(${color})`, "z-index:2147483647",
      "pointer-events:none", "box-sizing:border-box"
    ].join(";");
  }

  async function onPickerClick(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === pickerOverlay || el === pickerBanner || pickerBanner?.contains(el)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    let entry, storageField;
    if (pickerMode === "remove") {
      entry = { selector: getStableSelector(el), label: getLabel(el), removed: true };
      storageField = "pickedElements";
    } else if (pickerMode === "group") {
      // Auto-pick a group: the clicked element's DIRECT children (only —
      // not a deep walk, to keep this predictable and avoid grouping
      // hundreds of nested nodes) become one group, keyed off the
      // parent's selector + each child's position among its siblings, so
      // re-resolving later doesn't depend on the children individually
      // having stable ids/classes.
      const parentSel = getStableSelector(el);
      const allKids = Array.from(el.children);
      const selectors = [];
      allKids.forEach((c, i) => {
        const r = c.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) selectors.push(`${parentSel} > :nth-child(${i + 1})`);
      });
      if (!selectors.length) { stopPicker(); return; } // nothing groupable in this container
      entry = {
        label: `Group — ${getLabel(el)} (${selectors.length} boxes)`,
        selectors,
        customImageDataUrl: "",
        opacity: 100,
        textColorEnabled: false,
        textColor: "#ffffff"
      };
      storageField = "pickedGroups";
    } else {
      const cs = getComputedStyle(el);
      const bgImg = cs.backgroundImage;
      const hasImage = !!(bgImg && bgImg !== "none");
      entry = {
        selector: getStableSelector(el),
        label: getLabel(el),
        kind: hasImage ? "image" : "color",
        originalColor: cs.backgroundColor,
        originalImage: hasImage ? bgImg : "",
        useCustomColor: false,
        customColor: "#7c9cff",
        removeImage: false,
        removed: false,
        customImageDataUrl: "",
        imageZoom: 100,
        imagePosX: 50,
        imagePosY: 50,
        imageSizeMode: "percent",
        imageSizePx: 200,
        imageSyncEnabled: false,
        opacity: 100,
        textColorEnabled: false,
        textColor: "#ffffff"
      };
      storageField = "pickedElements";
    }
    stopPicker();

    try {
      const r = await new Promise((resolve) => chrome.storage.local.get("siteSkins", resolve));
      const skins = r.siteSkins || {};
      const domain = getDomain();
      const s = skins[domain] || {};
      s[storageField] = Array.isArray(s[storageField]) ? s[storageField] : [];
      s[storageField].push(entry);
      skins[domain] = s;
      await new Promise((resolve) => chrome.storage.local.set({ siteSkins: skins }, resolve));
    } catch {
      // Extension context invalidated mid-pick — nothing to do but drop it.
    }
  }

  function onPickerKeyDown(e) {
    if (e.key === "Escape") stopPicker();
  }

  function startPicker(mode) {
    if (pickerActive) return;
    pickerActive = true;
    pickerMode = (mode === "remove" || mode === "group") ? mode : "style";
    pickerOverlay = document.createElement("div");
    pickerOverlay.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;";
    document.body.appendChild(pickerOverlay);

    pickerBanner = document.createElement("div");
    pickerBanner.textContent = pickerMode === "remove"
      ? "🗑️ ARUN PRO — click an element to remove it (Esc to cancel)"
      : pickerMode === "group"
      ? "🧩 ARUN PRO — click a CONTAINER to group its boxes (Esc to cancel)"
      : "🎯 ARUN PRO — click an element to add it (Esc to cancel)";
    pickerBanner.style.cssText = [
      "position:fixed", "top:12px", "left:50%", "transform:translateX(-50%)",
      `background:${pickerMode === "remove" ? "#3a1414" : pickerMode === "group" ? "#123a2e" : "#1a1a2e"}`, "color:#fff", "padding:8px 16px", "border-radius:8px",
      "font:600 13px system-ui,sans-serif", "z-index:2147483647", "box-shadow:0 4px 16px rgba(0,0,0,0.4)",
      "pointer-events:none"
    ].join(";");
    document.body.appendChild(pickerBanner);

    document.addEventListener("mousemove", onPickerMouseMove, true);
    document.addEventListener("click", onPickerClick, true);
    document.addEventListener("keydown", onPickerKeyDown, true);
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "ARUNPRO_START_PICKER") startPicker(msg.mode);
    });
  } catch {
    // Extension context can be invalidated while a tab is still open.
  }

  function loadAndApply() {
    try {
      chrome.storage.local.get(["siteSkins", "siteSkinDefault"], (r) => apply(r.siteSkins, r.siteSkinDefault));
    } catch {
      // Extension context can be invalidated (reload/update) while a tab
      // is still open — fail silently rather than throwing repeatedly.
    }
  }

  try {
    loadAndApply();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && (changes.siteSkins || changes.siteSkinDefault)) loadAndApply();
    });

    // Re-apply if a site's own SPA re-render wipes out our layers (common
    // on heavy single-page apps that replace document.body wholesale), or
    // re-walk the "force transparent" chain when new large panels appear
    // (e.g. WhatsApp's chat pane finishing its own async load). Debounced
    // since childList mutations on <html> can fire a lot; only does
    // anything when a background/frame/force-transparent is active.
    let reapplyTimer = null;
    const reapplyObserver = new MutationObserver(() => {
      if (!activeSkin.hasBg && !activeSkin.hasFrame && !activeSkin.forceTransparent) return;
      if (reapplyTimer) return;
      reapplyTimer = setTimeout(() => {
        reapplyTimer = null;
        const bgGone = activeSkin.hasBg && !document.getElementById(BG_LAYER_ID) && !document.getElementById(BG_VIDEO_ID);
        const frameGone = activeSkin.hasFrame && !document.getElementById(FRAME_LAYER_ID);
        if (bgGone || frameGone || activeSkin.forceTransparent) loadAndApply();
      }, 400);
    });
    if (document.documentElement) {
      reapplyObserver.observe(document.documentElement, { childList: true });
    }

    // Group mosaics compute their bounding box (and thus each member's
    // background-size/-position) from getBoundingClientRect() at apply
    // time — a window resize changes those rects, so re-run then.
    // (A page scroll does NOT need this: background-attachment:fixed
    // keeps the mosaic aligned across scroll on its own, by design.)
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      if (!activeSkin.hasGroups) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(loadAndApply, 200);
    });
  } catch {
    // Same rationale as above.
  }
})();
