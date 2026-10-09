// ===== CODER IITM — popup.js v3.0 =====
// Classic Premium | 100% Accurate Live Tracking | Day-wise Line Graph

// ---- Tab Navigation ----
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

// =============================================
// UNDO TOAST — shared by task/habit/note deletes. Purely a UI convenience
// on top of a delete that already happened; it never blocks the delete
// itself, it just offers ~5s to reverse it before the button disappears.
// =============================================
let undoToastTimer = null;
let undoToastAction = null;

function showUndoToast(message, undoFn) {
  const toast = document.getElementById("undoToast");
  const msgEl = document.getElementById("undoToastMsg");
  if (!toast || !msgEl) return;
  clearTimeout(undoToastTimer);
  msgEl.textContent = message;
  undoToastAction = undoFn;
  document.getElementById("undoToastBtn").style.display = undoFn ? "" : "none"; // plain notice when there's nothing to undo
  toast.style.display = "flex";
  requestAnimationFrame(() => toast.classList.add("show"));
  undoToastTimer = setTimeout(hideUndoToast, 5000);
}

function hideUndoToast() {
  const toast = document.getElementById("undoToast");
  if (!toast) return;
  toast.classList.remove("show");
  clearTimeout(undoToastTimer);
  setTimeout(() => { if (!toast.classList.contains("show")) toast.style.display = "none"; }, 200);
  undoToastAction = null;
}

document.getElementById("undoToastBtn").addEventListener("click", async () => {
  const fn = undoToastAction;
  hideUndoToast();
  if (fn) await fn();
});

// =============================================
// HELPERS
// =============================================

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getDateKey(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtSec(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return s + "s";
  if (s < 3600) {
    const m = Math.floor(s/60), r = s%60;
    return r > 0 ? `${m}m ${r}s` : `${m}m`;
  }
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), r = s%60;
  return r > 0 ? `${h}h ${m}m ${r}s` : `${h}h ${m}m`;
}

function fmtShort(s) {
  s = Math.max(0, Math.round(s));
  if (s === 0) return "0s";
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s/60) + "m";
  return Math.floor(s/3600) + "h" + (Math.floor((s%3600)/60) > 0 ? Math.floor((s%3600)/60)+"m" : "");
}

function cssVar(name, el) {
  return getComputedStyle(el || document.documentElement).getPropertyValue(name).trim();
}

// Canvas graphs draw their own text with ctx.fillText/ctx.font, which is NOT
// CSS — it never inherits variables the way DOM elements do. Every graph
// used to always read colors/fonts from :root only, so a per-section
// override (Appearance → per-section font & color) never touched the
// Track/Pomo/Habits graphs even though it correctly changed every other
// label in that tab. This resolves colors/font against the tab's own
// <section id="tab-key"> element first (where the override actually lives)
// and falls back to :root when there's no override, exactly matching how
// normal DOM text already behaves.
function graphTheme(canvasEl) {
  const scopeEl = (canvasEl && canvasEl.closest(".tab-content")) || document.documentElement;
  return {
    font: cssVar("--font-mono", scopeEl) || "'JetBrains Mono', monospace",
    text: (n) => cssVar(n, scopeEl)
  };
}

// Fixes blurry canvas rendering on HiDPI/Retina screens by scaling the
// backing pixel buffer to devicePixelRatio while keeping CSS size fixed.
function prepCanvasDPR(canvas, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  const needW = Math.round(cssW * dpr), needH = Math.round(cssH * dpr);
  if (canvas.width !== needW || canvas.height !== needH) {
    canvas.width = needW;
    canvas.height = needH;
  }
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// =============================================
// APPEARANCE SETTINGS (font, colors, background image + blur)
// =============================================

const DEFAULT_UI_SETTINGS = {
  fontFamily: "",      // "" = default (--font from theme)
  customFontDataUrl: "",
  customFontName: "",
  customFontFamilyName: "", // typed-in font name (fontFamily === "__typed__"), e.g. "Poppins"
  accentColor: "",     // "" = default (--gold from theme)
  textColor: "",
  bgColor: "",
  bgImageDataUrl: "",
  bgVideoDataUrl: "",
  bgMediaType: "image", // "image" (covers photo + GIF) | "video"
  bgVideoMuted: true,   // whether the background video plays with sound
  bgBlur: 6,
  bgFit: "cover",       // cover | contain | stretch — how the image fills the popup
  panelBlur: 18,        // px — glassmorphism frosted-panel blur strength
  panelAlpha: 0.55,     // 0-1 — panel opacity (lower = background shows through more)
  borderStrength: 25,   // 0-100 — how visible panel edges are against a busy image
  borderColor: "#ffffff", // panel edge color (strength above controls its alpha)
  areaFonts: {},         // per-tab font override, e.g. { pomo: "Georgia, serif" } — "" / missing = inherit the global Font above
  areaTextColors: {},    // per-tab text-color override, e.g. { notes: "#ffcc00" } — "" / missing = inherit the global Text color above
  applyFontToWebsites: false, // when true, site-font.js pushes a font onto every page you browse, not just the popup
  websiteFontFamily: "",             // independent from fontFamily above — "" = fall back to fontFamily (old behavior, same font both places)
  websiteCustomFontFamilyName: "",   // typed name for websiteFontFamily === "__typed__"
  uiStyle: "glass"       // one of the 15 STYLE_PRESETS keys below (glass/solid/terminal/amber/neumorphic/neon/cyberpunk/monochrome/sunset/ocean/forest/royal/midnight/pastel/paper)
};

// Genuinely different visual styles, not just blur/opacity numbers —
// each one (other than Glass, the original) also repaints colors/font/
// shape via the `vars` map below, so switching is unmistakable at a
// glance. panelBlur/panelAlpha/borderStrength still feed the existing
// sliders so they stay fine-tunable after picking a style; radius/radius2
// and `vars` are style-only (no slider) and get applied/cleared whole.
//
// `vars` may set ANY of STYLE_VARS below — applyUISettings() sets exactly
// those and clears every other STYLE_VARS entry back to its normal
// light/dark theme value, so switching styles never leaves a stale
// override behind. --border-color-rgb is handled separately (see
// applyUISettings) since it's also driven by the user's own Border Color
// picker and must not be blown away by styles that don't care about it.
const STYLE_VARS = [
  "--glass-highlight", "--glass-shadow", "--shadow", "--shadow2",
  "--font", "--font-mono",
  "--gold", "--gold2", "--gold3", "--gold-rgb", "--gold-dim",
  "--bg2", "--bg3", "--bg4", "--bg5",
  "--text", "--text2", "--text3"
];

const STYLE_PRESETS = {
  // The original frosted glassmorphism look — no overrides, rides the
  // normal light/dark theme values for everything.
  glass: { panelBlur: 18, panelAlpha: 0.55, borderStrength: 25, radius: 14, radius2: 20, vars: {} },

  // Flat, opaque "material-ish" cards — solid backgrounds, no blur, a
  // real drop shadow for depth instead of a frosted edge.
  solid: {
    panelBlur: 0, panelAlpha: 0.97, borderStrength: 55, radius: 10, radius2: 14,
    vars: {
      "--glass-highlight": "inset 0 1px 0 rgba(255,255,255,0.05)",
      "--glass-shadow": "0 4px 18px rgba(0,0,0,0.4)",
      "--shadow": "0 3px 14px rgba(0,0,0,0.35)",
      "--shadow2": "0 6px 28px rgba(0,0,0,0.45)"
    }
  },

  // Retro CRT terminal — monospace everything, sharp corners, near-black
  // panels, phosphor-green text/accent instead of the usual blue-violet.
  terminal: {
    panelBlur: 0, panelAlpha: 1, borderStrength: 60, radius: 0, radius2: 0,
    borderColorRgb: "57,255,20",
    vars: {
      "--glass-highlight": "0 0 0 transparent",
      "--glass-shadow": "0 0 0 transparent",
      "--shadow": "none",
      "--shadow2": "none",
      "--font": "'JetBrains Mono', monospace",
      "--font-mono": "'JetBrains Mono', monospace",
      "--gold": "#39ff14",
      "--gold2": "#7dff6b",
      "--gold3": "#1fae0a",
      "--gold-rgb": "57,255,20",
      "--gold-dim": "rgba(57,255,20,0.12)",
      "--bg2": "rgba(4,10,4,0.97)",
      "--bg3": "rgba(8,16,8,0.97)",
      "--bg4": "rgba(12,22,12,0.97)",
      "--bg5": "rgba(18,30,18,0.97)",
      "--text": "#8fff8f",
      "--text2": "rgba(143,255,143,0.75)",
      "--text3": "rgba(143,255,143,0.5)"
    }
  },

  // Soft UI / neumorphism — panels melt into the background, depth comes
  // from a light+dark dual shadow instead of any visible border.
  neumorphic: {
    panelBlur: 0, panelAlpha: 0.9, borderStrength: 0, radius: 24, radius2: 30,
    vars: {
      "--glass-highlight": "-6px -6px 14px rgba(255,255,255,0.05)",
      "--glass-shadow": "6px 6px 16px rgba(0,0,0,0.5)",
      "--shadow": "4px 4px 10px rgba(0,0,0,0.3)",
      "--shadow2": "8px 8px 20px rgba(0,0,0,0.4)"
    }
  },

  // Classic amber CRT — same idea as Terminal, different phosphor color.
  amber: {
    panelBlur: 0, panelAlpha: 1, borderStrength: 60, radius: 0, radius2: 0,
    borderColorRgb: "255,176,0",
    vars: {
      "--glass-highlight": "0 0 0 transparent", "--glass-shadow": "0 0 0 transparent",
      "--shadow": "none", "--shadow2": "none",
      "--font": "'JetBrains Mono', monospace", "--font-mono": "'JetBrains Mono', monospace",
      "--gold": "#ffb000", "--gold2": "#ffc94d", "--gold3": "#cc8c00",
      "--gold-rgb": "255,176,0", "--gold-dim": "rgba(255,176,0,0.12)",
      "--bg2": "rgba(10,6,0,0.97)", "--bg3": "rgba(16,10,0,0.97)", "--bg4": "rgba(22,14,0,0.97)", "--bg5": "rgba(28,18,0,0.97)",
      "--text": "#ffcc66", "--text2": "rgba(255,204,102,0.75)", "--text3": "rgba(255,204,102,0.5)"
    }
  },

  // Bright glowing accent, big blur+radius — the "vibrant" option.
  neon: {
    panelBlur: 24, panelAlpha: 0.4, borderStrength: 75, radius: 20, radius2: 28,
    vars: {
      "--gold": "#a78bfa", "--gold2": "#c4b5fd", "--gold3": "#7c3aed",
      "--gold-rgb": "167,139,250", "--gold-dim": "rgba(167,139,250,0.15)",
      "--shadow": "0 0 20px rgba(167,139,250,0.45)", "--shadow2": "0 0 40px rgba(167,139,250,0.6)",
      "--glass-highlight": "inset 0 1px 0 rgba(167,139,250,0.35)", "--glass-shadow": "0 0 26px rgba(167,139,250,0.5)"
    }
  },

  // Magenta + cyan on near-black, sharp corners — the loud, maximalist option.
  cyberpunk: {
    panelBlur: 4, panelAlpha: 0.92, borderStrength: 80, radius: 2, radius2: 4,
    borderColorRgb: "255,44,223",
    vars: {
      "--font": "'JetBrains Mono', monospace", "--font-mono": "'JetBrains Mono', monospace",
      "--gold": "#ff2cdf", "--gold2": "#ff7bf0", "--gold3": "#b300a0",
      "--gold-rgb": "255,44,223", "--gold-dim": "rgba(255,44,223,0.15)",
      "--bg2": "rgba(5,2,10,0.95)", "--bg3": "rgba(10,4,16,0.95)", "--bg4": "rgba(14,6,20,0.95)", "--bg5": "rgba(18,8,26,0.95)",
      "--text": "#4dfff5", "--text2": "rgba(77,255,245,0.75)", "--text3": "rgba(77,255,245,0.5)",
      "--shadow": "0 0 14px rgba(255,44,223,0.4)", "--shadow2": "0 0 28px rgba(255,44,223,0.5)",
      "--glass-highlight": "inset 0 1px 0 rgba(77,255,245,0.25)", "--glass-shadow": "0 0 18px rgba(255,44,223,0.4)"
    }
  },

  // Pure grayscale — no color accent at all.
  monochrome: {
    panelBlur: 0, panelAlpha: 0.95, borderStrength: 40, radius: 8, radius2: 10,
    borderColorRgb: "200,200,200",
    vars: {
      "--gold": "#e8e8e8", "--gold2": "#ffffff", "--gold3": "#b0b0b0",
      "--gold-rgb": "232,232,232", "--gold-dim": "rgba(232,232,232,0.12)",
      "--bg2": "rgba(18,18,18,0.97)", "--bg3": "rgba(24,24,24,0.97)", "--bg4": "rgba(30,30,30,0.97)", "--bg5": "rgba(36,36,36,0.97)",
      "--text": "#f0f0f0", "--text2": "rgba(240,240,240,0.7)", "--text3": "rgba(240,240,240,0.45)",
      "--shadow": "0 2px 10px rgba(0,0,0,0.5)", "--shadow2": "0 4px 20px rgba(0,0,0,0.6)",
      "--glass-highlight": "inset 0 1px 0 rgba(255,255,255,0.08)", "--glass-shadow": "0 2px 10px rgba(0,0,0,0.5)"
    }
  },

  // Warm orange/coral accent, soft glow — easygoing, sunset-y.
  sunset: {
    panelBlur: 12, panelAlpha: 0.6, borderStrength: 35, radius: 16, radius2: 22,
    vars: {
      "--gold": "#ff9966", "--gold2": "#ffb088", "--gold3": "#e8734a",
      "--gold-rgb": "255,153,102", "--gold-dim": "rgba(255,153,102,0.14)",
      "--shadow": "0 4px 20px rgba(255,153,102,0.25)", "--shadow2": "0 8px 32px rgba(255,100,130,0.3)",
      "--glass-highlight": "inset 0 1px 0 rgba(255,200,150,0.15)", "--glass-shadow": "0 6px 24px rgba(255,100,130,0.25)"
    }
  },

  // Cool teal/blue accent — calm, clean.
  ocean: {
    panelBlur: 14, panelAlpha: 0.55, borderStrength: 30, radius: 14, radius2: 20,
    vars: {
      "--gold": "#38bdf8", "--gold2": "#7dd3fc", "--gold3": "#0284c7",
      "--gold-rgb": "56,189,248", "--gold-dim": "rgba(56,189,248,0.14)"
    }
  },

  // Earthy green accent.
  forest: {
    panelBlur: 8, panelAlpha: 0.7, borderStrength: 35, radius: 12, radius2: 16,
    vars: {
      "--gold": "#6fae5e", "--gold2": "#8fc47d", "--gold3": "#4a7a3d",
      "--gold-rgb": "111,174,94", "--gold-dim": "rgba(111,174,94,0.14)"
    }
  },

  // Gold accent on a deep purple panel tint — a bit of luxury.
  royal: {
    panelBlur: 16, panelAlpha: 0.55, borderStrength: 45, radius: 10, radius2: 14,
    vars: {
      "--gold": "#d4af37", "--gold2": "#f0d878", "--gold3": "#a8842a",
      "--gold-rgb": "212,175,55", "--gold-dim": "rgba(212,175,55,0.15)",
      "--bg2": "rgba(28,14,38,0.55)", "--bg3": "rgba(24,12,34,0.5)", "--bg4": "rgba(32,16,42,0.58)", "--bg5": "rgba(38,20,50,0.65)",
      "--shadow": "0 4px 18px rgba(212,175,55,0.2)", "--shadow2": "0 8px 30px rgba(130,60,200,0.25)",
      "--glass-highlight": "inset 0 1px 0 rgba(212,175,55,0.2)", "--glass-shadow": "0 6px 24px rgba(90,40,150,0.3)"
    }
  },

  // Deep indigo, low-key — a darker, quieter variant of Glass.
  midnight: {
    panelBlur: 18, panelAlpha: 0.5, borderStrength: 20, radius: 14, radius2: 20,
    vars: {
      "--gold": "#6366f1", "--gold2": "#818cf8", "--gold3": "#4338ca",
      "--gold-rgb": "99,102,241", "--gold-dim": "rgba(99,102,241,0.14)",
      "--bg2": "rgba(10,10,24,0.55)", "--bg3": "rgba(8,8,20,0.5)", "--bg4": "rgba(12,12,28,0.58)", "--bg5": "rgba(16,16,34,0.65)"
    }
  },

  // Soft lavender, airy and light — rounded, gentle shadows.
  pastel: {
    panelBlur: 10, panelAlpha: 0.75, borderStrength: 20, radius: 20, radius2: 26,
    vars: {
      "--gold": "#b9a6f0", "--gold2": "#d6c9f7", "--gold3": "#8f73d9",
      "--gold-rgb": "185,166,240", "--gold-dim": "rgba(185,166,240,0.12)",
      "--shadow": "0 4px 16px rgba(185,166,240,0.18)", "--shadow2": "0 6px 24px rgba(185,166,240,0.22)",
      "--glass-highlight": "inset 0 1px 0 rgba(255,255,255,0.12)", "--glass-shadow": "0 4px 16px rgba(185,166,240,0.2)"
    }
  },

  // Cream/off-white card look with a serif font — reads like an actual page.
  paper: {
    panelBlur: 0, panelAlpha: 1, borderStrength: 15, radius: 6, radius2: 8,
    borderColorRgb: "0,0,0",
    vars: {
      "--font": "Georgia, 'Times New Roman', serif",
      "--bg2": "rgba(250,247,240,0.98)", "--bg3": "rgba(245,241,232,0.98)", "--bg4": "rgba(240,235,224,0.98)", "--bg5": "rgba(235,228,214,0.98)",
      "--text": "#2b2620", "--text2": "rgba(43,38,32,0.7)", "--text3": "rgba(43,38,32,0.45)",
      "--gold": "#8a6d3b", "--gold2": "#a98a52", "--gold3": "#6b5329",
      "--gold-rgb": "138,109,59", "--gold-dim": "rgba(138,109,59,0.12)",
      "--shadow": "0 1px 4px rgba(0,0,0,0.15)", "--shadow2": "0 2px 8px rgba(0,0,0,0.2)",
      "--glass-highlight": "inset 0 1px 0 rgba(255,255,255,0.5)", "--glass-shadow": "0 1px 4px rgba(0,0,0,0.15)"
    }
  }
};

// The 7 tabs a person can give their own distinct font/color to.
// key must match the "tab-<key>" section id and the tab-btn's data-tab.
const UI_AREAS = [
  { key: "track",  label: "Track"  },
  { key: "block",  label: "Block"  },
  { key: "speed",  label: "Speed"  },
  { key: "pomo",   label: "Pomo"   },
  { key: "notes",  label: "Notes"  },
  { key: "tasks",  label: "Tasks"  },
  { key: "habits", label: "Habits" }
];

// Same preset list as the global font picker, kept in one place so the
// per-area dropdowns always match it exactly.
const FONT_PRESETS = [
  { value: "", label: "Default (global)" },
  { value: "'JetBrains Mono', monospace", label: "JetBrains Mono" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "Verdana, sans-serif", label: "Verdana" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "'Comic Sans MS', cursive", label: "Comic Sans MS" }
];

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return null;
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

// Wraps a person-typed font name in quotes for use in a CSS font-family
// value, escaping any stray quotes in what they typed so it can't break out
// of the declaration.
function quoteFontName(name) {
  return `"${String(name).replace(/"/g, '\\"')}"`;
}

// Larger max dimension than note photos since this covers the whole popup —
// still compressed so it can't blow past storage limits.
// GIFs are the one exception: running them through <canvas> would flatten
// them to a single still JPEG frame and kill the animation, so a GIF is
// stored as-is (just with a size guard) instead of being re-encoded.
const MAX_BG_IMAGE_BYTES = 8 * 1024 * 1024;   // 8MB — generous now that unlimitedStorage is on
const MAX_BG_VIDEO_BYTES = 25 * 1024 * 1024;  // 25MB — keep clips short; this is a popup, not a media player

function fileToBgDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (file.type === "image/gif") {
      if (file.size > MAX_BG_IMAGE_BYTES) {
        reject(new Error(`GIF is too big (${(file.size / 1024 / 1024).toFixed(1)}MB). Keep it under ${MAX_BG_IMAGE_BYTES / 1024 / 1024}MB so it stays animated.`));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(reader.result); // raw dataURL — keeps every frame
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("bad image"));
      img.onload = () => {
        const MAX = 1600;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const scale = MAX / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Video backgrounds can't be safely re-encoded/resized in a popup script, so
// this just validates size/type and reads the file straight to a dataURL.
function fileToBgVideoDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("video/")) {
      reject(new Error("That doesn't look like a video file."));
      return;
    }
    if (file.size > MAX_BG_VIDEO_BYTES) {
      reject(new Error(`Video is too big (${(file.size / 1024 / 1024).toFixed(1)}MB). Keep clips under ${MAX_BG_VIDEO_BYTES / 1024 / 1024}MB — short, looping clips work best as a background.`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

let customFontFace = null;

async function applyUISettings(s) {
  const root = document.documentElement;

  // Font — applied to BOTH --font and --font-mono. The two used to be
  // independent: --font covered a handful of elements, while --font-mono
  // (used by 40+ selectors — timers, list items, labels, the mono-styled
  // numbers) stayed hardcoded to JetBrains Mono no matter what the person
  // picked. That's why only "some particular" text used to change instead
  // of everything. Now one font choice updates the whole UI.
  // Load the uploaded font's FontFace whenever one exists — NOT only when
  // the global picker is set to it. A section can point at "📁 Uploaded
  // font" on its own while the global Font stays on something else, and
  // that per-section choice needs customFontFace loaded to work too.
  if (s.customFontDataUrl && !customFontFace) {
    try {
      customFontFace = new FontFace("ArunUserFont", `url(${s.customFontDataUrl})`);
      await customFontFace.load();
      document.fonts.add(customFontFace);
    } catch {
      customFontFace = null;
    }
  }

  if (s.fontFamily === "__custom__" && s.customFontDataUrl && customFontFace) {
    root.style.setProperty("--font", "ArunUserFont, sans-serif");
    root.style.setProperty("--font-mono", "ArunUserFont, monospace");
  } else if (s.fontFamily === "__typed__" && s.customFontFamilyName && s.customFontFamilyName.trim()) {
    // A name the person typed in (a font already installed on their system,
    // or a web font name) rather than picked from the preset list or
    // uploaded a file for.
    const typed = quoteFontName(s.customFontFamilyName.trim());
    root.style.setProperty("--font", `${typed}, sans-serif`);
    root.style.setProperty("--font-mono", `${typed}, monospace`);
  } else if (s.fontFamily && s.fontFamily !== "__typed__" && s.fontFamily !== "__custom__") {
    root.style.setProperty("--font", s.fontFamily);
    root.style.setProperty("--font-mono", s.fontFamily);
  } else {
    root.style.removeProperty("--font");
    root.style.removeProperty("--font-mono");
  }

  // Colors
  if (s.accentColor) root.style.setProperty("--gold", s.accentColor);
  else root.style.removeProperty("--gold");

  // Text color — applied to --text, --text2, and --text3 together.
  // Previously only --text was set, but --text2 (secondary labels) and
  // --text3 (the biggest bucket — muted captions, timers, 30+ selectors)
  // never moved, so most on-screen text ignored the picker. Now all three
  // shades follow the chosen color, just faded at different strengths so
  // the same visual hierarchy (primary/secondary/muted) is kept.
  if (s.textColor) {
    const rgb = hexToRgb(s.textColor) || "238,241,248";
    root.style.setProperty("--text", s.textColor);
    root.style.setProperty("--text2", `rgba(${rgb}, 0.75)`);
    root.style.setProperty("--text3", `rgba(${rgb}, 0.5)`);
  } else {
    root.style.removeProperty("--text");
    root.style.removeProperty("--text2");
    root.style.removeProperty("--text3");
  }

  // Solid background color — kept translucent (not hard-opaque) so it still
  // respects the Panel Opacity slider, same as the default theme colors do.
  // The outer app shell (--bg) stays solid since nothing renders behind it,
  // but every card/panel color (--bg2..--bg5) follows panelAlpha exactly like
  // the default palette does, instead of overriding it with a flat hex.
  if (s.bgColor) {
    const rgb = hexToRgb(s.bgColor) || "24,28,38";
    const alpha = s.panelAlpha ?? 0.55;
    root.style.setProperty("--bg", s.bgColor);
    root.style.setProperty("--bg2-rgb", rgb);
    root.style.setProperty("--bg2", `rgba(${rgb}, ${alpha})`);
    root.style.setProperty("--bg3", `rgba(${rgb}, ${Math.max(0, alpha - 0.08)})`);
    root.style.setProperty("--bg4", `rgba(${rgb}, ${Math.max(0, alpha - 0.03)})`);
    root.style.setProperty("--bg5", `rgba(${rgb}, ${Math.min(1, alpha + 0.12)})`);
  } else {
    root.style.removeProperty("--bg");
    root.style.removeProperty("--bg2-rgb");
    root.style.removeProperty("--bg2");
    root.style.removeProperty("--bg3");
    root.style.removeProperty("--bg4");
    root.style.removeProperty("--bg5");
  }

  // Background media: photo, animated GIF, or video — mutually exclusive,
  // picked by bgMediaType. GIFs are stored/rendered like images (CSS
  // background-image keeps them animated); videos get their own <video> layer.
  const imgLayer = document.getElementById("bgImageLayer");
  const vidLayer = document.getElementById("bgVideoLayer");
  const mediaType = s.bgMediaType || "image";

  if (mediaType === "video" && s.bgVideoDataUrl) {
    imgLayer.style.backgroundImage = "";
    document.body.classList.remove("has-bg-image");

    if (vidLayer.dataset.src !== s.bgVideoDataUrl) {
      vidLayer.src = s.bgVideoDataUrl;
      vidLayer.dataset.src = s.bgVideoDataUrl;
    }
    document.body.classList.add("has-bg-video");
    root.style.setProperty("--bg-blur", (s.bgBlur ?? 6) + "px");
    const fit = s.bgFit || "cover";
    root.style.setProperty("--bg-video-fit", fit === "stretch" ? "fill" : fit);
    // Muted defaults to true (matches old hardcoded behavior) unless the
    // person explicitly turned sound on in Appearance settings. Set this
    // BEFORE play() — browsers block autoplay-with-sound unless muted.
    vidLayer.muted = s.bgVideoMuted !== false;
    vidLayer.play().catch(() => {}); // autoplay can be blocked until a user gesture; harmless if so
  } else {
    vidLayer.removeAttribute("src");
    vidLayer.dataset.src = "";
    vidLayer.pause?.();
    document.body.classList.remove("has-bg-video");

    if (mediaType === "image" && s.bgImageDataUrl) {
      imgLayer.style.backgroundImage = `url(${s.bgImageDataUrl})`;
      document.body.classList.add("has-bg-image");
      root.style.setProperty("--bg-blur", (s.bgBlur ?? 6) + "px");
      const fit = s.bgFit || "cover";
      root.style.setProperty("--bg-image-size", fit === "stretch" ? "100% 100%" : fit);
      root.style.setProperty("--bg-image-scale", fit === "cover" ? "1.08" : "1");
    } else {
      imgLayer.style.backgroundImage = "";
      document.body.classList.remove("has-bg-image");
      root.style.removeProperty("--bg-blur");
      root.style.removeProperty("--bg-image-size");
      root.style.removeProperty("--bg-image-scale");
    }
  }

  // Glassmorphism panel tuning
  root.style.setProperty("--glass-blur", (s.panelBlur ?? 18) + "px");
  root.style.setProperty("--panel-alpha", String(s.panelAlpha ?? 0.55));
  root.style.setProperty("--border-strength", String((s.borderStrength ?? 25) / 100));
  root.style.setProperty("--border-color-rgb", hexToRgb(s.borderColor) || "255,255,255");

  // UI Style (Glass / Solid / Terminal / Neumorphic) — corner radius and
  // every var in STYLE_VARS are purely a side-effect of the chosen style,
  // no slider drives them directly. Set what this style defines, clear
  // everything else back to the normal theme value so no stale override
  // survives a switch back to Glass (or to a style that doesn't touch
  // that var) — EXCEPT for the handful of vars that also have their own
  // independent setting above (Font, Accent Color, Text Color): for
  // those, the person's own explicit pick always wins over the style's
  // default look, so skip touching them at all when one is set.
  const stylePreset = STYLE_PRESETS[s.uiStyle] || STYLE_PRESETS.glass;
  root.dataset.uiStyle = STYLE_PRESETS[s.uiStyle] ? s.uiStyle : "glass";
  root.style.setProperty("--radius", stylePreset.radius + "px");
  root.style.setProperty("--radius2", stylePreset.radius2 + "px");
  const styleVarHasOwnOverride = {
    "--font": !!s.fontFamily, "--font-mono": !!s.fontFamily,
    "--gold": !!s.accentColor, "--gold2": !!s.accentColor, "--gold3": !!s.accentColor,
    "--gold-rgb": !!s.accentColor, "--gold-dim": !!s.accentColor,
    "--text": !!s.textColor, "--text2": !!s.textColor, "--text3": !!s.textColor,
    "--bg2": !!s.bgColor, "--bg3": !!s.bgColor, "--bg4": !!s.bgColor, "--bg5": !!s.bgColor
  };
  for (const name of STYLE_VARS) {
    if (styleVarHasOwnOverride[name]) continue; // leave whatever the setting above already applied
    if (stylePreset.vars[name] !== undefined) root.style.setProperty(name, stylePreset.vars[name]);
    else root.style.removeProperty(name);
  }
  // Border color has no empty/unset state like the other pickers (it
  // always holds a hex value, defaulting to white) — so "#ffffff" is
  // treated as "still the default" and the style's own border color (if
  // it has one) applies; picking ANY other color counts as an explicit
  // choice and always wins over the style, exactly like Font/Accent/Text/
  // Background above. This also means changing Border Color is now
  // visible immediately even while a style like Terminal is active.
  const borderIsCustom = (s.borderColor || "#ffffff").toLowerCase() !== "#ffffff";
  if (stylePreset.borderColorRgb && !borderIsCustom) {
    root.style.setProperty("--border-color-rgb", stylePreset.borderColorRgb);
  }

  // Per-area font & color — setting a CSS variable directly on a tab's
  // <section> (rather than on :root) overrides it for everything inside
  // that one tab only, while every other tab keeps inheriting the global
  // --font/--font-mono/--text/--text2/--text3 set above. This is what lets
  // 4+ different areas each show a genuinely different font/color at the
  // same time instead of one global choice applying everywhere.
  const areaFonts = s.areaFonts || {};
  const areaTextColors = s.areaTextColors || {};
  for (const { key } of UI_AREAS) {
    const el = document.getElementById("tab-" + key);
    if (!el) continue;

    const fontOverride = areaFonts[key];
    if (fontOverride === "__custom__" && s.customFontDataUrl && customFontFace) {
      el.style.setProperty("--font", "ArunUserFont, sans-serif");
      el.style.setProperty("--font-mono", "ArunUserFont, monospace");
    } else if (fontOverride) {
      el.style.setProperty("--font", fontOverride);
      el.style.setProperty("--font-mono", fontOverride);
    } else {
      el.style.removeProperty("--font");
      el.style.removeProperty("--font-mono");
    }

    const colorOverride = areaTextColors[key];
    if (colorOverride) {
      const rgb = hexToRgb(colorOverride) || "238,241,248";
      el.style.setProperty("--text", colorOverride);
      el.style.setProperty("--text2", `rgba(${rgb}, 0.75)`);
      el.style.setProperty("--text3", `rgba(${rgb}, 0.5)`);
    } else {
      el.style.removeProperty("--text");
      el.style.removeProperty("--text2");
      el.style.removeProperty("--text3");
    }
  }
}

async function loadUISettings() {
  let s;
  try {
    const r = await chrome.storage.local.get("uiSettings");
    s = { ...DEFAULT_UI_SETTINGS, ...(r.uiSettings || {}) };
  } catch { s = { ...DEFAULT_UI_SETTINGS }; }
  return s;
}

async function saveUISettings(s) {
  try {
    await chrome.storage.local.set({ uiSettings: s });
  } catch (err) {
    // Never fail silently — a background/theme change that doesn't persist
    // is exactly the "looked saved but wasn't" bug this app has been bitten
    // by before. Still apply it live so the popup isn't stuck, but tell the
    // person clearly so they know to retry / shrink the file.
    await applyUISettings(s);
    alert("Couldn't save that change: " + (err?.message || "storage error") + "\nIt's showing now but won't survive closing the popup — try a smaller file or free up space.");
    throw err;
  }
  await applyUISettings(s);
}

async function initSettingsPanel() {
  // Single shared in-memory copy — every handler below mutates THIS object
  // and saves it, instead of each doing its own independent
  // load-from-storage → mutate → save. That old per-handler pattern could
  // lose a setting: if two controls were changed within the same ~10-50ms
  // storage round-trip, the later save would overwrite the earlier one with
  // stale data. Using one shared object removes that race entirely.
  let live = await loadUISettings();
  await applyUISettings(live);

  async function commit() {
    await saveUISettings(live);
  }

  const fontSelect   = document.getElementById("settingsFontSelect");
  const fontUpload   = document.getElementById("settingsFontUpload");
  const customFontOpt= document.getElementById("customFontOption");
  const fontTypedRow   = document.getElementById("settingsFontTypedRow");
  const fontTypedInput = document.getElementById("settingsFontTypedInput");
  const applyFontToSitesInput = document.getElementById("settingsApplyFontToSites");
  const customFontNm = document.getElementById("customFontName");
  const websiteFontRow      = document.getElementById("settingsWebsiteFontRow");
  const websiteFontSelect   = document.getElementById("settingsWebsiteFontSelect");
  const customWebsiteFontOpt= document.getElementById("customWebsiteFontOption");
  const websiteFontTypedRow   = document.getElementById("settingsWebsiteFontTypedRow");
  const websiteFontTypedInput = document.getElementById("settingsWebsiteFontTypedInput");
  const accentInput  = document.getElementById("settingsAccentColor");
  const textInput    = document.getElementById("settingsTextColor");
  const bgColorInput = document.getElementById("settingsBgColor");
  const bgImgUpload  = document.getElementById("settingsBgImageUpload");
  const bgImgName    = document.getElementById("bgImageName");
  const removeBgBtn  = document.getElementById("removeBgImageBtn");
  const blurRow      = document.getElementById("settingsBlurRow");
  const blurRange    = document.getElementById("settingsBlurRange");
  const blurVal      = document.getElementById("settingsBlurVal");
  const bgFitRow     = document.getElementById("settingsBgFitRow");
  const bgFitSelect  = document.getElementById("settingsBgFit");
  const muteRow      = document.getElementById("settingsMuteRow");
  const muteCheckbox = document.getElementById("settingsBgVideoMute");
  const panelBlurRange   = document.getElementById("settingsPanelBlurRange");
  const panelBlurVal     = document.getElementById("settingsPanelBlurVal");
  const panelAlphaRange  = document.getElementById("settingsPanelAlphaRange");
  const panelAlphaVal    = document.getElementById("settingsPanelAlphaVal");
  const borderStrengthRange = document.getElementById("settingsBorderStrengthRange");
  const borderStrengthVal   = document.getElementById("settingsBorderStrengthVal");
  const borderColorInput  = document.getElementById("settingsBorderColor");
  const borderColorSwatch = document.getElementById("settingsBorderColorSwatch");
  const uiStyleSelect     = document.getElementById("settingsUiStyleSelect");

  // ---- Per-area font & color rows (Track/Block/Speed/Pomo/Notes/Tasks/Habits) ----
  // Built once here; each row is wired independently so changing one area's
  // font or color never touches the others, and each area falls back to the
  // global Font/Text color above whenever its own override is cleared.
  const perAreaList = document.getElementById("perAreaList");
  const areaFontSelects = {};
  const areaColorInputs = {};
  const areaFontCustomOpts = {};

  UI_AREAS.forEach(({ key, label }) => {
    const row = document.createElement("div");
    row.className = "per-area-row";

    const lab = document.createElement("span");
    lab.className = "per-area-label";
    lab.textContent = label;

    const sel = document.createElement("select");
    sel.className = "picker";
    FONT_PRESETS.forEach(f => {
      const opt = document.createElement("option");
      opt.value = f.value;
      opt.textContent = f.label;
      sel.appendChild(opt);
    });
    // Lets a section use the globally-uploaded custom font too, not just the
    // 7 presets — hidden until a font has actually been uploaded above,
    // same rule the global picker's own "📁 Uploaded font" option follows.
    const custOpt = document.createElement("option");
    custOpt.value = "__custom__";
    custOpt.textContent = "📁 Uploaded font";
    custOpt.style.display = "none";
    sel.appendChild(custOpt);

    const col = document.createElement("input");
    col.type = "color";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "per-area-reset";
    resetBtn.title = "Reset " + label + " to the global default";
    resetBtn.textContent = "↺";

    row.append(lab, sel, col, resetBtn);
    perAreaList.appendChild(row);

    areaFontSelects[key] = sel;
    areaColorInputs[key] = col;
    areaFontCustomOpts[key] = custOpt;

    sel.addEventListener("change", async () => {
      // Rebuild as a new object rather than mutating live.areaFonts in
      // place — live can start out *as* DEFAULT_UI_SETTINGS.areaFonts by
      // reference (first run / after Reset), so an in-place edit would
      // silently corrupt the shared default for the rest of the session.
      const next = { ...(live.areaFonts || {}) };
      if (sel.value) next[key] = sel.value; else delete next[key];
      live.areaFonts = next;
      await commit();
    });

    col.addEventListener("input", async () => {
      const next = { ...(live.areaTextColors || {}) };
      next[key] = col.value;
      live.areaTextColors = next;
      await commit();
    });

    resetBtn.addEventListener("click", async () => {
      const nextFonts = { ...(live.areaFonts || {}) };
      const nextColors = { ...(live.areaTextColors || {}) };
      delete nextFonts[key];
      delete nextColors[key];
      live.areaFonts = nextFonts;
      live.areaTextColors = nextColors;
      await commit();
      reflectFormFromSettings(live); // repull this row's swatch back to the inherited color
    });
  });

  function reflectFormFromSettings(cur) {
    fontSelect.value = cur.fontFamily || "";
    if (cur.customFontDataUrl) {
      customFontOpt.style.display = "block";
      customFontNm.textContent = "Using: " + (cur.customFontName || "uploaded font");
    }
    fontTypedRow.style.display = cur.fontFamily === "__typed__" ? "block" : "none";
    fontTypedInput.value = cur.customFontFamilyName || "";
    applyFontToSitesInput.checked = !!cur.applyFontToWebsites;
    websiteFontRow.style.display = cur.applyFontToWebsites ? "block" : "none";
    websiteFontSelect.value = cur.websiteFontFamily || "";
    if (cur.customFontDataUrl) customWebsiteFontOpt.style.display = "block";
    websiteFontTypedRow.style.display = (cur.applyFontToWebsites && cur.websiteFontFamily === "__typed__") ? "block" : "none";
    websiteFontTypedInput.value = cur.websiteCustomFontFamilyName || "";
    accentInput.value = cur.accentColor || getComputedColorHex("--gold");
    textInput.value   = cur.textColor   || getComputedColorHex("--text");
    bgColorInput.value= cur.bgColor     || getComputedColorHex("--bg2");
    const hasMedia = (cur.bgMediaType === "video" && !!cur.bgVideoDataUrl) ||
                     (cur.bgMediaType !== "video" && !!cur.bgImageDataUrl);
    if (cur.bgMediaType === "video" && cur.bgVideoDataUrl) {
      bgImgName.textContent = "Custom background video set";
    } else if (cur.bgImageDataUrl) {
      bgImgName.textContent = "Custom background image set";
    } else {
      bgImgName.textContent = "";
    }
    const isVideo = cur.bgMediaType === "video" && !!cur.bgVideoDataUrl;
    removeBgBtn.style.display = hasMedia ? "block" : "none";
    blurRow.style.display = hasMedia ? "block" : "none";
    bgFitRow.style.display = hasMedia ? "block" : "none";
    bgFitSelect.value = cur.bgFit || "cover";
    muteRow.style.display = isVideo ? "flex" : "none";
    muteCheckbox.checked = cur.bgVideoMuted !== false;
    blurRange.value = cur.bgBlur ?? 6;
    blurVal.textContent = cur.bgBlur ?? 6;
    panelBlurRange.value = cur.panelBlur ?? 18;
    panelBlurVal.textContent = cur.panelBlur ?? 18;
    panelAlphaRange.value = Math.round((cur.panelAlpha ?? 0.55) * 100);
    panelAlphaVal.textContent = Math.round((cur.panelAlpha ?? 0.55) * 100);
    borderStrengthRange.value = cur.borderStrength ?? 25;
    borderStrengthVal.textContent = cur.borderStrength ?? 25;
    borderColorInput.value = cur.borderColor ?? "#ffffff";
    borderColorSwatch.style.background = cur.borderColor ?? "#ffffff";
    uiStyleSelect.value = cur.uiStyle || "glass";

    UI_AREAS.forEach(({ key }) => {
      const areaEl = document.getElementById("tab-" + key);
      // The "📁 Uploaded font" option only makes sense once a font has
      // actually been uploaded — same gating as the global picker.
      areaFontCustomOpts[key].style.display = cur.customFontDataUrl ? "block" : "none";
      const savedAreaFont = (cur.areaFonts && cur.areaFonts[key]) || "";
      // If a section was left pointed at the uploaded font and that font
      // was since removed, fall back to Default rather than showing a
      // dead selection.
      areaFontSelects[key].value = (savedAreaFont === "__custom__" && !cur.customFontDataUrl)
        ? "" : savedAreaFont;
      areaColorInputs[key].value = (cur.areaTextColors && cur.areaTextColors[key]) ||
        getComputedColorHex("--text", areaEl);
    });
  }
  reflectFormFromSettings(live);

  document.getElementById("settingsBtn").addEventListener("click", async () => {
    live = await loadUISettings(); // pick up anything changed elsewhere (e.g. Reset)
    reflectFormFromSettings(live);
    document.getElementById("settingsOverlay").style.display = "flex";
  });
  document.getElementById("closeSettingsBtn").addEventListener("click", () => {
    document.getElementById("settingsOverlay").style.display = "none";
  });
  document.getElementById("settingsOverlay").addEventListener("click", (e) => {
    if (e.target.id === "settingsOverlay") e.currentTarget.style.display = "none";
  });

  fontSelect.addEventListener("change", async () => {
    live.fontFamily = fontSelect.value;
    fontTypedRow.style.display = fontSelect.value === "__typed__" ? "block" : "none";
    if (fontSelect.value === "__typed__" && !live.customFontFamilyName) {
      fontTypedInput.focus();
    }
    await commit();
  });

  fontTypedInput.addEventListener("input", async () => {
    live.customFontFamilyName = fontTypedInput.value;
    live.fontFamily = "__typed__";
    await commit();
  });

  applyFontToSitesInput.addEventListener("change", async () => {
    live.applyFontToWebsites = applyFontToSitesInput.checked;
    websiteFontRow.style.display = applyFontToSitesInput.checked ? "block" : "none";
    await commit();
  });

  websiteFontSelect.addEventListener("change", async () => {
    live.websiteFontFamily = websiteFontSelect.value;
    websiteFontTypedRow.style.display = websiteFontSelect.value === "__typed__" ? "block" : "none";
    if (websiteFontSelect.value === "__typed__" && !live.websiteCustomFontFamilyName) {
      websiteFontTypedInput.focus();
    }
    await commit();
  });

  websiteFontTypedInput.addEventListener("input", async () => {
    live.websiteCustomFontFamilyName = websiteFontTypedInput.value;
    live.websiteFontFamily = "__typed__";
    await commit();
  });

  fontUpload.addEventListener("change", async () => {
    const file = fontUpload.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      live.customFontDataUrl = reader.result;
      live.customFontName = file.name;
      live.fontFamily = "__custom__";
      customFontFace = null; // force reload with the new font
      customFontOpt.style.display = "block";
      customWebsiteFontOpt.style.display = "block"; // same uploaded file, selectable for the website font too
      fontSelect.value = "__custom__";
      customFontNm.textContent = "Using: " + file.name;
      await commit();
    };
    reader.readAsDataURL(file);
  });

  accentInput.addEventListener("input", async () => {
    live.accentColor = accentInput.value;
    await commit();
  });
  textInput.addEventListener("input", async () => {
    live.textColor = textInput.value;
    await commit();
  });
  bgColorInput.addEventListener("input", async () => {
    live.bgColor = bgColorInput.value;
    await commit();
  });

  bgImgUpload.addEventListener("change", async () => {
    const file = bgImgUpload.files[0];
    if (!file) return;
    const isVideo = file.type.startsWith("video/");
    try {
      if (isVideo) {
        const dataUrl = await fileToBgVideoDataUrl(file);
        live.bgVideoDataUrl = dataUrl;
        live.bgImageDataUrl = "";       // mutually exclusive — only one media layer renders at a time
        live.bgMediaType = "video";
        bgImgName.textContent = "Custom background video set";
      } else {
        const dataUrl = await fileToBgDataUrl(file);
        live.bgImageDataUrl = dataUrl;
        live.bgVideoDataUrl = "";
        live.bgMediaType = "image";
        bgImgName.textContent = file.type === "image/gif" ? "Custom background GIF set" : "Custom background image set";
      }
      if (!live.bgBlur) live.bgBlur = 6;
      if (isVideo && live.bgVideoMuted === undefined) live.bgVideoMuted = true;
      await commit();
      removeBgBtn.style.display = "block";
      blurRow.style.display = "block";
      bgFitRow.style.display = "block";
      bgFitSelect.value = live.bgFit || "cover";
      blurRange.value = live.bgBlur;
      blurVal.textContent = live.bgBlur;
      muteRow.style.display = isVideo ? "flex" : "none";
      muteCheckbox.checked = live.bgVideoMuted !== false;
    } catch (err) {
      // Surface the real reason (too big / wrong type) instead of a silent
      // no-op, so a failed save is never mistaken for a successful one.
      alert(err?.message || "Couldn't load that file — try another one.");
    }
    bgImgUpload.value = "";
  });

  removeBgBtn.addEventListener("click", async () => {
    live.bgImageDataUrl = "";
    live.bgVideoDataUrl = "";
    live.bgMediaType = "image";
    await commit();
    bgImgName.textContent = "";
    removeBgBtn.style.display = "none";
    blurRow.style.display = "none";
    bgFitRow.style.display = "none";
    muteRow.style.display = "none";
  });

  bgFitSelect.addEventListener("change", async () => {
    live.bgFit = bgFitSelect.value;
    await commit();
  });

  muteCheckbox.addEventListener("change", async () => {
    live.bgVideoMuted = muteCheckbox.checked;
    await commit(); // commit() -> saveUISettings() -> applyUISettings() sets vidLayer.muted live
  });

  blurRange.addEventListener("input", async () => {
    blurVal.textContent = blurRange.value;
    live.bgBlur = Number(blurRange.value);
    await commit();
  });

  panelBlurRange.addEventListener("input", async () => {
    panelBlurVal.textContent = panelBlurRange.value;
    live.panelBlur = Number(panelBlurRange.value);
    await commit();
  });

  panelAlphaRange.addEventListener("input", async () => {
    panelAlphaVal.textContent = panelAlphaRange.value;
    live.panelAlpha = Number(panelAlphaRange.value) / 100;
    await commit();
  });

  borderStrengthRange.addEventListener("input", async () => {
    borderStrengthVal.textContent = borderStrengthRange.value;
    live.borderStrength = Number(borderStrengthRange.value);
    await commit();
  });

  uiStyleSelect.addEventListener("change", async () => {
    const preset = STYLE_PRESETS[uiStyleSelect.value] || STYLE_PRESETS.glass;
    live.uiStyle = uiStyleSelect.value;
    live.panelBlur = preset.panelBlur;
    live.panelAlpha = preset.panelAlpha;
    live.borderStrength = preset.borderStrength;
    await commit();
    reflectFormFromSettings(live);
  });

  borderColorInput.addEventListener("input", () => {
    const v = sanitizeHex(borderColorInput.value, null);
    if (v) borderColorSwatch.style.background = v;
  });
  borderColorInput.addEventListener("change", async () => {
    const v = sanitizeHex(borderColorInput.value, "#ffffff");
    borderColorInput.value = v;
    borderColorSwatch.style.background = v;
    live.borderColor = v;
    await commit();
  });

  document.getElementById("resetSettingsBtn").addEventListener("click", async () => {
    if (!confirm("Reset font, colors and background image to default?")) return;
    customFontFace = null;
    live = { ...DEFAULT_UI_SETTINGS };
    await commit();
    reflectFormFromSettings(live);
    renderTrack(lastLive);
    renderActiveHabitGraphs();
  });
}

function getComputedColorHex(varName, el) {
  const val = getComputedStyle(el || document.documentElement).getPropertyValue(varName).trim();
  if (!val) return "#000000";
  if (val.startsWith("#") && (val.length === 7 || val.length === 4)) return val;
  // rgb()/rgba() fallback → hex
  const m = /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/.exec(val);
  if (!m) return "#000000";
  const toHex = n => Number(n).toString(16).padStart(2, "0");
  return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
}

initSettingsPanel();

// =============================================
// THEME (Light / Dark) — toggle only, nothing else changes
// =============================================

let currentTheme = "dark";

function updateThemeToggleIcon() {
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = currentTheme === "dark" ? "🌙" : "☀️";
}

async function initTheme() {
  try {
    const r = await chrome.storage.local.get("theme");
    currentTheme = r.theme === "light" ? "light" : "dark";
  } catch { currentTheme = "dark"; }
  document.documentElement.setAttribute("data-theme", currentTheme);
  updateThemeToggleIcon();
}

document.getElementById("themeToggle").addEventListener("click", async () => {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", currentTheme);
  updateThemeToggleIcon();
  await chrome.storage.local.set({ theme: currentTheme });
  // Redraw canvases so colors match the new theme immediately
  renderTrack(lastLive);
  renderActiveHabitGraphs();
});

// =============================================
// FEEDBACK
// =============================================
document.getElementById("feedbackBtn").addEventListener("click", () => {
  const url = "mailto:iitmak4747@gmail.com?subject=" + encodeURIComponent("ARUN Extension Feedback");
  // A plain <a href="mailto:..."> inside the popup navigates the popup's
  // own tiny window instead of handing off to the OS mail app — opening it
  // as a real tab via the extension API is what actually works.
  chrome.tabs.create({ url });
});

// =============================================
// TRACK TAB
// =============================================

let liveInterval = null;
let selectedDate = getTodayKey();
let lastLive = null;
let anyTimetableLocked = false; // true while a Focus Timetable window is active — freezes study/waste tags too

// ---- Build date picker (last 7 days) ----
function buildDatePicker() {
  const picker = document.getElementById("datePicker");
  picker.innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const key = getDateKey(i);
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = i === 0 ? "Today" : i === 1 ? "Yesterday" : key;
    picker.appendChild(opt);
  }
  picker.addEventListener("change", () => {
    selectedDate = picker.value;
    renderTrack(lastLive);
  });
}

// ---- Today's Study/Waste totals (text) ----
function updateTodayStats(studySec, wasteSec) {
  const s = document.getElementById("todayStudyVal");
  const w = document.getElementById("todayWasteVal");
  if (s) s.textContent = fmtSec(studySec);
  if (w) w.textContent = fmtSec(wasteSec);
  updateFocusScore(studySec);
}

// ---- Daily Focus Score ----
// Derived on the fly from data that's already stored (nothing new is
// saved, so it can never drift or need migrating): study time vs a 2h
// target, share of today's tasks done, share of active habits ticked.
// Averages whichever of those exist today — no tasks/habits = that part
// simply doesn't count for or against you.
const FOCUS_STUDY_TARGET_SEC = 2 * 3600;
let focusScoreLastRun = 0;
let focusScoreSeq = 0;

function focusGrade(score) {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

async function updateFocusScore(studySec) {
  const el = document.getElementById("focusScoreVal");
  if (!el) return;
  const now = Date.now();
  if (now - focusScoreLastRun < 2000) return; // live ticks call this every second — no need to re-read storage that often
  focusScoreLastRun = now;
  const seq = ++focusScoreSeq;
  const r = await chrome.storage.local.get(["tasks", "habits"]);
  if (seq !== focusScoreSeq) return;
  const parts = [Math.min(1, (studySec || 0) / FOCUS_STUDY_TARGET_SEC)];
  const todayTasks = (r.tasks || []).filter(t => !isTaskUpcoming(t));
  if (todayTasks.length) parts.push(todayTasks.filter(t => t.done).length / todayTasks.length);
  const today = getTodayKey();
  const habits = r.habits || [];
  if (habits.length) parts.push(habits.filter(h => h.entries && h.entries[today] !== undefined).length / habits.length);
  const score = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length * 100);
  el.textContent = `${score} · ${focusGrade(score)}`;
}

// ---- Study vs Waste line graph, range selectable (7/14/30/90/All) ----
async function drawDayGraph(liveData) {
  const canvas = document.getElementById("dayGraph");
  if (!canvas) return;
  const rangeSel = document.getElementById("dayGraphRangeSelect");
  const range = rangeSel ? rangeSel.value : "7";
  const W = 362, H = 100;
  const ctx = prepCanvasDPR(canvas, W, H);
  ctx.clearRect(0, 0, W, H);

  const theme  = graphTheme(canvas);
  const cBg2   = theme.text("--bg2")    || "#16161a";
  const cBord  = theme.text("--border2")|| "#2e2e3a";
  const cMuted = theme.text("--text3")  || "#5e5a52";
  const cGreen = theme.text("--green")  || "#4caf82";

  ctx.fillStyle = cBg2;
  ctx.fillRect(0, 0, W, H);

  const r = await chrome.storage.local.get(["timeData", "siteCategories"]);
  const timeData = r.timeData || {};
  const cats = r.siteCategories || {};

  let dayKeys;
  if (range === "all") {
    dayKeys = Object.keys(timeData).sort();
    if (!dayKeys.length) dayKeys = [getTodayKey()];
  } else {
    const n = Number(range);
    dayKeys = Array.from({ length: n }, (_, idx) => getDateKey(n - 1 - idx));
  }

  const todayKey = getTodayKey();
  const days = dayKeys.map(key => {
    const dayData = { ...(timeData[key] || {}) };
    if (key === todayKey && liveData && liveData.domain) {
      dayData[liveData.domain] = (dayData[liveData.domain] || 0) + (liveData.elapsedSeconds || 0);
    }
    let study = 0, waste = 0;
    Object.entries(dayData).forEach(([dom, secs]) => {
      if ((cats[dom] || "waste") === "study") study += secs; else waste += secs;
    });
    return { key, study, waste, label: key === todayKey ? "Today" : key.slice(5) };
  });

  const leftM = 38, rightM = 12, topM = 12, bottomM = 18;
  const plotW = W - leftM - rightM;
  const plotH = H - topM - bottomM;
  const cRed = theme.text("--red") || "#c0564a";
  const maxVal = Math.max(...days.map(d => Math.max(d.study, d.waste)), 1) * 1.2;

  const xAt = i => days.length === 1 ? leftM + plotW / 2 : leftM + (plotW / (days.length - 1)) * i;
  const yAt = v => topM + plotH - (v / maxVal) * plotH;

  // Grid
  ctx.strokeStyle = cBord;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  [0, 0.5, 1].forEach(f => {
    const gy = topM + plotH * (1 - f);
    ctx.beginPath(); ctx.moveTo(leftM, gy); ctx.lineTo(W - rightM, gy); ctx.stroke();
  });
  ctx.setLineDash([]);

  // Draw total line (gold)
  function drawLine(dataKey, color, fill) {
    ctx.beginPath();
    days.forEach((d, i) => {
      const x = xAt(i), y = yAt(d[dataKey]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    if (fill) {
      ctx.lineTo(xAt(days.length - 1), yAt(0));
      ctx.lineTo(xAt(0), yAt(0));
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, topM, 0, topM + plotH);
      grad.addColorStop(0, color + "30");
      grad.addColorStop(1, color + "00");
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Dots — skip when there are too many points, it just becomes noise
    if (days.length <= 40) {
      days.forEach((d, i) => {
        const x = xAt(i), y = yAt(d[dataKey]);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });
    }
  }

  drawLine("study", cGreen, true);
  drawLine("waste", cRed, false);

  // X labels — thin them out for long ranges so they don't overlap
  ctx.fillStyle = cMuted;
  ctx.font = `8px ${theme.font}`;
  ctx.textAlign = "center";
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));
  days.forEach((d, i) => {
    if (i % labelEvery !== 0 && i !== days.length - 1) return;
    ctx.fillText(d.label.slice(-5), xAt(i), H - 4);
  });

  // Y axis label (top)
  ctx.fillStyle = cMuted;
  ctx.font = `8px ${theme.font}`;
  ctx.textAlign = "left";
  ctx.fillText(fmtShort(maxVal), 2, topM + 8);
}

// ---- Site List ----
function renderSiteList(dayData, categories, liveData) {
  const list = document.getElementById("siteList");
  list.innerHTML = "";

  let display = { ...dayData };
  if (liveData && liveData.domain && selectedDate === getTodayKey()) {
    const d = liveData.domain;
    display[d] = (display[d] || 0) + (liveData.elapsedSeconds || 0);
  }

  const sorted = Object.entries(display).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) {
    list.innerHTML = '<div class="empty-state">No data yet. Start browsing!</div>';
    return;
  }

  sorted.forEach(([domain, secs]) => {
    const cat = categories[domain] || "waste";
    const isStudy = cat === "study";

    const row = document.createElement("div");
    row.className = `site-row ${isStudy ? "is-study" : "is-waste"}`;

    const isLive = liveData && liveData.domain === domain && selectedDate === getTodayKey();
    const liveDot = isLive ? `<span class="live-dot" style="width:5px;height:5px;margin-right:3px;flex-shrink:0"></span>` : "";

    row.innerHTML = `
      ${liveDot}
      <span class="site-name" title="${domain}">${domain}</span>
      <span class="site-time">${fmtSec(secs)}</span>
      <button class="toggle-btn ${isStudy ? "study" : "waste"} ${anyTimetableLocked ? "toggle-locked" : ""}"
        data-domain="${domain}" data-current="${cat}"
        title="${anyTimetableLocked ? "Locked while a focus schedule is active" : ""}">
        ${anyTimetableLocked ? "🔒 " : ""}${isStudy ? "📗 Study" : "📕 Waste"}
      </button>`;

    row.querySelector(".toggle-btn").addEventListener("click", async (e) => {
      if (anyTimetableLocked) {
        alert("Study/Waste tags are locked while a focus schedule is active — try again after it ends.");
        return;
      }
      const d = e.currentTarget.dataset.domain;
      const cur = e.currentTarget.dataset.current;
      const next = cur === "study" ? "waste" : "study";
      const r = await chrome.storage.local.get("siteCategories");
      const cats = r.siteCategories || {};
      cats[d] = next;
      await chrome.storage.local.set({ siteCategories: cats });
      renderTrack(lastLive);
    });

    list.appendChild(row);
  });
}

// ---- Main Render ----
document.getElementById("dayGraphRangeSelect").addEventListener("change", () => renderTrack());

async function renderTrack(liveData) {
  const r = await chrome.storage.local.get(["timeData", "siteCategories"]);
  const timeData = r.timeData || {};
  const cats = r.siteCategories || {};
  const dayData = timeData[selectedDate] || {};

  let display = { ...dayData };
  if (liveData && liveData.domain && selectedDate === getTodayKey()) {
    const d = liveData.domain;
    display[d] = (display[d] || 0) + (liveData.elapsedSeconds || 0);
  }

  let studySec = 0, wasteSec = 0;
  Object.entries(display).forEach(([domain, secs]) => {
    if ((cats[domain] || "waste") === "study") studySec += secs;
    else wasteSec += secs;
  });
  const totalSec = studySec + wasteSec;

  document.getElementById("totalUsage").textContent = "⏱ " + fmtSec(totalSec);

  updateTodayStats(studySec, wasteSec);
  const rangeSelEl = document.getElementById("dayGraphRangeSelect");
  const labelEl = document.getElementById("dayGraphLabel");
  if (rangeSelEl && labelEl) {
    labelEl.textContent = rangeSelEl.value === "all" ? "All-Time History" : rangeSelEl.value + "-Day History";
  }
  await drawDayGraph(liveData);
  renderSiteList(dayData, cats, liveData);
}

// ---- Live Updater (every 1 second) ----
function startLive() {
  if (liveInterval) return;
  liveInterval = setInterval(async () => {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "GET_LIVE_STATUS" });
      lastLive = resp;
      document.getElementById("liveDomain").textContent = resp.domain || "—";
      document.getElementById("liveTime").textContent   = fmtSec(resp.elapsedSeconds);
      renderTrack(resp);
    } catch {}
  }, 1000);
}

initTheme().then(() => {
  buildDatePicker();
  renderTrack(null);
  startLive();
});

// =============================================
// BLOCK TAB
// =============================================

function fmtLockRemaining(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

let blockListLockTimer = null;

async function loadBlockList() {
  const list = document.getElementById("blockList");
  list.innerHTML = "";
  let resp, lockResp;
  try {
    resp = await chrome.runtime.sendMessage({ type: "GET_BLOCKED_SITES" });
    lockResp = await chrome.runtime.sendMessage({ type: "GET_BLOCK_LOCKS" });
  } catch { return; }
  const sites = resp.sites || [];
  const locks = lockResp.locks || {};
  const hardLocked = new Set(lockResp.hardLocked || []);
  if (!sites.length) {
    list.innerHTML = '<li style="padding:10px;color:var(--text3);font-size:11px;font-family:monospace">No sites blocked.</li>';
  } else {
    const now = Date.now();
    sites.forEach(site => {
      const lockedUntil = locks[site];
      const isLocked = lockedUntil && lockedUntil > now;
      const li = document.createElement("li");
      li.className = "block-item";
      if (hardLocked.has(site)) {
        // Wasted-time limit hit — can't be removed or edited by any path
        // (background.js's SET_BLOCKED_SITES handler enforces this too),
        // resets automatically at midnight, nothing to click here.
        li.innerHTML = `<span>${site}</span><span class="hard-lock-badge" title="Today's wasted-time limit was reached — resets automatically at midnight">🔒 Limit reached — resets at midnight</span>`;
      } else if (isLocked) {
        li.innerHTML = `<span>${site}</span><span class="block-lock-badge" data-until="${lockedUntil}" title="Locked — cannot be removed until this runs out, even by disabling the extension">🔒 ${fmtLockRemaining(lockedUntil - now)}</span>`;
      } else {
        li.innerHTML = `<span>${site}</span><button class="rm-btn" data-site="${site}">Remove</button>`;
        li.querySelector(".rm-btn").addEventListener("click", async () => {
          const newSites = sites.filter(s => s !== site);
          const r = await chrome.runtime.sendMessage({ type: "SET_BLOCKED_SITES", sites: newSites });
          if (r && r.blockedLocked && r.blockedLocked.length) {
            alert(`"${r.blockedLocked[0]}" is still locked and can't be removed yet.`);
          }
          loadBlockList();
        });
      }
      list.appendChild(li);
    });
  }

  // Keep the countdown badges ticking without a full re-render every second,
  // and automatically flip a row over to its Remove button the moment its
  // lock actually expires.
  clearInterval(blockListLockTimer);
  blockListLockTimer = setInterval(() => {
    const badges = list.querySelectorAll(".block-lock-badge");
    if (!badges.length) { clearInterval(blockListLockTimer); return; }
    const t = Date.now();
    let anyExpired = false;
    badges.forEach(b => {
      const until = Number(b.dataset.until);
      if (until <= t) anyExpired = true;
      else b.textContent = `🔒 ${fmtLockRemaining(until - t)}`;
    });
    if (anyExpired) loadBlockList();
  }, 1000);

  await loadWastedTime();
}

function fmtSeconds(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

async function loadWastedTime() {
  // Populate the site dropdown FIRST and independently of the wasted-time
  // fetch below — the two used to be coupled, so if GET_WASTED_TIME ever
  // failed for any reason, the whole function returned early and the
  // dropdown was left permanently empty even when sites WERE blocked.
  const selectEl = document.getElementById("siteLimitSelect");
  let sites = [];
  try {
    const blockedResp = await chrome.runtime.sendMessage({ type: "GET_BLOCKED_SITES" });
    sites = (blockedResp && blockedResp.sites) || [];
  } catch { /* leave sites empty, handled below */ }

  let resp = null;
  try {
    resp = await chrome.runtime.sendMessage({ type: "GET_WASTED_TIME" });
  } catch { /* stats just won't show this round — dropdown still gets populated */ }

  const perSite = (resp && resp.perSite) || {};
  const prevSelected = selectEl.value;
  selectEl.innerHTML = sites.length
    ? sites.map(s => `<option value="${s}">${s}${perSite[s] ? ` (${fmtSeconds(perSite[s])} today)` : ""}</option>`).join("")
    : `<option value="">No blocked sites yet — add one in the list above first</option>`;
  if (sites.includes(prevSelected)) selectEl.value = prevSelected;

  if (!resp) return; // couldn't reach background.js this round — dropdown is still correct, just skip the stats below

  const summaryEl = document.getElementById("wastedTimeSummary");
  const limitH = resp.wastedLimitSeconds ? (resp.wastedLimitSeconds / 3600).toFixed(1).replace(/\.0$/, "") : null;
  summaryEl.textContent = `Today's wasted time: ${fmtSeconds(resp.total)}` + (limitH ? ` / limit: ${limitH}h` : "");

  document.getElementById("wastedLimitToggle").checked = !!resp.wastedLimitSeconds;
  document.getElementById("wastedLimitRow").style.display = resp.wastedLimitSeconds ? "" : "none";
  if (resp.wastedLimitSeconds) {
    document.getElementById("wastedLimitHours").value = (resp.wastedLimitSeconds / 3600).toFixed(1).replace(/\.0$/, "");
  }

  // List of sites that currently HAVE their own limit set.
  const siteLimitListEl = document.getElementById("siteLimitList");
  const entries = Object.entries(resp.siteLimits || {});
  siteLimitListEl.innerHTML = entries.length
    ? entries.map(([domain, secs]) => `
        <div class="site-limit-item">
          <span>${domain} — ${fmtSeconds(secs)}/day</span>
          <button class="timetable-del-btn" data-domain="${domain}" title="Remove limit">✕</button>
        </div>
      `).join("")
    : "";
  siteLimitListEl.querySelectorAll(".timetable-del-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      await chrome.runtime.sendMessage({ type: "SET_SITE_TIME_LIMIT", domain: e.currentTarget.dataset.domain, seconds: 0 });
      loadWastedTime();
    });
  });
}

document.getElementById("wastedLimitToggle").addEventListener("change", (e) => {
  document.getElementById("wastedLimitRow").style.display = e.target.checked ? "" : "none";
});

document.getElementById("wastedLimitSaveBtn").addEventListener("click", async () => {
  const enabled = document.getElementById("wastedLimitToggle").checked;
  const hours = Number(document.getElementById("wastedLimitHours").value) || 0;
  const seconds = enabled ? Math.round(hours * 3600) : 0;
  await chrome.runtime.sendMessage({ type: "SET_WASTED_TIME_LIMIT", seconds });
  loadWastedTime();
});

document.getElementById("siteLimitSaveBtn").addEventListener("click", async () => {
  const domain = document.getElementById("siteLimitSelect").value;
  if (!domain) return;
  const hours = Number(document.getElementById("siteLimitHours").value) || 0;
  await chrome.runtime.sendMessage({ type: "SET_SITE_TIME_LIMIT", domain, seconds: Math.round(hours * 3600) });
  loadWastedTime();
});

document.getElementById("addBlockBtn").addEventListener("click", async () => {
  const inp = document.getElementById("blockInput");
  const val = inp.value.trim().toLowerCase().replace(/^www\./, "").replace(/\/.*$/, "");
  if (!val || !val.includes(".")) return;
  const resp = await chrome.runtime.sendMessage({ type: "GET_BLOCKED_SITES" });
  const sites = resp.sites || [];
  if (!sites.includes(val)) {
    sites.push(val);
    await chrome.runtime.sendMessage({ type: "SET_BLOCKED_SITES", sites });
  }

  const MAX_LOCK_MS = 12 * 60 * 60 * 1000; // hard cap: 12 hours
  const lockAmount = Number(document.getElementById("blockLockInput").value) || 0;
  const lockUnitRaw = document.getElementById("blockLockUnit").value;

  if (lockUnitRaw === "always") {
    // Permanent block, no timer — stays until the user removes it
    // themselves from this list. No ADD_BLOCK_LOCK call at all, since a
    // lock is specifically the timed/auto-expiring kind.
  } else if (lockAmount > 0) {
    const lockUnitMs = Number(lockUnitRaw) || 60000;
    let durationMs = lockAmount * lockUnitMs;
    if (durationMs > MAX_LOCK_MS) {
      durationMs = MAX_LOCK_MS;
      alert("Max timed-lock duration is 12 hours — locking for 12 hours instead.");
    }
    const until = Date.now() + durationMs;
    await chrome.runtime.sendMessage({ type: "ADD_BLOCK_LOCK", domain: val, until });
    document.getElementById("blockLockInput").value = "0"; // don't silently re-lock the next unrelated site added
  }

  inp.value = "";
  loadBlockList();
});

document.getElementById("blockInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("addBlockBtn").click();
});

loadBlockList();

// =============================================
// BLOCK TAB — Auto-Open Scheduler
// =============================================

const aoModeSelect    = document.getElementById("aoModeSelect");
const aoDailyRow      = document.getElementById("aoDailyRow");
const aoIntervalRow   = document.getElementById("aoIntervalRow");

aoModeSelect.addEventListener("change", () => {
  const isDaily = aoModeSelect.value === "daily";
  aoDailyRow.style.display    = isDaily ? "flex" : "none";
  aoIntervalRow.style.display = isDaily ? "none" : "flex";
});

function normalizeUrl(raw) {
  let v = raw.trim();
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  return v;
}

function fmtIntervalLabel(mins) {
  if (mins % 60 === 0 && mins >= 60) return `every ${mins / 60}h`;
  return `every ${mins}m`;
}

async function loadAutoOpens() {
  let resp;
  try { resp = await chrome.runtime.sendMessage({ type: "GET_AUTO_OPENS" }); }
  catch { resp = { autoOpens: [] }; }
  renderAutoOpenList(resp.autoOpens || []);
}

function renderAutoOpenList(rules) {
  const listEl  = document.getElementById("autoOpenList");
  const emptyEl = document.getElementById("autoOpenEmpty");
  if (!listEl) return;

  if (!rules.length) {
    listEl.innerHTML = "";
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  listEl.innerHTML = rules.map(r => `
    <div class="timetable-item" data-id="${r.id}">
      <div class="timetable-item-top">
        <span class="timetable-item-time auto-open-item-time">
          ${r.mode === "daily" ? "🕐 " + r.time + " daily" : "🔁 " + fmtIntervalLabel(r.intervalMinutes)}
        </span>
        <button class="timetable-del-btn" data-id="${r.id}" title="Delete">✕</button>
      </div>
      <div class="timetable-item-sites" title="${r.url}">${r.url}</div>
    </div>`).join("");

  listEl.querySelectorAll(".timetable-del-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "DELETE_AUTO_OPEN", id: btn.dataset.id });
      await loadAutoOpens();
    });
  });
}

document.getElementById("addAutoOpenBtn").addEventListener("click", async () => {
  const url = normalizeUrl(document.getElementById("aoUrlInput").value);
  if (!url) {
    alert("Enter a link first — e.g. https://example.com/page-to-open");
    document.getElementById("aoUrlInput").focus();
    return;
  }
  const mode = aoModeSelect.value;

  let resp;
  if (mode === "daily") {
    const time = document.getElementById("aoTimeInput").value;
    if (!time) {
      alert("Pick a time — the field still shows “--:--”. Tap it and choose a time, then hit Schedule again.");
      document.getElementById("aoTimeInput").focus();
      return;
    }
    resp = await sendMsgRetry({ type: "ADD_AUTO_OPEN", url, mode, time });
  } else {
    const num  = parseFloat(document.getElementById("aoIntervalInput").value) || 30;
    const unit = parseFloat(document.getElementById("aoIntervalUnit").value) || 1;
    const intervalMinutes = Math.max(1, Math.round(num * unit));
    resp = await sendMsgRetry({ type: "ADD_AUTO_OPEN", url, mode, intervalMinutes });
  }

  if (!resp || !resp.ok) {
    alert("Couldn't reach the extension's background service — try again, or reload the extension from chrome://extensions.");
    return;
  }

  document.getElementById("aoUrlInput").value = "";
  await loadAutoOpens();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.autoOpens) loadAutoOpens();
});

loadAutoOpens();

// =============================================
// SPEED TAB
// =============================================

const slider   = document.getElementById("speedSlider");
const speedVal = document.getElementById("speedVal");

function updateSpeedDisplay(val) {
  const n = parseFloat(val);
  speedVal.textContent = Number.isInteger(n) ? n.toFixed(1) : n.toFixed(2).replace(/0+$/, "");
}

slider.addEventListener("input", () => updateSpeedDisplay(slider.value));

document.querySelectorAll(".preset-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const spd = parseFloat(btn.dataset.speed);
    slider.value = spd;
    updateSpeedDisplay(spd);
    document.querySelectorAll(".preset-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

document.getElementById("applySpeed").addEventListener("click", async () => {
  const spd = parseFloat(slider.value);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (rate) => { document.querySelectorAll("video, audio").forEach(el => el.playbackRate = rate); },
      args: [spd]
    });
  } catch(e) { console.warn("Speed inject failed:", e.message); }
});

// ---- Ad Blocker toggle ----
const adBlockToggle = document.getElementById("adBlockToggle");
const adBlockStatus = document.getElementById("adBlockStatus");

function updateAdBlockStatusUI(enabled) {
  adBlockToggle.checked = enabled;
  adBlockStatus.textContent = enabled
    ? "Active — ads are being blocked"
    : "Off — ads will show normally";
  adBlockStatus.classList.toggle("off", !enabled);
}

chrome.runtime.sendMessage({ type: "GET_ADBLOCK_STATE" }).then(r => {
  updateAdBlockStatusUI(r.enabled !== false);
}).catch(() => {});

adBlockToggle.addEventListener("change", async () => {
  const enabled = adBlockToggle.checked;
  updateAdBlockStatusUI(enabled);
  try { await chrome.runtime.sendMessage({ type: "SET_ADBLOCK_STATE", enabled }); } catch {}
});

// =============================================
// SKIN TAB — website background image / border / opacity / text color
// Storage shape:
//   siteSkins        = { [domain]: <skin> }   — per-site overrides
//   siteSkinDefault   = <skin> | undefined     — applies to every site
//     unless that site has its own entry in siteSkins.
//   <skin> = { bgImageDataUrl, bgOpacity, frameEnabled, frameWidth,
//     frameColor, elBorderEnabled, elBorderWidth, elBorderColor,
//     textColorEnabled, textColor }
// Applied to actual web pages by site-skin.js (a content script), which
// reads these same storage keys and reacts live via chrome.storage.onChanged
// — saving here is enough, no message needs to be sent to the tab.
// =============================================

// Native <input type="color"> can steal focus to an OS-level dialog and
// close the extension popup before a color is even picked (a known Chrome
// extension-popup limitation) — every color field in this tab is a plain
// hex text input + a preview swatch instead, so nothing ever leaves the
// popup's own window.
function sanitizeHex(v, fallback) {
  v = String(v || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(v)) return "#" + v.toLowerCase();
  return fallback;
}

function wireHexColorInput(inputId, swatchId, fallback) {
  const input = document.getElementById(inputId);
  const swatch = document.getElementById(swatchId);
  const finalize = () => {
    input.value = sanitizeHex(input.value, fallback);
    swatch.style.background = input.value;
  };
  input.addEventListener("input", () => {
    const v = sanitizeHex(input.value, null);
    if (v) swatch.style.background = v;
  });
  input.addEventListener("blur", finalize);
  // Also finalize on "change" (fired when a palette swatch below sets
  // .value programmatically) — blur alone wouldn't catch that since the
  // input never gets focus in that case.
  input.addEventListener("change", finalize);
}
wireHexColorInput("skinBgColor", "skinBgColorSwatch", "#101018");
wireHexColorInput("skinFrameColor", "skinFrameColorSwatch", "#7c9cff");
wireHexColorInput("skinElBorderColor", "skinElBorderColorSwatch", "#7c9cff");
wireHexColorInput("skinTextColor", "skinTextColorSwatch", "#ffffff");

// ---- Small preset color palette (new this session) — the person asked
// for a click-to-select option instead of always having to type a hex
// code. Deliberately NOT a native <input type="color">: that opens an
// OS-level dialog which closes the extension popup before a color is
// even picked (see note above wireHexColorInput's usages) — these are
// plain clickable swatch buttons, so nothing ever leaves the popup.
// Works for every hex color field in the Skin tab (static AND the
// dynamically-rendered per-element/per-group ones) via one delegated
// click listener, rather than re-wiring after every render.
const SKIN_COLOR_PALETTE = [
  "#ffffff", "#000000", "#7c9cff", "#ff6b6b", "#51cf66", "#ffd43b",
  "#ff922b", "#845ef7", "#20c997", "#e64980", "#495057", "#101018"
];
function buildColorPaletteHtml() {
  return `<div class="color-palette">` +
    SKIN_COLOR_PALETTE.map((c) =>
      `<button type="button" class="color-palette-swatch" data-hex="${c}" style="background:${c}" title="${c}"></button>`
    ).join("") +
    `</div>`;
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".color-palette-swatch");
  if (!btn) return;
  const wrap = btn.closest(".skin-color-field");
  const input = wrap && wrap.querySelector(".color-hex-input");
  if (!input) return;
  input.value = btn.dataset.hex;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
// The 4 static Skin-tab color fields (canvas, frame, border, text) are
// already in popup.html wrapped in a .skin-color-field div — inject
// their palette swatches here once, rather than repeating the same
// 12-button markup by hand in the HTML file.
document.querySelectorAll(".skin-color-field").forEach((wrap) => {
  if (!wrap.querySelector(".color-palette")) wrap.insertAdjacentHTML("beforeend", buildColorPaletteHtml());
});

// ---- Full HSV color wheel (new this session) — the palette above is
// only 12 presets; this lets the person pick ANY exact color by
// clicking/dragging, like a real color-picker circle, without opening
// the native OS dialog (same popup-closing problem as always). One
// popover, reused for whichever swatch was clicked — works for the 4
// static Skin-tab fields AND every dynamically-rendered picked-element/
// group swatch, since they all share the same .color-swatch-preview +
// .color-hex-input markup.
function hsvToHex(h, s, v) {
  s /= 100; v /= 100;
  const k = (n) => (n + h / 60) % 6;
  const f = (n) => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  const toHex = (x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, "0");
  return "#" + toHex(f(5)) + toHex(f(3)) + toHex(f(1));
}
function hexToHsv(hex) {
  const m = String(hex || "").replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return { h: 220, s: 60, v: 100 };
  const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return { h, s, v };
}

let colorWheelTargetInput = null;
let colorWheelHue = 220, colorWheelSat = 60, colorWheelVal = 100;

function updateColorWheelUI() {
  document.getElementById("colorWheelSV").style.background =
    `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${colorWheelHue},100%,50%))`;
  document.getElementById("colorWheelSVCursor").style.left = colorWheelSat + "%";
  document.getElementById("colorWheelSVCursor").style.top = (100 - colorWheelVal) + "%";
  document.getElementById("colorWheelHueCursor").style.left = (colorWheelHue / 360 * 100) + "%";
  const hex = hsvToHex(colorWheelHue, colorWheelSat, colorWheelVal);
  document.getElementById("colorWheelPreview").style.background = hex;
  document.getElementById("colorWheelHexOut").value = hex;
}

function openColorWheel(inputEl, anchorEl) {
  colorWheelTargetInput = inputEl;
  const hsv = hexToHsv(sanitizeHex(inputEl.value, "#7c9cff"));
  colorWheelHue = hsv.h; colorWheelSat = hsv.s; colorWheelVal = hsv.v;
  updateColorWheelUI();
  const pop = document.getElementById("colorWheelPopover");
  pop.style.display = "block";
  const rect = anchorEl.getBoundingClientRect();
  const popH = 210, popW = 168;
  pop.style.top = Math.max(6, Math.min(window.innerHeight - popH - 6, rect.bottom + 6)) + "px";
  pop.style.left = Math.max(6, Math.min(window.innerWidth - popW - 6, rect.left)) + "px";
}

function closeColorWheel(apply) {
  const pop = document.getElementById("colorWheelPopover");
  pop.style.display = "none";
  if (apply && colorWheelTargetInput) {
    const hex = hsvToHex(colorWheelHue, colorWheelSat, colorWheelVal);
    colorWheelTargetInput.value = hex;
    colorWheelTargetInput.dispatchEvent(new Event("input", { bubbles: true }));
    colorWheelTargetInput.dispatchEvent(new Event("change", { bubbles: true }));
  }
  colorWheelTargetInput = null;
}

let colorWheelSVDragging = false, colorWheelHueDragging = false;

function updateSVFromEvent(e) {
  const rect = document.getElementById("colorWheelSV").getBoundingClientRect();
  let x = (e.clientX - rect.left) / rect.width;
  let y = (e.clientY - rect.top) / rect.height;
  x = Math.min(1, Math.max(0, x));
  y = Math.min(1, Math.max(0, y));
  colorWheelSat = x * 100;
  colorWheelVal = (1 - y) * 100;
  updateColorWheelUI();
}
function updateHueFromEvent(e) {
  const rect = document.getElementById("colorWheelHue").getBoundingClientRect();
  let x = (e.clientX - rect.left) / rect.width;
  x = Math.min(1, Math.max(0, x));
  colorWheelHue = x * 360;
  updateColorWheelUI();
}

document.getElementById("colorWheelSV").addEventListener("mousedown", (e) => {
  colorWheelSVDragging = true;
  updateSVFromEvent(e);
});
document.getElementById("colorWheelHue").addEventListener("mousedown", (e) => {
  colorWheelHueDragging = true;
  updateHueFromEvent(e);
});
document.addEventListener("mousemove", (e) => {
  if (colorWheelSVDragging) updateSVFromEvent(e);
  if (colorWheelHueDragging) updateHueFromEvent(e);
});
document.addEventListener("mouseup", () => {
  colorWheelSVDragging = false;
  colorWheelHueDragging = false;
});
document.getElementById("colorWheelDone").addEventListener("click", () => closeColorWheel(true));
document.getElementById("colorWheelHexOut").addEventListener("change", (e) => {
  const hex = sanitizeHex(e.target.value, null);
  if (hex) {
    const hsv = hexToHsv(hex);
    colorWheelHue = hsv.h; colorWheelSat = hsv.s; colorWheelVal = hsv.v;
    updateColorWheelUI();
  }
});

// Open on any swatch click; close on an outside click (mousedown, so it
// runs before the swatch's own "click to open" listener below and
// doesn't immediately re-close a wheel that's opening this same turn).
document.addEventListener("mousedown", (e) => {
  const pop = document.getElementById("colorWheelPopover");
  if (pop.style.display !== "none" && !pop.contains(e.target) && !e.target.closest(".color-swatch-preview")) {
    closeColorWheel(true); // apply whatever was picked before closing, like clicking Done
  }
});
document.addEventListener("click", (e) => {
  const swatch = e.target.closest(".color-swatch-preview");
  if (!swatch) return;
  const row = swatch.closest(".color-input-row");
  const input = row && row.querySelector(".color-hex-input");
  if (!input) return;
  openColorWheel(input, swatch);
});

const SKIN_DEFAULTS = {
  bgImageDataUrl: "",
  bgVideoDataUrl: "",
  bgOpacity: 70,
  bgFit: "cover",
  bgBlur: 0,
  bgColorEnabled: false,
  bgColor: "#101018",
  forceTransparentEnabled: false,
  forceTransparentOpacity: 0,
  frameEnabled: false,
  frameWidth: 6,
  frameColor: "#7c9cff",
  elBorderEnabled: false,
  elBorderWidth: 1,
  elBorderColor: "#7c9cff",
  textColorEnabled: false,
  textColor: "#ffffff"
};

// Sites whose own layout is nearly 100% opaque panels (Gmail, YouTube,
// WhatsApp Web, ...) need their known top-level containers forced
// transparent, or a background image behind them has no visible gap to
// show through at all. Best-effort: these companies change internal class
// names on redesigns, so a selector here can go stale — if a known site
// stops working after a redesign, that's why.
const SKIN_KNOWN_TRANSPARENT_SITES = new Set([
  "mail.google.com", "youtube.com", "web.whatsapp.com", "google.com",
  "docs.google.com", "drive.google.com", "calendar.google.com",
  "onlinedegree.iitm.ac.in"
]);

let skinCurrentDomain = null;
let skinPendingBgDataUrl = undefined; // undefined = unchanged, "" = explicitly removed
let skinPendingBgVideoDataUrl = undefined; // same convention, for the video field

function getDomainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return null; }
}

async function getActiveTabDomain() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return null;
    return getDomainFromUrl(tab.url);
  } catch { return null; }
}

function skinScope() {
  return document.getElementById("skinScopeSelect").value; // "site" | "default"
}

function skinShowSubRows() {
  document.getElementById("skinFrameWidthRow").style.display = document.getElementById("skinFrameToggle").checked ? "" : "none";
  document.getElementById("skinFrameColorRow").style.display = document.getElementById("skinFrameToggle").checked ? "" : "none";
  document.getElementById("skinElBorderWidthRow").style.display = document.getElementById("skinElBorderToggle").checked ? "" : "none";
  document.getElementById("skinElBorderColorRow").style.display = document.getElementById("skinElBorderToggle").checked ? "" : "none";
  document.getElementById("skinBgColorRow").style.display = document.getElementById("skinBgColorToggle").checked ? "" : "none";
  document.getElementById("skinForceTransparentOpacityRow").style.display = document.getElementById("skinForceTransparentToggle").checked ? "" : "none";
  document.getElementById("skinTextColorRow").style.display = document.getElementById("skinTextColorToggle").checked ? "" : "none";
}

function skinFillForm(s) {
  document.getElementById("skinBgOpacityRange").value = s.bgOpacity;
  document.getElementById("skinBgOpacityVal").textContent = s.bgOpacity;
  document.getElementById("skinBgRemoveRow").style.display = s.bgImageDataUrl ? "" : "none";
  document.getElementById("skinBgName").textContent = s.bgImageDataUrl ? "Custom background set" : "";
  const previewEl = document.getElementById("skinBgPreview");
  if (s.bgImageDataUrl) { previewEl.src = s.bgImageDataUrl; previewEl.style.display = ""; }
  else { previewEl.style.display = "none"; previewEl.src = ""; }
  document.getElementById("skinBgVideoRemoveRow").style.display = s.bgVideoDataUrl ? "" : "none";
  document.getElementById("skinBgVideoName").textContent = s.bgVideoDataUrl
    ? "Video set — this overrides the image above while it's set"
    : "";
  document.getElementById("skinBgFit").value = s.bgFit;
  document.getElementById("skinBgBlurRange").value = s.bgBlur;
  document.getElementById("skinBgBlurVal").textContent = s.bgBlur;
  document.getElementById("skinBgColorToggle").checked = s.bgColorEnabled;
  document.getElementById("skinBgColor").value = s.bgColor;
  document.getElementById("skinBgColorSwatch").style.background = s.bgColor;
  document.getElementById("skinForceTransparentToggle").checked = s.forceTransparentEnabled;
  document.getElementById("skinForceTransparentOpacityRange").value = s.forceTransparentOpacity;
  document.getElementById("skinForceTransparentOpacityVal").textContent = s.forceTransparentOpacity;

  document.getElementById("skinFrameToggle").checked = s.frameEnabled;
  document.getElementById("skinFrameWidthRange").value = s.frameWidth;
  document.getElementById("skinFrameWidthVal").textContent = s.frameWidth;
  document.getElementById("skinFrameColor").value = s.frameColor;
  document.getElementById("skinFrameColorSwatch").style.background = s.frameColor;

  document.getElementById("skinElBorderToggle").checked = s.elBorderEnabled;
  document.getElementById("skinElBorderWidthRange").value = s.elBorderWidth;
  document.getElementById("skinElBorderWidthVal").textContent = s.elBorderWidth;
  document.getElementById("skinElBorderColor").value = s.elBorderColor;
  document.getElementById("skinElBorderColorSwatch").style.background = s.elBorderColor;

  document.getElementById("skinTextColorToggle").checked = s.textColorEnabled;
  document.getElementById("skinTextColor").value = s.textColor;
  document.getElementById("skinTextColorSwatch").style.background = s.textColor;

  skinShowSubRows();
}

async function loadSkinTab() {
  skinPendingBgDataUrl = undefined;
  skinPendingBgVideoDataUrl = undefined;
  const statusEl = document.getElementById("skinStatus");
  statusEl.textContent = "";
  skinCurrentDomain = await getActiveTabDomain();
  const siteEl = document.getElementById("skinCurrentSite");
  const knownHint = document.getElementById("skinKnownSiteHint");
  const saveBtn = document.getElementById("skinSaveBtn");
  const resetBtn = document.getElementById("skinResetBtn");

  if (skinScope() === "default") {
    siteEl.textContent = "Applies to every website you visit";
    knownHint.style.display = "none";
    saveBtn.disabled = false;
    resetBtn.disabled = false;
    const r = await chrome.storage.local.get("siteSkinDefault");
    skinFillForm({ ...SKIN_DEFAULTS, ...(r.siteSkinDefault || {}) });
    await renderPickedList();
    return;
  }

  if (!skinCurrentDomain) {
    siteEl.textContent = "No website open in this tab — open a site first.";
    knownHint.style.display = "none";
    saveBtn.disabled = true;
    resetBtn.disabled = true;
    await renderPickedList();
    return;
  }
  saveBtn.disabled = false;
  resetBtn.disabled = false;
  siteEl.textContent = skinCurrentDomain;

  if (SKIN_KNOWN_TRANSPARENT_SITES.has(skinCurrentDomain)) {
    knownHint.textContent = "✓ This site is in the known-sites list — its own opaque panels get forced transparent so a background image can actually show through.";
    knownHint.style.display = "";
  } else {
    knownHint.textContent = "";
    knownHint.style.display = "none";
  }

  const r = await chrome.storage.local.get("siteSkins");
  const skins = r.siteSkins || {};
  const s = { ...SKIN_DEFAULTS, ...(skins[skinCurrentDomain] || {}) };
  skinFillForm(s);
  await renderPickedList();
}

// Refresh whenever the Skin tab is opened (it needs the *current* active
// tab, which can change between popup opens) or the scope is switched.
document.querySelector('.tab-btn[data-tab="skin"]').addEventListener("click", loadSkinTab);
document.getElementById("skinScopeSelect").addEventListener("change", loadSkinTab);

document.getElementById("skinBgOpacityRange").addEventListener("input", (e) => {
  document.getElementById("skinBgOpacityVal").textContent = e.target.value;
});
document.getElementById("skinBgBlurRange").addEventListener("input", (e) => {
  document.getElementById("skinBgBlurVal").textContent = e.target.value;
});
document.getElementById("skinBgColorToggle").addEventListener("change", skinShowSubRows);
document.getElementById("skinForceTransparentToggle").addEventListener("change", skinShowSubRows);
document.getElementById("skinForceTransparentOpacityRange").addEventListener("input", (e) => {
  document.getElementById("skinForceTransparentOpacityVal").textContent = e.target.value;
});
document.getElementById("skinFrameWidthRange").addEventListener("input", (e) => {
  document.getElementById("skinFrameWidthVal").textContent = e.target.value;
});
document.getElementById("skinElBorderWidthRange").addEventListener("input", (e) => {
  document.getElementById("skinElBorderWidthVal").textContent = e.target.value;
});
document.getElementById("skinFrameToggle").addEventListener("change", skinShowSubRows);
document.getElementById("skinElBorderToggle").addEventListener("change", skinShowSubRows);
document.getElementById("skinTextColorToggle").addEventListener("change", skinShowSubRows);

document.getElementById("skinBgUpload").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById("skinStatus");
  try {
    skinPendingBgDataUrl = await fileToBgDataUrl(file);
    document.getElementById("skinBgName").textContent = "New background selected — click Save to apply";
    document.getElementById("skinBgRemoveRow").style.display = "";
    const previewEl = document.getElementById("skinBgPreview");
    previewEl.src = skinPendingBgDataUrl;
    previewEl.style.display = "";
    statusEl.textContent = "";
  } catch (err) {
    statusEl.textContent = "⚠ " + err.message;
  }
});

document.getElementById("skinRemoveBgBtn").addEventListener("click", () => {
  skinPendingBgDataUrl = ""; // marks explicit removal, applied on Save
  document.getElementById("skinBgName").textContent = "Background will be removed on Save";
  document.getElementById("skinBgRemoveRow").style.display = "none";
  document.getElementById("skinBgPreview").style.display = "none";
});

document.getElementById("skinBgVideoUpload").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById("skinStatus");
  try {
    skinPendingBgVideoDataUrl = await fileToBgVideoDataUrl(file);
    document.getElementById("skinBgVideoName").textContent = "New video selected — click Save to apply";
    document.getElementById("skinBgVideoRemoveRow").style.display = "";
    statusEl.textContent = "";
  } catch (err) {
    statusEl.textContent = "⚠ " + err.message;
  }
});

document.getElementById("skinRemoveBgVideoBtn").addEventListener("click", () => {
  skinPendingBgVideoDataUrl = ""; // marks explicit removal, applied on Save
  document.getElementById("skinBgVideoName").textContent = "Video will be removed on Save";
  document.getElementById("skinBgVideoRemoveRow").style.display = "none";
});

function skinReadForm(existing) {
  return {
    ...existing,
    bgImageDataUrl: skinPendingBgDataUrl !== undefined ? skinPendingBgDataUrl : existing.bgImageDataUrl,
    bgVideoDataUrl: skinPendingBgVideoDataUrl !== undefined ? skinPendingBgVideoDataUrl : existing.bgVideoDataUrl,
    bgOpacity: Number(document.getElementById("skinBgOpacityRange").value),
    bgFit: document.getElementById("skinBgFit").value,
    bgBlur: Number(document.getElementById("skinBgBlurRange").value),
    bgColorEnabled: document.getElementById("skinBgColorToggle").checked,
    bgColor: sanitizeHex(document.getElementById("skinBgColor").value, existing.bgColor),
    forceTransparentEnabled: document.getElementById("skinForceTransparentToggle").checked,
    forceTransparentOpacity: Number(document.getElementById("skinForceTransparentOpacityRange").value),
    frameEnabled: document.getElementById("skinFrameToggle").checked,
    frameWidth: Number(document.getElementById("skinFrameWidthRange").value),
    frameColor: sanitizeHex(document.getElementById("skinFrameColor").value, existing.frameColor),
    elBorderEnabled: document.getElementById("skinElBorderToggle").checked,
    elBorderWidth: Number(document.getElementById("skinElBorderWidthRange").value),
    elBorderColor: sanitizeHex(document.getElementById("skinElBorderColor").value, existing.elBorderColor),
    textColorEnabled: document.getElementById("skinTextColorToggle").checked,
    textColor: sanitizeHex(document.getElementById("skinTextColor").value, existing.textColor)
  };
}

document.getElementById("skinSaveBtn").addEventListener("click", async () => {
  const statusEl = document.getElementById("skinStatus");

  if (skinScope() === "default") {
    const r = await chrome.storage.local.get("siteSkinDefault");
    const existing = { ...SKIN_DEFAULTS, ...(r.siteSkinDefault || {}) };
    const updated = skinReadForm(existing);
    await chrome.storage.local.set({ siteSkinDefault: updated });
    skinPendingBgDataUrl = undefined;
  skinPendingBgVideoDataUrl = undefined;
    statusEl.textContent = "✅ Saved as the default for every website (sites with their own override still use their own).";
    loadSkinTab();
    return;
  }

  if (!skinCurrentDomain) return;
  const r = await chrome.storage.local.get("siteSkins");
  const skins = r.siteSkins || {};
  const existing = { ...SKIN_DEFAULTS, ...(skins[skinCurrentDomain] || {}) };
  const updated = skinReadForm(existing);
  skins[skinCurrentDomain] = updated;
  await chrome.storage.local.set({ siteSkins: skins });
  skinPendingBgDataUrl = undefined;
  skinPendingBgVideoDataUrl = undefined;
  statusEl.textContent = "✅ Saved for " + skinCurrentDomain + " — already-open tabs on it update live.";
  loadSkinTab();
});

document.getElementById("skinResetBtn").addEventListener("click", async () => {
  const statusEl = document.getElementById("skinStatus");

  if (skinScope() === "default") {
    if (!confirm("Reset the default skin used for every website?")) return;
    await chrome.storage.local.remove("siteSkinDefault");
    statusEl.textContent = "Default skin reset.";
    loadSkinTab();
    return;
  }

  if (!skinCurrentDomain) return;
  if (!confirm(`Reset the skin for "${skinCurrentDomain}" back to the default?`)) return;
  const r = await chrome.storage.local.get("siteSkins");
  const skins = r.siteSkins || {};
  delete skins[skinCurrentDomain];
  await chrome.storage.local.set({ siteSkins: skins });
  statusEl.textContent = "Reset for this site — it now follows the default skin (if any).";
  loadSkinTab();
});

// ---- Picked elements list ----
async function renderPickedList() {
  const listEl = document.getElementById("skinPickedList");
  const emptyEl = document.getElementById("skinPickedEmpty");
  const pickBtn = document.getElementById("skinPickBtn");
  const removeBtn = document.getElementById("skinRemovePickBtn");
  const pickHint = document.getElementById("skinPickHint");

  if (skinScope() === "default") {
    listEl.innerHTML = "";
    emptyEl.style.display = "none";
    pickBtn.disabled = true;
    removeBtn.disabled = true;
    pickHint.textContent = 'Picked elements are per-site — switch "Applies to" back to "Only this site" to use this.';
    return;
  }
  if (!skinCurrentDomain) {
    listEl.innerHTML = "";
    emptyEl.style.display = "none";
    pickBtn.disabled = true;
    removeBtn.disabled = true;
    return;
  }

  pickBtn.disabled = false;
  removeBtn.disabled = false;
  pickHint.textContent = "Clicking either button closes the popup (normal Chrome behavior) — a small banner appears on the page. Click the element you want, then reopen this tab.";

  const r = await chrome.storage.local.get("siteSkins");
  const skins = r.siteSkins || {};
  const picked = (skins[skinCurrentDomain] && skins[skinCurrentDomain].pickedElements) || [];

  listEl.innerHTML = "";
  emptyEl.style.display = picked.length ? "none" : "";

  picked.forEach((pe, idx) => {
    const item = document.createElement("div");
    item.className = "skin-picked-item";
    const safeLabel = String(pe.label || "element").replace(/</g, "&lt;");

    if (pe.removed) {
      item.innerHTML =
        `<div class="skin-picked-item-top">` +
          `<span class="skin-picked-swatch" style="background:#3a1414;display:flex;align-items:center;justify-content:center;font-size:12px">🗑️</span>` +
          `<span class="skin-picked-item-label">${safeLabel}</span>` +
          `<button class="timetable-del-btn" data-idx="${idx}" title="Restore">✕</button>` +
        `</div>` +
        `<div class="skin-picked-item-opacity">Removed from the page</div>`;
      listEl.appendChild(item);
      return;
    }

    const hasCustomImage = !!pe.customImageDataUrl;
    const isOriginalImage = pe.kind === "image" && pe.originalImage;
    const showingOriginalImage = !hasCustomImage && isOriginalImage && !pe.removeImage && !pe.useCustomColor;

    let swatchStyle;
    if (hasCustomImage) {
      const z = pe.imageZoom ?? 100, px = pe.imagePosX ?? 50, py = pe.imagePosY ?? 50;
      swatchStyle = `background-image:url(${pe.customImageDataUrl.replace(/"/g, "&quot;")});background-size:${z}%;background-position:${px}% ${py}%`;
    } else if (showingOriginalImage) {
      swatchStyle = `background-image:${pe.originalImage.replace(/"/g, "&quot;")};background-size:cover;background-position:center`;
    } else {
      swatchStyle = `background:${pe.useCustomColor ? pe.customColor : (pe.originalColor || "#888")}`;
    }

    const kindLabel = hasCustomImage ? "Your image" : (isOriginalImage ? "Image background" : "Solid color");

    item.innerHTML =
      `<div class="skin-picked-item-top">` +
        `<span class="skin-picked-swatch" style="${swatchStyle}"></span>` +
        `<span class="skin-picked-item-label">${safeLabel}</span>` +
        `<button class="timetable-del-btn" data-idx="${idx}" title="Remove">✕</button>` +
      `</div>` +
      `<div class="skin-picked-item-opacity">${kindLabel}</div>` +
      (isOriginalImage && !hasCustomImage
        ? `<label class="settings-row-inline skin-picked-sub">` +
            `<span>Use a color instead of the image</span>` +
            `<input type="checkbox" class="pk-remove-image" data-idx="${idx}" ${pe.removeImage ? "checked" : ""} />` +
          `</label>`
        : "") +
      `<label class="settings-row-inline skin-picked-sub">` +
        `<span>Custom color</span>` +
        `<input type="checkbox" class="pk-custom-toggle" data-idx="${idx}" ${pe.useCustomColor ? "checked" : ""} />` +
      `</label>` +
      (pe.useCustomColor
        ? `<div class="skin-color-field" style="margin-top:4px">` +
            `<div class="color-input-row">` +
              `<span title="🎨 Click for the full color picker" class="color-swatch-preview pk-color-swatch" data-idx="${idx}" style="background:${pe.customColor}"></span>` +
              `<input type="text" class="color-hex-input pk-color" data-idx="${idx}" value="${pe.customColor}" maxlength="7" placeholder="#rrggbb" />` +
            `</div>` +
            buildColorPaletteHtml() +
          `</div>`
        : "") +
      `<label class="settings-row-inline skin-picked-sub" style="margin-top:6px">` +
        `<span>${hasCustomImage ? "Replace your image" : "Upload an image for this box"}</span>` +
      `</label>` +
      `<input type="file" accept="image/*" class="pk-image-upload" data-idx="${idx}" />` +
      (hasCustomImage
        ? `<button class="btn btn-danger pk-remove-custom-image" data-idx="${idx}" style="width:100%;margin-top:4px;font-size:10px;padding:5px">Remove your image</button>` +
          `<div class="skin-picked-item-opacity" style="margin-top:6px">Sizing</div>` +
          `<select class="picker pk-image-sizemode" data-idx="${idx}" style="width:100%">` +
            `<option value="percent" ${(pe.imageSizeMode || "percent") === "percent" ? "selected" : ""}>Auto-fit this box (%)</option>` +
            `<option value="height" ${pe.imageSizeMode === "height" ? "selected" : ""}>Same height everywhere (px)</option>` +
            `<option value="width" ${pe.imageSizeMode === "width" ? "selected" : ""}>Same width everywhere (px)</option>` +
          `</select>` +
          ((pe.imageSizeMode || "percent") === "percent"
            ? `<div class="skin-picked-item-opacity">Zoom (<span class="pk-zoom-val">${pe.imageZoom ?? 100}</span>%)</div>` +
              `<input type="range" min="50" max="400" value="${pe.imageZoom ?? 100}" class="settings-slider pk-image-zoom" data-idx="${idx}" />`
            : `<div class="skin-picked-item-opacity">Size (<span class="pk-sizepx-val">${pe.imageSizePx ?? 200}</span>px)</div>` +
              `<input type="range" min="20" max="800" value="${pe.imageSizePx ?? 200}" class="settings-slider pk-image-sizepx" data-idx="${idx}" />`
          ) +
          `<div class="skin-picked-item-opacity">Position — left/right (<span class="pk-posx-val">${pe.imagePosX ?? 50}</span>%)</div>` +
          `<input type="range" min="0" max="100" value="${pe.imagePosX ?? 50}" class="settings-slider pk-image-posx" data-idx="${idx}" />` +
          `<div class="skin-picked-item-opacity">Position — up/down (<span class="pk-posy-val">${pe.imagePosY ?? 50}</span>%)</div>` +
          `<input type="range" min="0" max="100" value="${pe.imagePosY ?? 50}" class="settings-slider pk-image-posy" data-idx="${idx}" />` +
          `<label class="settings-row-inline skin-picked-sub" style="margin-top:6px">` +
            `<span>📋 Sync this image to every picked box</span>` +
            `<input type="checkbox" class="pk-image-sync-toggle" data-idx="${idx}" ${pe.imageSyncEnabled ? "checked" : ""} />` +
          `</label>`
        : "") +
      `<div class="skin-picked-item-opacity">Opacity: <span class="op-val">${pe.opacity}</span>%</div>` +
      `<input type="range" min="0" max="100" value="${pe.opacity}" class="settings-slider pk-opacity" data-idx="${idx}" />` +
      `<label class="settings-row-inline skin-picked-sub" style="margin-top:6px">` +
        `<span>Font color for this box</span>` +
        `<input type="checkbox" class="pk-text-toggle" data-idx="${idx}" ${pe.textColorEnabled ? "checked" : ""} />` +
      `</label>` +
      (pe.textColorEnabled
        ? `<div class="skin-color-field" style="margin-top:4px">` +
            `<div class="color-input-row">` +
              `<span title="🎨 Click for the full color picker" class="color-swatch-preview pk-text-swatch" data-idx="${idx}" style="background:${pe.textColor || "#ffffff"}"></span>` +
              `<input type="text" class="color-hex-input pk-text-color" data-idx="${idx}" value="${pe.textColor || "#ffffff"}" maxlength="7" placeholder="#rrggbb" />` +
            `</div>` +
            buildColorPaletteHtml() +
          `</div>`
        : "");
    listEl.appendChild(item);
  });

  async function patchPickedEntry(idx, patch) {
    const r2 = await chrome.storage.local.get("siteSkins");
    const skins2 = r2.siteSkins || {};
    if (skins2[skinCurrentDomain] && skins2[skinCurrentDomain].pickedElements && skins2[skinCurrentDomain].pickedElements[idx]) {
      Object.assign(skins2[skinCurrentDomain].pickedElements[idx], patch);
      await chrome.storage.local.set({ siteSkins: skins2 });
    }
  }

  listEl.querySelectorAll('input[type="range"].pk-opacity').forEach((slider) => {
    slider.addEventListener("input", (e) => {
      e.target.closest(".skin-picked-item").querySelector(".op-val").textContent = e.target.value;
    });
    slider.addEventListener("change", async (e) => {
      await patchPickedEntry(Number(e.target.dataset.idx), { opacity: Number(e.target.value) });
    });
  });

  listEl.querySelectorAll(".pk-remove-image").forEach((cb) => {
    cb.addEventListener("change", async (e) => {
      await patchPickedEntry(Number(e.target.dataset.idx), { removeImage: e.target.checked });
      renderPickedList();
    });
  });

  listEl.querySelectorAll(".pk-custom-toggle").forEach((cb) => {
    cb.addEventListener("change", async (e) => {
      await patchPickedEntry(Number(e.target.dataset.idx), { useCustomColor: e.target.checked });
      renderPickedList();
    });
  });

  listEl.querySelectorAll(".pk-color").forEach((input) => {
    input.addEventListener("input", (e) => {
      const v = sanitizeHex(e.target.value, null);
      if (v) e.target.closest(".skin-picked-item").querySelector(".pk-color-swatch").style.background = v;
    });
    input.addEventListener("change", async (e) => {
      const v = sanitizeHex(e.target.value, "#7c9cff");
      e.target.value = v;
      await patchPickedEntry(Number(e.target.dataset.idx), { customColor: v });
      renderPickedList();
    });
  });

  listEl.querySelectorAll(".pk-text-toggle").forEach((cb) => {
    cb.addEventListener("change", async (e) => {
      await patchPickedEntry(Number(e.target.dataset.idx), { textColorEnabled: e.target.checked });
      renderPickedList();
    });
  });

  listEl.querySelectorAll(".pk-text-color").forEach((input) => {
    input.addEventListener("input", (e) => {
      const v = sanitizeHex(e.target.value, null);
      if (v) e.target.closest(".skin-picked-item").querySelector(".pk-text-swatch").style.background = v;
    });
    input.addEventListener("change", async (e) => {
      const v = sanitizeHex(e.target.value, "#ffffff");
      e.target.value = v;
      await patchPickedEntry(Number(e.target.dataset.idx), { textColor: v });
      renderPickedList();
    });
  });

  // When a box has "sync" turned on, any image/zoom/position change made
  // to IT also propagates to every OTHER box that also has sync turned
  // on — this is what makes the checkbox an ongoing link rather than a
  // one-time copy: re-upload or re-adjust later and the synced boxes
  // follow automatically instead of drifting apart.
  async function patchPickedImageSynced(idx, patch) {
    const r2 = await chrome.storage.local.get("siteSkins");
    const skins2 = r2.siteSkins || {};
    const list = skins2[skinCurrentDomain] && skins2[skinCurrentDomain].pickedElements;
    if (!list || !list[idx]) return;
    Object.assign(list[idx], patch);
    if (list[idx].imageSyncEnabled) {
      const src = list[idx];
      list.forEach((entry, i) => {
        if (i === idx || entry.removed || !entry.imageSyncEnabled) return;
        entry.customImageDataUrl = src.customImageDataUrl;
        entry.imageZoom = src.imageZoom;
        entry.imagePosX = src.imagePosX;
        entry.imagePosY = src.imagePosY;
        entry.imageSizeMode = src.imageSizeMode;
        entry.imageSizePx = src.imageSizePx;
      });
    }
    await chrome.storage.local.set({ siteSkins: skins2 });
  }

  listEl.querySelectorAll(".pk-image-upload").forEach((fileInput) => {
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await fileToBgDataUrl(file);
        await patchPickedImageSynced(Number(e.target.dataset.idx), { customImageDataUrl: dataUrl });
      } catch (err) {
        alert("Couldn't read that image: " + err.message);
      }
      renderPickedList();
    });
  });

  listEl.querySelectorAll(".pk-remove-custom-image").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      // Removing the image also drops this box out of the sync group —
      // an empty box has nothing meaningful left to keep in sync.
      await patchPickedImageSynced(Number(e.currentTarget.dataset.idx), { customImageDataUrl: "", imageSyncEnabled: false });
      renderPickedList();
    });
  });

  listEl.querySelectorAll(".pk-image-sizemode").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      await patchPickedImageSynced(Number(e.target.dataset.idx), { imageSizeMode: e.target.value });
      renderPickedList();
    });
  });
  listEl.querySelectorAll(".pk-image-sizepx").forEach((slider) => {
    slider.addEventListener("input", (e) => {
      e.target.closest(".skin-picked-item").querySelector(".pk-sizepx-val").textContent = e.target.value;
    });
    slider.addEventListener("change", async (e) => {
      await patchPickedImageSynced(Number(e.target.dataset.idx), { imageSizePx: Number(e.target.value) });
    });
  });
  listEl.querySelectorAll(".pk-image-zoom").forEach((slider) => {
    slider.addEventListener("input", (e) => {
      const item = e.target.closest(".skin-picked-item");
      item.querySelector(".pk-zoom-val").textContent = e.target.value;
      item.querySelector(".skin-picked-swatch").style.backgroundSize = e.target.value + "%";
    });
    slider.addEventListener("change", async (e) => {
      await patchPickedImageSynced(Number(e.target.dataset.idx), { imageZoom: Number(e.target.value) });
    });
  });
  listEl.querySelectorAll(".pk-image-posx").forEach((slider) => {
    slider.addEventListener("input", (e) => {
      const item = e.target.closest(".skin-picked-item");
      item.querySelector(".pk-posx-val").textContent = e.target.value;
      const swatch = item.querySelector(".skin-picked-swatch");
      const y = item.querySelector(".pk-image-posy")?.value ?? 50;
      swatch.style.backgroundPosition = `${e.target.value}% ${y}%`;
    });
    slider.addEventListener("change", async (e) => {
      await patchPickedImageSynced(Number(e.target.dataset.idx), { imagePosX: Number(e.target.value) });
    });
  });
  listEl.querySelectorAll(".pk-image-posy").forEach((slider) => {
    slider.addEventListener("input", (e) => {
      const item = e.target.closest(".skin-picked-item");
      item.querySelector(".pk-posy-val").textContent = e.target.value;
      const swatch = item.querySelector(".skin-picked-swatch");
      const x = item.querySelector(".pk-image-posx")?.value ?? 50;
      swatch.style.backgroundPosition = `${x}% ${e.target.value}%`;
    });
    slider.addEventListener("change", async (e) => {
      await patchPickedImageSynced(Number(e.target.dataset.idx), { imagePosY: Number(e.target.value) });
    });
  });

  listEl.querySelectorAll(".pk-image-sync-toggle").forEach((cb) => {
    cb.addEventListener("change", async (e) => {
      const idx = Number(e.target.dataset.idx);
      const enabled = e.target.checked;
      if (!enabled) {
        // Just leaves the group — doesn't touch anyone else.
        await patchPickedEntry(idx, { imageSyncEnabled: false });
        renderPickedList();
        return;
      }
      // Joining an existing sync group: adopt whatever image the group
      // is already sharing (if any), with neutral zoom/position so it
      // auto-fits this box's own size rather than inheriting a crop that
      // was tuned for a differently-shaped box.
      const r2 = await chrome.storage.local.get("siteSkins");
      const skins2 = r2.siteSkins || {};
      const list = skins2[skinCurrentDomain] && skins2[skinCurrentDomain].pickedElements;
      if (list && list[idx]) {
        const existingSource = list.find((entry, i) => i !== idx && !entry.removed && entry.imageSyncEnabled);
        list[idx].imageSyncEnabled = true;
        if (existingSource) {
          list[idx].customImageDataUrl = existingSource.customImageDataUrl;
          list[idx].imageZoom = 100;
          list[idx].imagePosX = 50;
          list[idx].imagePosY = 50;
          list[idx].imageSizeMode = existingSource.imageSizeMode;
          list[idx].imageSizePx = existingSource.imageSizePx;
        }
        await chrome.storage.local.set({ siteSkins: skins2 });
      }
      renderPickedList();
    });
  });

  listEl.querySelectorAll(".timetable-del-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const idx = Number(e.currentTarget.dataset.idx);
      const r2 = await chrome.storage.local.get("siteSkins");
      const skins2 = r2.siteSkins || {};
      if (skins2[skinCurrentDomain] && skins2[skinCurrentDomain].pickedElements) {
        skins2[skinCurrentDomain].pickedElements.splice(idx, 1);
        await chrome.storage.local.set({ siteSkins: skins2 });
      }
      renderPickedList();
    });
  });

  await renderGroupList();
}

document.getElementById("skinPickBtn").addEventListener("click", async () => {
  if (!skinCurrentDomain || skinScope() !== "site") return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: "ARUNPRO_START_PICKER", mode: "style" });
  } catch {
    // Site may not have the content script yet (e.g. chrome:// pages) —
    // nothing more we can do; the popup is about to close anyway.
  }
  window.close();
});

document.getElementById("skinRemovePickBtn").addEventListener("click", async () => {
  if (!skinCurrentDomain || skinScope() !== "site") return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: "ARUNPRO_START_PICKER", mode: "remove" });
  } catch {
    // Same rationale as above.
  }
  window.close();
});

// ---- Group picking ("🧩 Auto-pick a group" — new this session) — one
// click on a CONTAINER auto-grabs its direct child boxes as a single
// group. Upload one image and it lays across every box in the group
// like one continuous picture cut into pieces (mosaic), auto-cropped
// per box — no manual cropping. Storage shape:
//   siteSkins[domain].pickedGroups = [{ label, selectors: [...],
//     customImageDataUrl, opacity, textColorEnabled, textColor }]
// The actual pick (and the mosaic math) happens in site-skin.js, same
// as single-element picking — this button just starts the picker.
const skinGroupPickBtnEl = document.getElementById("skinGroupPickBtn");
if (skinGroupPickBtnEl) {
  skinGroupPickBtnEl.addEventListener("click", async () => {
    if (!skinCurrentDomain || skinScope() !== "site") return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { type: "ARUNPRO_START_PICKER", mode: "group" });
    } catch {
      // Same rationale as the single-element picker above.
    }
    window.close();
  });
}

async function renderGroupList() {
  const listEl = document.getElementById("skinGroupList");
  const emptyEl = document.getElementById("skinGroupEmpty");
  if (!listEl || !emptyEl) return; // guard in case this markup isn't present

  if (skinScope() === "default" || !skinCurrentDomain) {
    listEl.innerHTML = "";
    emptyEl.style.display = "none";
    return;
  }

  const r = await chrome.storage.local.get("siteSkins");
  const skins = r.siteSkins || {};
  const groups = (skins[skinCurrentDomain] && skins[skinCurrentDomain].pickedGroups) || [];

  listEl.innerHTML = "";
  emptyEl.style.display = groups.length ? "none" : "";

  groups.forEach((g, idx) => {
    const item = document.createElement("div");
    item.className = "skin-picked-item";
    const safeLabel = String(g.label || "group").replace(/</g, "&lt;");
    const swatchStyle = g.customImageDataUrl
      ? `background-image:url(${g.customImageDataUrl.replace(/"/g, "&quot;")});background-size:cover;background-position:center`
      : `background:#333`;

    item.innerHTML =
      `<div class="skin-picked-item-top">` +
        `<span class="skin-picked-swatch" style="${swatchStyle}"></span>` +
        `<span class="skin-picked-item-label">${safeLabel}</span>` +
        `<button class="timetable-del-btn" data-idx="${idx}" title="Remove">✕</button>` +
      `</div>` +
      `<label class="settings-row-inline skin-picked-sub" style="margin-top:6px">` +
        `<span>${g.customImageDataUrl ? "Replace group image" : "Upload one image for this group"}</span>` +
      `</label>` +
      `<input type="file" accept="image/*" class="pk-group-image-upload" data-idx="${idx}" />` +
      (g.customImageDataUrl
        ? `<button class="btn btn-danger pk-group-remove-image" data-idx="${idx}" style="width:100%;margin-top:4px;font-size:10px;padding:5px">Remove group image</button>`
        : "") +
      `<div class="skin-picked-item-opacity">Opacity: <span class="op-val">${g.opacity}</span>%</div>` +
      `<input type="range" min="0" max="100" value="${g.opacity}" class="settings-slider pk-group-opacity" data-idx="${idx}" />` +
      `<label class="settings-row-inline skin-picked-sub" style="margin-top:6px">` +
        `<span>Font color for this group</span>` +
        `<input type="checkbox" class="pk-group-text-toggle" data-idx="${idx}" ${g.textColorEnabled ? "checked" : ""} />` +
      `</label>` +
      (g.textColorEnabled
        ? `<div class="skin-color-field" style="margin-top:4px">` +
            `<div class="color-input-row">` +
              `<span title="🎨 Click for the full color picker" class="color-swatch-preview pk-group-text-swatch" data-idx="${idx}" style="background:${g.textColor || "#ffffff"}"></span>` +
              `<input type="text" class="color-hex-input pk-group-text-color" data-idx="${idx}" value="${g.textColor || "#ffffff"}" maxlength="7" placeholder="#rrggbb" />` +
            `</div>` +
            buildColorPaletteHtml() +
          `</div>`
        : "");
    listEl.appendChild(item);
  });

  async function patchGroupEntry(idx, patch) {
    const r2 = await chrome.storage.local.get("siteSkins");
    const skins2 = r2.siteSkins || {};
    if (skins2[skinCurrentDomain] && skins2[skinCurrentDomain].pickedGroups && skins2[skinCurrentDomain].pickedGroups[idx]) {
      Object.assign(skins2[skinCurrentDomain].pickedGroups[idx], patch);
      await chrome.storage.local.set({ siteSkins: skins2 });
    }
  }

  listEl.querySelectorAll('input[type="range"].pk-group-opacity').forEach((slider) => {
    slider.addEventListener("input", (e) => {
      e.target.closest(".skin-picked-item").querySelector(".op-val").textContent = e.target.value;
    });
    slider.addEventListener("change", async (e) => {
      await patchGroupEntry(Number(e.target.dataset.idx), { opacity: Number(e.target.value) });
    });
  });

  listEl.querySelectorAll(".pk-group-image-upload").forEach((fileInput) => {
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await fileToBgDataUrl(file);
        await patchGroupEntry(Number(e.target.dataset.idx), { customImageDataUrl: dataUrl });
      } catch (err) {
        alert("Couldn't read that image: " + err.message);
      }
      renderGroupList();
    });
  });

  listEl.querySelectorAll(".pk-group-remove-image").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      await patchGroupEntry(Number(e.currentTarget.dataset.idx), { customImageDataUrl: "" });
      renderGroupList();
    });
  });

  listEl.querySelectorAll(".pk-group-text-toggle").forEach((cb) => {
    cb.addEventListener("change", async (e) => {
      await patchGroupEntry(Number(e.target.dataset.idx), { textColorEnabled: e.target.checked });
      renderGroupList();
    });
  });

  listEl.querySelectorAll(".pk-group-text-color").forEach((input) => {
    input.addEventListener("input", (e) => {
      const v = sanitizeHex(e.target.value, null);
      if (v) e.target.closest(".skin-picked-item").querySelector(".pk-group-text-swatch").style.background = v;
    });
    input.addEventListener("change", async (e) => {
      const v = sanitizeHex(e.target.value, "#ffffff");
      e.target.value = v;
      await patchGroupEntry(Number(e.target.dataset.idx), { textColor: v });
      renderGroupList();
    });
  });

  listEl.querySelectorAll(".timetable-del-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const idx = Number(e.currentTarget.dataset.idx);
      const r2 = await chrome.storage.local.get("siteSkins");
      const skins2 = r2.siteSkins || {};
      if (skins2[skinCurrentDomain] && skins2[skinCurrentDomain].pickedGroups) {
        skins2[skinCurrentDomain].pickedGroups.splice(idx, 1);
        await chrome.storage.local.set({ siteSkins: skins2 });
      }
      renderGroupList();
    });
  });
}


// =============================================
// POMO TAB
// =============================================

const RING_CIRCUM = 339.3;
let pomoUI = { running: false, phase: "study", remaining: 25*60, endTime: null, studySec: 25*60, breakSec: 5*60 };
let pomoTickInterval = null;

function playAlarm(type) {
  try {
    const ctx2 = new (window.AudioContext || window.webkitAudioContext)();
    const freqs = type === "study" ? [880, 660, 440] : [440, 660, 880];
    freqs.forEach((f, i) => {
      const osc = ctx2.createOscillator(), gain = ctx2.createGain();
      osc.connect(gain); gain.connect(ctx2.destination);
      osc.type = "sine"; osc.frequency.value = f;
      const t = ctx2.currentTime + i * 0.25;
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.start(t); osc.stop(t + 0.4);
    });
  } catch {}
}

async function loadPomoHistory() {
  const histEl = document.getElementById("pomoHistory");
  const r = await chrome.storage.local.get("pomoHistory");
  const history = r.pomoHistory || {};
  const items = history[getTodayKey()] || [];
  if (!items.length) {
    histEl.innerHTML = '<div class="empty-state">No sessions yet today.</div>';
    return;
  }
  histEl.innerHTML = items.map(item => `
    <div class="pomo-hist-item">
      <span class="ph-type ${item.phase}">${item.phase === "study" ? "📗 Study" : "☕ Break"}</span>
      <span>completed</span>
      <span class="ph-time">${item.time}</span>
    </div>`).join("");
}

function updatePomoUI() {
  const min = String(Math.floor(pomoUI.remaining / 60)).padStart(2, "0");
  const sec = String(pomoUI.remaining % 60).padStart(2, "0");
  document.getElementById("pomoTime").textContent  = `${min}:${sec}`;
  document.getElementById("pomoLabel").textContent = pomoUI.phase === "study" ? "STUDY" : "BREAK";

  const total  = pomoUI.phase === "study" ? (pomoUI.studySec || 25*60) : (pomoUI.breakSec || 5*60);
  const offset = RING_CIRCUM * (pomoUI.remaining / total);
  const ring   = document.getElementById("ringProgress");
  ring.style.strokeDashoffset = RING_CIRCUM - offset;
  ring.style.stroke = pomoUI.phase === "study"
    ? (cssVar("--gold")  || "#7c9cff")
    : (cssVar("--green") || "#4caf82");

  const total2 = pomoUI.phase === "study" ? (pomoUI.studySec || 25*60) : (pomoUI.breakSec || 5*60);
  document.getElementById("pomoStart").textContent = pomoUI.running
    ? "⏸ Pause"
    : (pomoUI.remaining < total2 ? "▶ Resume" : "▶ Start");

  // Sync inputs
  if (!pomoUI.running) {
    document.getElementById("studyMinInput").value = Math.round((pomoUI.studySec || 25*60) / 60);
    document.getElementById("breakMinInput").value = Math.round((pomoUI.breakSec || 5*60) / 60);
  }
}

function startTick() {
  stopTick();
  pomoTickInterval = setInterval(() => {
    if (!pomoUI.running || !pomoUI.endTime) return;
    pomoUI.remaining = Math.max(0, Math.round((pomoUI.endTime - Date.now()) / 1000));
    updatePomoUI();
  }, 1000);
}
function stopTick() {
  if (pomoTickInterval) { clearInterval(pomoTickInterval); pomoTickInterval = null; }
}

function applyPomoState(state) {
  const prevPhase  = pomoUI.phase;
  const wasRunning = pomoUI.running;
  pomoUI = { ...state };
  if (pomoUI.subjectId !== undefined) {
    activeSubjectId = pomoUI.subjectId || null;
    renderSubjectChips();
  }
  if (pomoUI.running && pomoUI.endTime) {
    pomoUI.remaining = Math.max(0, Math.round((pomoUI.endTime - Date.now()) / 1000));
    startTick();
  } else {
    stopTick();
  }
  updatePomoUI();
  if (wasRunning && !pomoUI.running) {
    document.getElementById("pomoStatus").textContent =
      prevPhase === "study" ? "✅ Study complete! Take a break." : "⏰ Break over! Back to work.";
    playAlarm(prevPhase);
    loadPomoHistory();
  }
}

async function syncPomoState() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "POMO_GET_STATE" });
    applyPomoState(state);
  } catch {}
}

document.getElementById("pomoStart").addEventListener("click", async () => {
  if (pomoUI.running) {
    const state = await chrome.runtime.sendMessage({ type: "POMO_PAUSE" });
    applyPomoState(state);
    document.getElementById("pomoStatus").textContent = "Paused.";
  } else {
    const state = await chrome.runtime.sendMessage({ type: "POMO_START", subjectId: activeSubjectId });
    applyPomoState(state);
    document.getElementById("pomoStatus").textContent = "";
  }
});

document.getElementById("pomoReset").addEventListener("click", async () => {
  const state = await chrome.runtime.sendMessage({ type: "POMO_RESET" });
  applyPomoState(state);
  document.getElementById("pomoStatus").textContent = "";
});

// Pomodoro duration editor
document.getElementById("applyDurBtn").addEventListener("click", async () => {
  if (pomoUI.running) {
    document.getElementById("pomoStatus").textContent = "⚠ Stop timer before changing duration.";
    return;
  }
  const studyMin = parseInt(document.getElementById("studyMinInput").value) || 25;
  const breakMin = parseInt(document.getElementById("breakMinInput").value) || 5;
  const studySec = Math.max(1, studyMin) * 60;
  const breakSec = Math.max(1, breakMin) * 60;
  const state = await chrome.runtime.sendMessage({ type: "POMO_SET_DURATIONS", studySec, breakSec });
  applyPomoState(state);
  document.getElementById("pomoStatus").textContent = `✓ Set: ${studyMin}m study / ${breakMin}m break`;
  setTimeout(() => { document.getElementById("pomoStatus").textContent = ""; }, 2500);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.pomoState)   applyPomoState(changes.pomoState.newValue);
  if (changes.pomoHistory) loadPomoHistory();
  if (changes.pomoStudySeconds) loadPomoStats();
  if (changes.subjectTime) {
    renderSubjectList();
    const canvas = document.getElementById("subjectGraph");
    if (canvas && canvas.style.display !== "none") drawSubjectGraph();
  }
  if (changes.timetables) loadTimetables();
});

syncPomoState();
loadPomoHistory();

// =============================================
// POMO: TIME STATS (Total / Yesterday / Today)
// =============================================

async function loadPomoStats() {
  try {
    const stats = await chrome.runtime.sendMessage({ type: "GET_POMO_STATS" });
    document.getElementById("pomoStatTotal").textContent     = fmtSec(stats.total || 0);
    document.getElementById("pomoStatYesterday").textContent = fmtSec(stats.yesterday || 0);
    document.getElementById("pomoStatToday").textContent     = fmtSec(stats.today || 0);
  } catch {}
}

setInterval(() => { if (pomoUI.running) loadPomoStats(); }, 1000);
loadPomoStats();

// =============================================
// POMO: SUBJECTS
// =============================================

let activeSubjectId = null;
let lastSubjects = [];

async function loadSubjects() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "GET_SUBJECTS" });
    lastSubjects = resp.subjects || [];
  } catch { lastSubjects = []; }
  renderSubjectChips();
  await renderSubjectList();
  populateSiteSubjectSelect();
  await loadSiteSubjects();
}

function renderSubjectChips() {
  const wrap = document.getElementById("subjectChips");
  if (!wrap) return;
  if (!lastSubjects.length) {
    wrap.innerHTML = '<span class="empty-state" style="padding:0">No subjects yet — add one below.</span>';
    return;
  }
  const noneChip = `<button class="subject-chip ${!activeSubjectId ? "active" : ""}" data-id="">— None —</button>`;
  wrap.innerHTML = noneChip + lastSubjects.map(s => `
    <button class="subject-chip ${activeSubjectId === s.id ? "active" : ""}" data-id="${s.id}">
      <span class="subject-dot" style="background:${s.color}"></span>${escapeHtml(s.name)}
    </button>`).join("");

  wrap.querySelectorAll(".subject-chip").forEach(chip => {
    chip.addEventListener("click", async () => {
      activeSubjectId = chip.dataset.id || null;
      renderSubjectChips();
      try { await chrome.runtime.sendMessage({ type: "POMO_SET_SUBJECT", subjectId: activeSubjectId }); } catch {}
    });
  });
  renderSubjectCycleBtn();
}

function renderSubjectCycleBtn() {
  const btn = document.getElementById("subjectCycleBtn");
  if (!btn) return;
  const cur = lastSubjects.find(s => s.id === activeSubjectId);
  btn.textContent = cur ? `📚 ${cur.name}` : "📚 None";
}

document.getElementById("subjectCycleBtn").addEventListener("click", async () => {
  const ids = [null, ...lastSubjects.map(s => s.id)];
  const curIdx = ids.indexOf(activeSubjectId);
  const nextIdx = (curIdx + 1) % ids.length;
  activeSubjectId = ids[nextIdx];
  renderSubjectChips();
  renderSubjectCycleBtn();
  try { await chrome.runtime.sendMessage({ type: "POMO_SET_SUBJECT", subjectId: activeSubjectId }); } catch {}
});

document.getElementById("addSubjectBtn").addEventListener("click", async () => {
  const inp = document.getElementById("subjectInput");
  const name = inp.value.trim();
  if (!name) return;
  await chrome.runtime.sendMessage({ type: "ADD_SUBJECT", name });
  inp.value = "";
  await loadSubjects();
});

document.getElementById("subjectInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("addSubjectBtn").click();
});

async function renderSubjectList() {
  const listEl = document.getElementById("subjectList");
  if (!listEl) return;
  if (!lastSubjects.length) { listEl.innerHTML = ""; return; }

  let subjectTime = {};
  try {
    const resp = await chrome.runtime.sendMessage({ type: "GET_SUBJECT_STATS" });
    subjectTime = resp.subjectTime || {};
  } catch {}
  const today = getTodayKey();
  const todayData = subjectTime[today] || {};

  listEl.innerHTML = lastSubjects.map(s => `
    <div class="subject-item" data-id="${s.id}">
      <div class="subject-item-left">
        <span class="subject-dot" style="background:${s.color}"></span>
        <span class="subject-item-name">${escapeHtml(s.name)}</span>
      </div>
      <div class="subject-item-time">
        ${fmtShort(todayData[s.id] || 0)} today
        <button class="timetable-del-btn subject-del-btn" data-id="${s.id}" title="Delete subject">✕</button>
      </div>
    </div>`).join("");

  listEl.querySelectorAll(".subject-del-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "DELETE_SUBJECT", id: btn.dataset.id });
      if (activeSubjectId === btn.dataset.id) activeSubjectId = null;
      await loadSubjects();
    });
  });
}

// ---- Subject line graph (7-day, one colored line per subject) ----
async function drawSubjectGraph() {
  const canvas = document.getElementById("subjectGraph");
  if (!canvas) return;
  const W = 362, H = 110;
  const ctx = prepCanvasDPR(canvas, W, H);
  ctx.clearRect(0, 0, W, H);

  const theme = graphTheme(canvas);
  const cBg2  = theme.text("--bg2")     || "#16161a";
  const cBord = theme.text("--border2") || "#2e2e3a";
  const cMuted= theme.text("--text3")   || "#5e5a52";

  ctx.fillStyle = cBg2;
  ctx.fillRect(0, 0, W, H);

  let subjectTime = {};
  try {
    const resp = await chrome.runtime.sendMessage({ type: "GET_SUBJECT_STATS" });
    subjectTime = resp.subjectTime || {};
  } catch {}

  const dayKeys = [];
  for (let i = 6; i >= 0; i--) dayKeys.push(getDateKey(i));

  const leftM = 30, rightM = 10, topM = 12, bottomM = 18;
  const plotW = W - leftM - rightM;
  const plotH = H - topM - bottomM;

  let maxVal = 1;
  lastSubjects.forEach(s => {
    dayKeys.forEach(k => { maxVal = Math.max(maxVal, (subjectTime[k] && subjectTime[k][s.id]) || 0); });
  });
  maxVal *= 1.2;

  const xAt = i => leftM + (plotW / (dayKeys.length - 1)) * i;
  const yAt = v => topM + plotH - (v / maxVal) * plotH;

  ctx.strokeStyle = cBord;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  [0, 0.5, 1].forEach(f => {
    const gy = topM + plotH * (1 - f);
    ctx.beginPath(); ctx.moveTo(leftM, gy); ctx.lineTo(W - rightM, gy); ctx.stroke();
  });
  ctx.setLineDash([]);

  if (!lastSubjects.length) {
    ctx.fillStyle = cMuted;
    ctx.font = `10px ${theme.font}`;
    ctx.textAlign = "center";
    ctx.fillText("Add a subject to see its graph", W / 2, H / 2);
  }

  lastSubjects.forEach(s => {
    const values = dayKeys.map(k => (subjectTime[k] && subjectTime[k][s.id]) || 0);
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = xAt(i), y = yAt(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
    values.forEach((v, i) => {
      const x = xAt(i), y = yAt(v);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
    });
  });

  ctx.fillStyle = cMuted;
  ctx.font = `8px ${theme.font}`;
  ctx.textAlign = "center";
  dayKeys.forEach((k, i) => ctx.fillText(k.slice(5), xAt(i), H - 4));

  const legend = document.getElementById("subjectGraphLegend");
  if (legend) {
    legend.innerHTML = lastSubjects.map(s => `
      <span><span class="legend-dot" style="background:${s.color}"></span>${escapeHtml(s.name)}</span>`).join("");
  }
}

document.getElementById("subjectGraphToggle").addEventListener("click", async () => {
  const canvas = document.getElementById("subjectGraph");
  const showing = canvas.style.display !== "none";
  if (showing) {
    canvas.style.display = "none";
    document.getElementById("subjectGraphLegend").innerHTML = "";
  } else {
    canvas.style.display = "block";
    await drawSubjectGraph();
  }
});

loadSubjects();

// =============================================
// POMO: FOCUS TIMETABLE (scheduled auto-block, locks during its window)
// =============================================

async function loadTimetables() {
  let resp;
  try { resp = await chrome.runtime.sendMessage({ type: "GET_TIMETABLES" }); }
  catch { resp = { timetables: [], active: [] }; }
  renderTimetableList(resp.timetables || [], resp.active || []);
  applyTimetableLockUI((resp.active || []).length > 0);
}

function applyTimetableLockUI(locked) {
  const ids = ["ttStart", "ttEnd", "ttSitesInput", "addTimetableBtn"];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = locked;
  });
  const msg = document.getElementById("ttLockedMsg");
  if (msg) msg.style.display = locked ? "block" : "none";

  if (anyTimetableLocked !== locked) {
    anyTimetableLocked = locked;
    renderTrack(lastLive); // refresh study/waste toggle lock state
  }
}

function renderTimetableList(timetables, activeIds) {
  const listEl = document.getElementById("timetableList");
  if (!listEl) return;
  if (!timetables.length) {
    listEl.innerHTML = '<div class="empty-state">No focus schedules yet.</div>';
    return;
  }
  listEl.innerHTML = timetables.map(tt => {
    const locked = activeIds.includes(tt.id);
    return `
      <div class="timetable-item ${locked ? "locked" : ""}" data-id="${tt.id}">
        <div class="timetable-item-top">
          <span class="timetable-item-time">${tt.start} – ${tt.end}</span>
          ${locked
            ? '<span class="timetable-lock-badge">🔒 Locked now</span>'
            : `<button class="timetable-del-btn" data-id="${tt.id}" title="Delete">✕</button>`}
        </div>
        <div class="timetable-item-sites">${(tt.sites || []).join(", ") || "—"}</div>
      </div>`;
  }).join("");

  listEl.querySelectorAll(".timetable-del-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const resp = await chrome.runtime.sendMessage({ type: "DELETE_TIMETABLE", id: btn.dataset.id });
      if (resp && resp.ok === false && resp.reason === "locked") {
        alert("A schedule is currently active and locked — it can only be changed after its time window ends.");
      }
      await loadTimetables();
    });
  });
}

// Service worker can be briefly asleep right when a button is clicked; a
// message sent at that exact moment can fail with "Could not establish
// connection" even though the SW wakes up a moment later. Retry once after
// a short delay instead of letting the click handler throw silently (which
// was leaving Add buttons looking like they did nothing).
async function sendMsgRetry(msg, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try { return await chrome.runtime.sendMessage(msg); }
    catch (e) {
      if (i === tries - 1) { console.warn("sendMessage failed:", msg.type, e); return null; }
      await new Promise(r => setTimeout(r, 200));
    }
  }
}

document.getElementById("addTimetableBtn").addEventListener("click", async () => {
  const start = document.getElementById("ttStart").value;
  const end   = document.getElementById("ttEnd").value;
  const sitesRaw = document.getElementById("ttSitesInput").value;
  const sites = sitesRaw.split(",").map(s => s.trim().toLowerCase().replace(/^www\./, "")).filter(Boolean);
  if (!start || !end || !sites.length) {
    alert("Pick a start time, end time, and at least one site to block.");
    return;
  }
  const resp = await sendMsgRetry({ type: "ADD_TIMETABLE", start, end, sites });
  if (!resp) {
    alert("Couldn't reach the extension's background service — try reopening the popup, or reload the extension from chrome://extensions.");
    return;
  }
  if (resp.ok === false && resp.reason === "locked") {
    alert("A schedule is currently active and locked — you can add a new one after it ends.");
    return;
  }
  if (resp.ok === false) {
    alert("Something went wrong saving this schedule: " + (resp.error || "unknown error"));
    return;
  }
  document.getElementById("ttStart").value = "";
  document.getElementById("ttEnd").value = "";
  document.getElementById("ttSitesInput").value = "";
  await loadTimetables();
});

loadTimetables();
setInterval(loadTimetables, 15000); // refresh lock state as time windows turn on/off

// =============================================
// SITE → SUBJECT AUTO-TRACKING
// =============================================

function populateSiteSubjectSelect() {
  const sel = document.getElementById("siteSubjectSelect");
  if (!sel) return;
  if (!lastSubjects.length) {
    sel.innerHTML = '<option value="">Add a subject first</option>';
    return;
  }
  sel.innerHTML = lastSubjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
}

async function loadSiteSubjects() {
  let resp;
  try { resp = await chrome.runtime.sendMessage({ type: "GET_SITE_SUBJECTS" }); }
  catch { resp = { siteSubjects: {} }; }
  renderSiteSubjectList(resp.siteSubjects || {});
}

function renderSiteSubjectList(map) {
  const listEl = document.getElementById("siteSubjectList");
  if (!listEl) return;
  const domains = Object.keys(map);
  if (!domains.length) {
    listEl.innerHTML = '<div class="empty-state">No sites linked yet.</div>';
    return;
  }
  listEl.innerHTML = domains.map(domain => {
    const subj = lastSubjects.find(s => s.id === map[domain]);
    return `
      <div class="site-subject-item" data-domain="${domain}">
        <div class="site-subject-item-left">
          <span class="subject-dot" style="background:${subj ? subj.color : "#888"}"></span>
          <span class="site-subject-domain">${escapeHtml(domain)}</span>
          <span class="text3">→ ${subj ? escapeHtml(subj.name) : "(deleted subject)"}</span>
        </div>
        <button class="timetable-del-btn site-subject-del-btn" data-domain="${domain}" title="Unlink">✕</button>
      </div>`;
  }).join("");

  listEl.querySelectorAll(".site-subject-del-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "SET_SITE_SUBJECT", domain: btn.dataset.domain, subjectId: null });
      await loadSiteSubjects();
    });
  });
}

document.getElementById("addSiteSubjectBtn").addEventListener("click", async () => {
  const domainInput = document.getElementById("siteSubjectDomainInput");
  const domain = domainInput.value.trim().toLowerCase().replace(/^www\./, "").replace(/\/.*$/, "");
  const subjectId = document.getElementById("siteSubjectSelect").value;
  if (!domain || !domain.includes(".")) {
    alert("Enter a valid site, e.g. khanacademy.org");
    return;
  }
  if (!subjectId) {
    alert("Add a subject first, then link a site to it.");
    return;
  }
  const resp = await sendMsgRetry({ type: "SET_SITE_SUBJECT", domain, subjectId });
  if (!resp) {
    alert("Couldn't reach the extension's background service — try reopening the popup, or reload the extension from chrome://extensions.");
    return;
  }
  if (resp.ok === false) {
    alert("Something went wrong linking this site: " + (resp.error || resp.reason || "unknown error"));
    return;
  }
  domainInput.value = "";
  await loadSiteSubjects();
});

loadSiteSubjects();

// =============================================
// NOTES TAB
// =============================================

const notesArea  = document.getElementById("notesArea");
const savedBadge = document.getElementById("notesSaved");
let saveTimeout  = null;
let pendingImages = []; // dataURLs attached to the note currently being drafted/edited

// Downscale + compress before storing so pasted photos don't blow up
// chrome.storage.local's quota (which is what risks losing saved data).
function fileToCompressedDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("bad image"));
      img.onload = () => {
        const MAX = 1000;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const scale = MAX / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderPendingImages() {
  const wrap = document.getElementById("notePendingImages");
  if (!wrap) return;
  wrap.innerHTML = pendingImages.map((src, i) => `
    <div class="note-preview-thumb-wrap" data-i="${i}">
      <img src="${src}" />
      <button class="note-thumb-remove" data-i="${i}" title="Remove">✕</button>
    </div>`).join("");
  wrap.querySelectorAll(".note-thumb-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      pendingImages.splice(Number(btn.dataset.i), 1);
      renderPendingImages();
    });
  });
}

async function addImageFiles(fileList) {
  for (const file of fileList) {
    if (!file.type || !file.type.startsWith("image/")) continue;
    try {
      pendingImages.push(await fileToCompressedDataUrl(file));
    } catch {}
  }
  renderPendingImages();
}

document.getElementById("addPhotoBtn").addEventListener("click", () => {
  document.getElementById("notePhotoInput").click();
});
document.getElementById("notePhotoInput").addEventListener("change", async (e) => {
  await addImageFiles(e.target.files);
  e.target.value = "";
});
notesArea.addEventListener("paste", async (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const imageFiles = [];
  for (const item of items) {
    if (item.type && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }
  if (imageFiles.length) {
    e.preventDefault();
    await addImageFiles(imageFiles);
  }
});

chrome.storage.local.get("quickNotes").then(r => {
  notesArea.value = r.quickNotes || "";
  savedBadge.style.opacity = "0.6";
});

notesArea.addEventListener("input", () => {
  savedBadge.style.opacity = "0";
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    await chrome.storage.local.set({ quickNotes: notesArea.value });
    savedBadge.style.opacity = "0.8";
  }, 400);
});

// ---- Notes History: view (expand), edit (load back + update in place),
// and delete are all supported. Saving fresh text (not editing) always
// adds a brand-new entry on top — it never overwrites older notes unless
// you explicitly hit ✏️ Edit on that note. ----
let editingNoteId = null;
const cancelEditBtn = document.getElementById("cancelEditBtn");

async function loadNotesHistory() {
  const r = await chrome.storage.local.get("notesHistory");
  return r.notesHistory || [];
}

function exitEditMode() {
  editingNoteId = null;
  notesArea.value = "";
  chrome.storage.local.set({ quickNotes: "" });
  document.getElementById("saveNoteBtn").textContent = "💾 Save Note to History";
  cancelEditBtn.style.display = "none";
  pendingImages = [];
  renderPendingImages();
}

async function renderNotesHistory() {
  const history = await loadNotesHistory();
  const listEl  = document.getElementById("notesHistoryList");
  const emptyEl = document.getElementById("notesHistoryEmpty");
  if (!listEl) return;

  if (!history.length) {
    listEl.innerHTML = "";
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  listEl.innerHTML = history.map(n => `
    <div class="notes-history-item ${editingNoteId === n.id ? "editing" : ""}" data-id="${n.id}">
      <div class="notes-history-top">
        <span class="notes-history-time">${new Date(n.savedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}${n.editedAt ? " (edited)" : ""}</span>
        <span class="notes-history-actions">
          <button class="nh-view-btn" data-id="${n.id}" title="View / collapse full note">👁</button>
          <button class="nh-copy-btn" data-id="${n.id}" title="Copy note text">📋</button>
          <button class="nh-edit-btn" data-id="${n.id}" title="Edit this note">✏️</button>
          <button class="nh-del-btn" data-id="${n.id}" title="Delete this note">🗑</button>
        </span>
      </div>
      <div class="notes-history-text" data-id="${n.id}">${escapeHtml(n.text)}</div>
      ${(n.images && n.images.length) ? `<div class="notes-history-images">${n.images.map(src => `<img src="${src}" class="note-thumb" />`).join("")}</div>` : ""}
    </div>`).join("");

  // View/open — click the text (or the eye icon) to expand/collapse full note
  function toggleExpand(id) {
    const el = listEl.querySelector(`.notes-history-text[data-id="${id}"]`);
    if (el) el.classList.toggle("expanded");
  }
  listEl.querySelectorAll(".notes-history-text").forEach(el => {
    el.addEventListener("click", () => toggleExpand(el.dataset.id));
  });
  listEl.querySelectorAll(".nh-view-btn").forEach(btn => {
    btn.addEventListener("click", () => toggleExpand(btn.dataset.id));
  });

  // Copy — copies the note's text to the clipboard
  listEl.querySelectorAll(".nh-copy-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const list = await loadNotesHistory();
      const note = list.find(n => n.id === id);
      if (!note) return;
      try {
        await navigator.clipboard.writeText(note.text);
        btn.textContent = "✓";
        btn.classList.add("copied");
        setTimeout(() => { btn.textContent = "📋"; btn.classList.remove("copied"); }, 1200);
      } catch {}
    });
  });

  // Edit — load the note back into the textarea; saving updates it in place
  listEl.querySelectorAll(".nh-edit-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const list = await loadNotesHistory();
      const note = list.find(n => n.id === id);
      if (!note) return;
      editingNoteId = id;
      notesArea.value = note.text;
      pendingImages = (note.images || []).slice();
      renderPendingImages();
      await chrome.storage.local.set({ quickNotes: note.text });
      document.getElementById("saveNoteBtn").textContent = "💾 Update Note";
      cancelEditBtn.style.display = "inline-block";
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
      document.querySelector('.tab-btn[data-tab="notes"]').classList.add("active");
      document.getElementById("tab-notes").classList.add("active");
      notesArea.focus();
      renderNotesHistory();
    });
  });

  // Delete
  listEl.querySelectorAll(".nh-del-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const list = await loadNotesHistory();
      const idx = list.findIndex(n => n.id === id);
      if (idx === -1) return;
      const removed = list[idx];
      list.splice(idx, 1);
      await chrome.storage.local.set({ notesHistory: list });
      if (editingNoteId === id) exitEditMode();
      await renderNotesHistory();
      const preview = (removed.text || "").slice(0, 40) || "(empty note)";
      showUndoToast(`Deleted "${preview}${removed.text && removed.text.length > 40 ? "…" : ""}"`, async () => {
        const cur = await loadNotesHistory();
        cur.splice(Math.min(idx, cur.length), 0, removed);
        await chrome.storage.local.set({ notesHistory: cur });
        await renderNotesHistory();
      });
    });
  });
}

document.getElementById("saveNoteBtn").addEventListener("click", async () => {
  const text = notesArea.value.trim();
  if (!text && !pendingImages.length) return;
  const history = await loadNotesHistory();
  const images = pendingImages.slice();

  if (editingNoteId !== null) {
    const idx = history.findIndex(n => n.id === editingNoteId);
    if (idx !== -1) {
      history[idx] = { ...history[idx], text, images, editedAt: Date.now() };
    }
  } else {
    history.unshift({ id: Date.now(), text, images, savedAt: Date.now() }); // newest first
  }
  await chrome.storage.local.set({ notesHistory: history });

  exitEditMode();
  savedBadge.style.opacity = "0.8";
  await renderNotesHistory();
});

cancelEditBtn.addEventListener("click", () => {
  exitEditMode();
  renderNotesHistory();
});

renderNotesHistory();

// =============================================
// TASKS TAB — Block sites until tasks are done
// =============================================

async function loadTasks() {
  const r = await chrome.storage.local.get("tasks");
  return r.tasks || [];
}

async function saveTasks(tasks) {
  await chrome.storage.local.set({ tasks });
}

// Tasks tab is a plain to-do list — it only reports pending-task status for
// the UI badge below and never touches the Block tab's site list. Adding,
// completing, or deleting a task can never block or unblock a site.
async function syncTaskBlocking() {
  const tasks = await loadTasks();
  const todayTasks = tasks.filter(t => !isTaskUpcoming(t));
  updateTasksBlockUI(tasks, todayTasks);
}

// The status badge/hint/pending-count only ever reflect TODAY's tasks
// (unscheduled + scheduled for today) — a task scheduled for a future
// date shouldn't count as "pending" until its day arrives. `tasks` (the
// full list) is only used to decide whether to show the empty state.
function updateTasksBlockUI(tasks, todayTasks) {
  const statusEl = document.getElementById("tasksBlockStatus");
  const hintEl   = document.getElementById("taskHint");
  const emptyEl  = document.getElementById("taskEmpty");
  const listEl   = document.getElementById("taskList");

  if (!statusEl) return;

  const noTasks      = tasks.length === 0;
  const pendingToday = todayTasks.filter(t => !t.done).length;
  const nothingToday = !noTasks && todayTasks.length === 0;
  const allTodayDone = todayTasks.length > 0 && pendingToday === 0;

  if (noTasks) {
    statusEl.textContent = "🟢 No Tasks";
    statusEl.className = "tasks-block-status tasks-free";
    hintEl.style.display = "none";
    emptyEl.style.display = "block";
    listEl.style.display = "none";
  } else if (nothingToday) {
    statusEl.textContent = "🟢 Nothing Today";
    statusEl.className = "tasks-block-status tasks-free";
    hintEl.textContent = "Nothing due today — check Upcoming Tasks.";
    hintEl.style.display = "block";
    emptyEl.style.display = "none";
    listEl.style.display = "block";
  } else if (allTodayDone) {
    statusEl.textContent = "🟢 All Done";
    statusEl.className = "tasks-block-status tasks-free";
    hintEl.textContent = "Great work! All tasks complete.";
    hintEl.style.display = "block";
    emptyEl.style.display = "none";
    listEl.style.display = "block";
  } else {
    statusEl.textContent = `📝 ${pendingToday} Pending`;
    statusEl.className = "tasks-block-status tasks-blocked";
    hintEl.textContent = `${pendingToday} task${pendingToday > 1 ? "s" : ""} remaining.`;
    hintEl.style.display = "block";
    emptyEl.style.display = "none";
    listEl.style.display = "block";
  }
}

function formatTaskSchedule(t) {
  if (!t.scheduledAt) return "";
  const d = new Date(t.scheduledAt);
  const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const timeStr = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const repeatLabels = { daily: "repeats daily", weekly: "repeats weekly", custom: "repeats on selected days" };
  const repeatStr = t.repeat && t.repeat !== "none" ? ` · ${repeatLabels[t.repeat] || ""}` : "";
  return `📅 ${dateStr}, ${timeStr}${repeatStr}`;
}

function toDatetimeLocalValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toTimeValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Repeating tasks only need a TIME (they fire on whatever day the repeat
// rule says); only a one-time ("none") task needs a real calendar date.
function computeScheduledAt(repeat, timeStr, customDays) {
  const now = new Date();
  const [hh, mm] = (timeStr || "09:00").split(":").map(Number);

  if (repeat === "custom" && customDays.length) {
    for (let add = 0; add <= 7; add++) {
      const cand = new Date(now);
      cand.setDate(cand.getDate() + add);
      cand.setHours(hh, mm, 0, 0);
      if (customDays.includes(cand.getDay()) && cand.getTime() > now.getTime()) return cand.getTime();
    }
  }
  // daily / weekly / custom-with-no-days-picked: today at that time, or
  // tomorrow if that time already passed today.
  const cand = new Date(now);
  cand.setHours(hh, mm, 0, 0);
  if (cand.getTime() <= now.getTime()) cand.setDate(cand.getDate() + 1);
  return cand.getTime();
}

// "today" view = unscheduled tasks + tasks whose scheduled date is today.
// "upcoming" view = tasks scheduled for a future date. Doesn't touch
// storage at all — purely a display filter, so nothing is ever lost.
let taskViewMode = "today";

function dateKeyFromMs(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isTaskUpcoming(t) {
  if (!t.scheduledAt) return false;
  return dateKeyFromMs(t.scheduledAt) > getTodayKey();
}

// Which tasks have their subtask checklist open — UI-only, never saved.
const expandedSubtasks = new Set();

function subtaskCounts(t) {
  const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
  return { total: subs.length, done: subs.filter(x => x.done).length };
}

function subtasksHtml(t, i) {
  if (!expandedSubtasks.has(t.id)) return "";
  const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
  return `
      <div class="subtask-box">
        ${subs.map(sb => `
          <div class="subtask-row ${sb.done ? "subtask-done" : ""}">
            <button class="subtask-check" data-idx="${i}" data-sid="${sb.id}">${sb.done ? "☑" : "☐"}</button>
            <span class="subtask-text">${escapeHtml(sb.text)}</span>
            <button class="subtask-del" data-idx="${i}" data-sid="${sb.id}" title="Remove step">✕</button>
          </div>`).join("")}
        <div class="subtask-add-row">
          <input class="text-input subtask-input" data-idx="${i}" placeholder="Add a step…" />
          <button class="btn btn-ghost subtask-add-btn" data-idx="${i}">+</button>
        </div>
      </div>`;
}

// ---- New-tab dashboard on/off (default on; newtab.js honors it) ----
(async () => {
  const cb = document.getElementById("settingsNewTabDash");
  const r = await chrome.storage.local.get("newTabDashboard");
  cb.checked = r.newTabDashboard !== false;
  cb.addEventListener("change", () => chrome.storage.local.set({ newTabDashboard: cb.checked }));
})();

// ---- Distraction journal (entries are written by the blocked page) ----
async function renderJournal() {
  const log = ((await chrome.storage.local.get("distractionLog")).distractionLog || []).slice();
  const sum = document.getElementById("journalSummary");
  const list = document.getElementById("journalList");
  if (!log.length) { sum.textContent = ""; list.innerHTML = '<div class="empty-state">Nothing logged yet.</div>'; return; }
  const weekAgo = Date.now() - 7 * 86400000;
  const week = log.filter(e => e.ts >= weekAgo);
  const count = (key) => week.reduce((m, e) => { const k = e[key] || "(unknown)"; m[k] = (m[k] || 0) + 1; return m; }, {});
  const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
  const topSite = top(count("site")), topWhy = top(count("reason"));
  sum.innerHTML = week.length
    ? `This week: <b>${week.length}</b> times${topSite ? ` · most: <b>${escapeHtml(topSite[0])}</b> (${topSite[1]})` : ""}${topWhy ? ` · usual reason: <b>${escapeHtml(topWhy[0])}</b>` : ""}`
    : "Nothing logged this week.";
  list.innerHTML = log.slice(-10).reverse().map(e => `
    <div class="journal-entry">
      <span class="journal-entry-time">${new Date(e.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
      <span class="journal-entry-site">${escapeHtml(e.site || "?")}</span>
      <span class="journal-entry-why">${escapeHtml(e.reason)}</span>
    </div>`).join("");
}
document.getElementById("journalToggle").addEventListener("click", () => {
  const p = document.getElementById("journalPanel");
  const show = p.style.display === "none";
  p.style.display = show ? "block" : "none";
  if (show) renderJournal();
});
document.getElementById("journalClear").addEventListener("click", async () => {
  const prev = (await chrome.storage.local.get("distractionLog")).distractionLog || [];
  if (!prev.length) return;
  await chrome.storage.local.remove("distractionLog");
  renderJournal();
  showUndoToast("Journal cleared", async () => {
    await chrome.storage.local.set({ distractionLog: prev });
    renderJournal();
  });
});

// ---- Assignments & deadlines ----
// `assignments: [{ id, name, course, due(ms), weight, done }]`, sorted by due
// date on display. Reminders (1 day + 2 hours before) are rebuilt by the
// background script whenever this list changes.
async function loadAssignments() {
  return (await chrome.storage.local.get("assignments")).assignments || [];
}
async function saveAssignments(list) {
  await chrome.storage.local.set({ assignments: list });
  try { await chrome.runtime.sendMessage({ type: "SYNC_ASSIGNMENT_ALARMS" }); } catch {}
}

function assignCountdown(due) {
  const ms = due - Date.now();
  if (ms <= 0) return { text: "overdue", cls: "overdue" };
  const hrs = ms / 3600000;
  if (hrs < 24) return { text: `${Math.max(1, Math.round(hrs))}h left`, cls: "urgent" };
  const days = Math.ceil(hrs / 24);
  return { text: `${days} day${days > 1 ? "s" : ""} left`, cls: days <= 3 ? "urgent" : "" };
}

async function renderAssignments() {
  const listEl = document.getElementById("assignList");
  const items = (await loadAssignments()).slice().sort((a, b) => (a.done - b.done) || (a.due - b.due));
  if (!items.length) { listEl.innerHTML = '<div class="empty-state">No deadlines yet.</div>'; return; }
  listEl.innerHTML = items.map(a => {
    const cd = assignCountdown(a.due);
    return `
      <div class="assign-item ${a.done ? "assign-done" : ""}">
        <button class="assign-check" data-id="${a.id}">${a.done ? "✅" : "⬜"}</button>
        <div class="assign-main">
          <div class="assign-title">${escapeHtml(a.name)}${a.weight ? ` <span class="assign-wt">${a.weight}%</span>` : ""}</div>
          <div class="assign-meta">${a.course ? escapeHtml(a.course) + " · " : ""}${new Date(a.due).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
        </div>
        ${a.done ? "" : `<span class="assign-badge ${cd.cls}">${cd.text}</span>`}
        <button class="assign-del" data-id="${a.id}" title="Delete">✕</button>
      </div>`;
  }).join("");

  listEl.querySelectorAll(".assign-check").forEach(btn => btn.addEventListener("click", async () => {
    const list = await loadAssignments();
    const a = list.find(x => String(x.id) === btn.dataset.id);
    if (!a) return;
    a.done = !a.done;
    await saveAssignments(list);
    renderAssignments();
  }));
  listEl.querySelectorAll(".assign-del").forEach(btn => btn.addEventListener("click", async () => {
    const list = await loadAssignments();
    const idx = list.findIndex(x => String(x.id) === btn.dataset.id);
    if (idx === -1) return;
    const [removed] = list.splice(idx, 1);
    await saveAssignments(list);
    renderAssignments();
    showUndoToast(`Deleted "${removed.name}"`, async () => {
      const cur = await loadAssignments();
      cur.splice(Math.min(idx, cur.length), 0, removed);
      await saveAssignments(cur);
      renderAssignments();
    });
  }));
}

document.getElementById("assignToggle").addEventListener("click", () => {
  const panel = document.getElementById("assignPanel");
  const show = panel.style.display === "none";
  panel.style.display = show ? "flex" : "none";
  if (show) renderAssignments();
});

document.getElementById("assignAddBtn").addEventListener("click", async () => {
  const name = document.getElementById("assignName").value.trim();
  const dueVal = document.getElementById("assignDue").value;
  if (!name || !dueVal) { showUndoToast("Add a name and a due date", null); return; }
  const list = await loadAssignments();
  list.push({
    id: Date.now(),
    name,
    course: document.getElementById("assignCourse").value.trim(),
    weight: Math.max(0, Math.min(100, Number(document.getElementById("assignWeight").value) || 0)),
    due: new Date(dueVal).getTime(),
    done: false
  });
  await saveAssignments(list);
  ["assignName", "assignCourse", "assignWeight", "assignDue"].forEach(id => { document.getElementById(id).value = ""; });
  renderAssignments();
});

// ---- Pomodoro session goal + ambient sound ----
(async () => {
  const goalInput = document.getElementById("pomoGoalInput");
  const goalProg = document.getElementById("pomoGoalProgress");

  async function refreshGoalProgress() {
    const r = await chrome.storage.local.get(["pomoSessionGoal", "pomoHistory"]);
    const g = r.pomoSessionGoal;
    const today = getTodayKey();
    if (!g || g.day !== today || !g.target) { goalProg.style.display = "none"; return; }
    const done = ((r.pomoHistory || {})[today] || []).filter(e => e.phase === "study").length;
    goalProg.style.display = "block";
    goalProg.classList.toggle("done", done >= g.target);
    goalProg.textContent = done >= g.target ? `✅ Goal reached — ${done}/${g.target} sessions` : `${done}/${g.target} sessions today`;
  }

  const r0 = await chrome.storage.local.get("pomoSessionGoal");
  if (r0.pomoSessionGoal && r0.pomoSessionGoal.day === getTodayKey()) goalInput.value = r0.pomoSessionGoal.target || "";
  goalInput.addEventListener("change", async () => {
    const n = Math.max(0, Math.min(20, parseInt(goalInput.value, 10) || 0));
    goalInput.value = n || "";
    if (n) await chrome.storage.local.set({ pomoSessionGoal: { day: getTodayKey(), target: n } });
    else await chrome.storage.local.remove("pomoSessionGoal");
    refreshGoalProgress();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.pomoHistory || changes.pomoSessionGoal)) refreshGoalProgress();
  });
  refreshGoalProgress();

  // ---- ambient ----
  const sel = document.getElementById("ambientSoundSelect");
  const vol = document.getElementById("ambientVolume");
  const only = document.getElementById("ambientOnlyStudy");
  const a0 = (await chrome.storage.local.get("ambient")).ambient || { sound: "off", volume: 0.4, onlyDuringStudy: false };
  sel.value = a0.sound; vol.value = Math.round(a0.volume * 100); only.checked = !!a0.onlyDuringStudy;
  async function saveAmbient() {
    await chrome.storage.local.set({ ambient: { sound: sel.value, volume: Number(vol.value) / 100, onlyDuringStudy: only.checked } });
    try { await chrome.runtime.sendMessage({ type: "AMBIENT_APPLY" }); } catch {}
  }
  sel.addEventListener("change", saveAmbient);
  only.addEventListener("change", saveAmbient);
  vol.addEventListener("change", saveAmbient);
})();

// ---- Lock length when a time limit is hit (midnight vs short cooldown) ----
(async () => {
  const sel = document.getElementById("hardLockCooldownSelect");
  const r = await chrome.storage.local.get("hardLockCooldownMin");
  sel.value = String(r.hardLockCooldownMin || 0);
  sel.addEventListener("change", () => {
    chrome.storage.local.set({ hardLockCooldownMin: Number(sel.value) || 0 });
  });
})();



async function renderTaskList() {
  const tasks = await loadTasks();
  const listEl = document.getElementById("taskList");
  if (!listEl) return;

  const toggleBtn = document.getElementById("taskUpcomingToggle");
  if (toggleBtn) {
    toggleBtn.textContent = taskViewMode === "upcoming" ? "◀ Back to Today" : "📅 Upcoming Tasks";
    toggleBtn.classList.toggle("btn-primary", taskViewMode === "upcoming");
    toggleBtn.classList.toggle("btn-ghost", taskViewMode !== "upcoming");
  }

  // Keep each task's real index in the full array (data-idx must still
  // point at loadTasks()'s array, not the filtered/visible one) while
  // only rendering the ones that belong to the current view. Pinned tasks
  // float to the top (stable sort — otherwise keeps whatever order they
  // were already in).
  const visible = tasks
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => (taskViewMode === "upcoming" ? isTaskUpcoming(t) : !isTaskUpcoming(t)))
    .sort((a, b) => (b.t.pinned ? 1 : 0) - (a.t.pinned ? 1 : 0));
  const pinnedCount = tasks.filter(t => t.pinned).length;

  if (!visible.length && tasks.length) {
    listEl.innerHTML = `<li class="empty-state" style="list-style:none">${
      taskViewMode === "upcoming" ? "No upcoming scheduled tasks." : "No tasks for today. Tap \"Upcoming Tasks\" to see what's scheduled ahead."
    }</li>`;
    await syncTaskBlocking();
    return;
  }

  listEl.innerHTML = visible.map(({ t, i }) => {
    const badge = formatTaskSchedule(t);
    const repeat = t.repeat || "none";
    const days = Array.isArray(t.repeatDays) ? t.repeatDays : [];
    const dayLetters = ["S", "M", "T", "W", "T", "F", "S"];
    return `
    <li class="task-item-wrap">
      <div class="task-item ${t.done ? "task-done" : ""} ${t.pinned ? "task-pinned" : ""}">
        <button class="task-check-btn" data-idx="${i}" title="${t.done ? "Mark undone" : "Mark done"}">
          ${t.done ? "✅" : "⬜"}
        </button>
        <span class="task-text">${escapeHtml(t.text)}</span>
        ${t.link ? `<button class="task-link-btn" data-link="${escapeHtml(t.link)}" title="Open link">🔗</button>` : ""}
        <button class="task-sub-btn ${expandedSubtasks.has(t.id) ? "open" : ""}" data-idx="${i}" title="Steps / subtasks">${(() => { const c = subtaskCounts(t); return c.total ? `☰ ${c.done}/${c.total}` : "☰"; })()}</button>
        <button class="task-pin-btn ${t.pinned ? "active" : ""}" data-idx="${i}" title="${t.pinned ? "Unpin" : "Pin as today's priority (max 3)"}">📌</button>
        <button class="task-schedule-btn" data-idx="${i}" title="Schedule">📅</button>
        <button class="task-copy-btn" data-idx="${i}" title="Copy task">📋</button>
        <button class="task-del-btn" data-idx="${i}" title="Delete">✕</button>
      </div>
      ${subtaskCounts(t).total ? `<div class="subtask-progress"><div class="subtask-progress-fill" style="width:${Math.round(subtaskCounts(t).done / subtaskCounts(t).total * 100)}%"></div></div>` : ""}
      ${subtasksHtml(t, i)}
      ${badge ? `<div class="task-schedule-badge">${badge}</div>` : ""}
      <div class="task-schedule-editor" id="taskSchedEditor-${i}" style="display:none">
        <select class="task-sched-repeat" data-idx="${i}">
          <option value="none" ${repeat === "none" ? "selected" : ""}>Doesn't repeat (one-time, needs a date)</option>
          <option value="daily" ${repeat === "daily" ? "selected" : ""}>Every day</option>
          <option value="weekly" ${repeat === "weekly" ? "selected" : ""}>Every week (same weekday)</option>
          <option value="custom" ${repeat === "custom" ? "selected" : ""}>Specific days of the week</option>
        </select>
        <input type="datetime-local" class="task-sched-datetime" data-idx="${i}"
          style="display:${repeat === "none" ? "" : "none"}"
          value="${t.scheduledAt ? toDatetimeLocalValue(t.scheduledAt) : ""}" />
        <input type="time" class="task-sched-time" data-idx="${i}"
          style="display:${repeat === "none" ? "none" : ""}"
          value="${t.scheduledAt ? toTimeValue(t.scheduledAt) : "09:00"}" />
        <div class="task-sched-days" data-idx="${i}" style="display:${repeat === "custom" ? "flex" : "none"}">
          ${dayLetters.map((l, d) => `<button type="button" class="task-sched-day-btn ${days.includes(d) ? "active" : ""}" data-idx="${i}" data-day="${d}">${l}</button>`).join("")}
        </div>
        <div class="task-sched-btn-row">
          <button class="btn btn-primary task-sched-save" data-idx="${i}" style="flex:1">Save</button>
          <button class="btn btn-danger task-sched-clear" data-idx="${i}" style="flex:1">Remove schedule</button>
        </div>
      </div>
    </li>
  `;
  }).join("");

  // Attach events
  listEl.querySelectorAll(".task-sub-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const all = await loadTasks();
      const t = all[parseInt(btn.dataset.idx)];
      if (!t) return;
      if (expandedSubtasks.has(t.id)) expandedSubtasks.delete(t.id); else expandedSubtasks.add(t.id);
      await renderTaskList();
    });
  });
  async function addSubtask(idx, text) {
    text = (text || "").trim();
    if (!text) return;
    const all = await loadTasks();
    const t = all[idx];
    if (!t) return;
    if (!Array.isArray(t.subtasks)) t.subtasks = [];
    t.subtasks.push({ id: Date.now() + Math.floor(Math.random() * 1000), text, done: false });
    await saveTasks(all);
    expandedSubtasks.add(t.id);
    await renderTaskList();
    const again = document.querySelector(`.subtask-input[data-idx="${idx}"]`);
    if (again) again.focus();
  }
  listEl.querySelectorAll(".subtask-add-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const inp = listEl.querySelector(`.subtask-input[data-idx="${btn.dataset.idx}"]`);
      addSubtask(parseInt(btn.dataset.idx), inp && inp.value);
    });
  });
  listEl.querySelectorAll(".subtask-input").forEach(inp => {
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") addSubtask(parseInt(inp.dataset.idx), inp.value); });
  });
  listEl.querySelectorAll(".subtask-check").forEach(btn => {
    btn.addEventListener("click", async () => {
      const all = await loadTasks();
      const t = all[parseInt(btn.dataset.idx)];
      const sb = t && (t.subtasks || []).find(x => String(x.id) === btn.dataset.sid);
      if (!sb) return;
      sb.done = !sb.done;
      // Finishing the last remaining step completes the task itself.
      if (sb.done && t.subtasks.every(x => x.done) && !t.done) t.done = true;
      await saveTasks(all);
      await renderTaskList();
      await syncTaskBlocking();
    });
  });
  listEl.querySelectorAll(".subtask-del").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.idx);
      const all = await loadTasks();
      const t = all[idx];
      if (!t || !t.subtasks) return;
      const pos = t.subtasks.findIndex(x => String(x.id) === btn.dataset.sid);
      if (pos === -1) return;
      const [removed] = t.subtasks.splice(pos, 1);
      await saveTasks(all);
      await renderTaskList();
      showUndoToast(`Removed step "${removed.text}"`, async () => {
        const cur = await loadTasks();
        const tt = cur.find(x => x.id === t.id);
        if (!tt) return;
        if (!Array.isArray(tt.subtasks)) tt.subtasks = [];
        tt.subtasks.splice(Math.min(pos, tt.subtasks.length), 0, removed);
        await saveTasks(cur);
        await renderTaskList();
      });
    });
  });
  listEl.querySelectorAll(".task-pin-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.idx);
      const all = await loadTasks();
      if (!all[idx]) return;
      if (!all[idx].pinned && all.filter(t => t.pinned).length >= 3) {
        showUndoToast("Max 3 pinned — unpin one first", null);
        return;
      }
      all[idx].pinned = !all[idx].pinned;
      await saveTasks(all);
      await renderTaskList();
    });
  });
  listEl.querySelectorAll(".task-link-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      chrome.tabs.create({ url: btn.dataset.link });
    });
  });
  listEl.querySelectorAll(".task-check-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.idx);
      const tasks = await loadTasks();
      tasks[idx].done = !tasks[idx].done;
      await saveTasks(tasks);
      if (tasks[idx].done) {
        try { await chrome.runtime.sendMessage({ type: "CLEAR_TASK_ALARMS", id: tasks[idx].id }); } catch {}
      } else if (tasks[idx].scheduledAt) {
        try { await chrome.runtime.sendMessage({ type: "SCHEDULE_TASK", task: tasks[idx] }); } catch {}
      }
      await renderTaskList();
      await syncTaskBlocking();
    });
  });

  listEl.querySelectorAll(".task-copy-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.idx);
      const tasks = await loadTasks();
      const text = tasks[idx] ? tasks[idx].text : "";
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "✓";
        btn.classList.add("copied");
        setTimeout(() => { btn.textContent = "📋"; btn.classList.remove("copied"); }, 1200);
      } catch {}
    });
  });

  listEl.querySelectorAll(".task-del-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.idx);
      const tasks = await loadTasks();
      const removed = tasks.splice(idx, 1)[0];
      await saveTasks(tasks);
      if (removed) {
        try { await chrome.runtime.sendMessage({ type: "CLEAR_TASK_ALARMS", id: removed.id }); } catch {}
      }
      await renderTaskList();
      await syncTaskBlocking();
      if (removed) {
        showUndoToast(`Deleted "${removed.text}"`, async () => {
          const t = await loadTasks();
          t.splice(Math.min(idx, t.length), 0, removed);
          await saveTasks(t);
          if (removed.scheduledAt) {
            try { await chrome.runtime.sendMessage({ type: "SCHEDULE_TASK", task: removed }); } catch {}
          }
          await renderTaskList();
          await syncTaskBlocking();
        });
      }
    });
  });

  listEl.querySelectorAll(".task-schedule-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = btn.dataset.idx;
      const editor = document.getElementById(`taskSchedEditor-${idx}`);
      if (editor) editor.style.display = editor.style.display === "none" ? "flex" : "none";
    });
  });

  listEl.querySelectorAll(".task-sched-repeat").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const idx = e.target.dataset.idx;
      const daysRow = listEl.querySelector(`.task-sched-days[data-idx="${idx}"]`);
      const dtInput = listEl.querySelector(`.task-sched-datetime[data-idx="${idx}"]`);
      const timeInput = listEl.querySelector(`.task-sched-time[data-idx="${idx}"]`);
      const isNone = e.target.value === "none";
      if (daysRow) daysRow.style.display = e.target.value === "custom" ? "flex" : "none";
      if (dtInput) dtInput.style.display = isNone ? "" : "none";
      if (timeInput) timeInput.style.display = isNone ? "none" : "";
    });
  });

  listEl.querySelectorAll(".task-sched-day-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.target.classList.toggle("active");
    });
  });

  listEl.querySelectorAll(".task-sched-save").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const idx = Number(e.target.dataset.idx);
      const dtInput = listEl.querySelector(`.task-sched-datetime[data-idx="${idx}"]`);
      const timeInput = listEl.querySelector(`.task-sched-time[data-idx="${idx}"]`);
      const repeatSel = listEl.querySelector(`.task-sched-repeat[data-idx="${idx}"]`);
      const dayBtns = listEl.querySelectorAll(`.task-sched-day-btn[data-idx="${idx}"]`);
      const repeat = repeatSel.value;
      const repeatDays = Array.from(dayBtns).filter(b => b.classList.contains("active")).map(b => Number(b.dataset.day));

      let scheduledAt;
      if (repeat === "none") {
        if (!dtInput.value) { alert("Pick a date & time first."); return; }
        scheduledAt = new Date(dtInput.value).getTime();
      } else {
        if (!timeInput.value) { alert("Pick a time first."); return; }
        if (repeat === "custom" && !repeatDays.length) { alert("Pick at least one day."); return; }
        scheduledAt = computeScheduledAt(repeat, timeInput.value, repeatDays);
      }

      const tasks = await loadTasks();
      const task = tasks[idx];
      task.scheduledAt = scheduledAt;
      task.repeat = repeat;
      task.repeatDays = repeatDays;
      await saveTasks(tasks);
      try { await chrome.runtime.sendMessage({ type: "SCHEDULE_TASK", task }); } catch {}
      await renderTaskList();
    });
  });

  listEl.querySelectorAll(".task-sched-clear").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const idx = Number(e.target.dataset.idx);
      const tasks = await loadTasks();
      const task = tasks[idx];
      const hadId = task.id;
      delete task.scheduledAt;
      delete task.repeat;
      delete task.repeatDays;
      await saveTasks(tasks);
      try { await chrome.runtime.sendMessage({ type: "CLEAR_TASK_ALARMS", id: hadId }); } catch {}
      await renderTaskList();
    });
  });

  await syncTaskBlocking();
}

function escapeHtml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// Add task button
document.getElementById("addTaskBtn").addEventListener("click", async () => {
  const inp = document.getElementById("taskInput");
  const text = inp.value.trim();
  if (!text) return;
  const tasks = await loadTasks();
  tasks.push({ text, done: false, id: Date.now() });
  await saveTasks(tasks);
  inp.value = "";
  await renderTaskList();
  await syncTaskBlocking();
});

document.getElementById("taskInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("addTaskBtn").click();
});

// ---- Bulk add: paste a multi-line list, one task per non-empty line ----
async function addTasksFromLines(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()) // strip "- ", "* ", "1. " style list markers
    .filter(Boolean);
  if (!lines.length) return 0;
  const tasks = await loadTasks();
  const base = Date.now();
  lines.forEach((text, i) => tasks.push({ text, done: false, id: base + i }));
  await saveTasks(tasks);
  await renderTaskList();
  await syncTaskBlocking();
  return lines.length;
}

document.getElementById("taskBulkToggle").addEventListener("click", () => {
  const box = document.getElementById("taskBulkBox");
  const show = box.style.display === "none";
  box.style.display = show ? "flex" : "none";
  if (show) document.getElementById("taskBulkInput").focus();
});

document.getElementById("taskBulkAddBtn").addEventListener("click", async () => {
  const ta = document.getElementById("taskBulkInput");
  const n = await addTasksFromLines(ta.value);
  if (!n) return;
  ta.value = "";
  document.getElementById("taskBulkBox").style.display = "none";
  showUndoToast(`Added ${n} task${n > 1 ? "s" : ""}`, null);
});

// Pasting multiple lines straight into the normal one-line box does the same thing.
document.getElementById("taskInput").addEventListener("paste", async (e) => {
  const text = (e.clipboardData || window.clipboardData).getData("text");
  if (!/\r?\n/.test(text.trim())) return; // single line — let the normal paste happen
  e.preventDefault();
  const n = await addTasksFromLines(text);
  if (n) showUndoToast(`Added ${n} task${n > 1 ? "s" : ""}`, null);
});

document.getElementById("taskUpcomingToggle").addEventListener("click", async () => {
  taskViewMode = taskViewMode === "upcoming" ? "today" : "upcoming";
  await renderTaskList();
});


// Initial render
renderTaskList();

// =============================================
// HABITS TAB — streaks, numeric habits, graphs, history
// =============================================

// Shifts a YYYY-MM-DD key by `delta` days (can be negative)
function addDaysToKey(key, delta) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

async function loadHabits() {
  const r = await chrome.storage.local.get(["habits", "habitHistory"]);
  return { habits: r.habits || [], history: r.habitHistory || [] };
}
async function saveHabits(habits) { await chrome.storage.local.set({ habits }); }
async function saveHabitHistory(history) { await chrome.storage.local.set({ habitHistory: history }); }

// Latest date (YYYY-MM-DD) that has any logged entry for this habit
function habitLastEntryDate(habit) {
  const keys = Object.keys(habit.entries || {});
  if (!keys.length) return null;
  return keys.sort().pop();
}

// Consecutive-day streak counted backward from the habit's last logged day
function habitStreak(habit) {
  const last = habitLastEntryDate(habit);
  if (!last) return 0;
  let streak = 0;
  let cursor = last;
  while (habit.entries[cursor] !== undefined) {
    streak++;
    cursor = addDaysToKey(cursor, -1);
  }
  return streak;
}

// Moves any habit that missed a full day (not logged today or yesterday)
// out of the active list and into history, preserving its record.
async function checkAndArchiveHabits() {
  const { habits, history } = await loadHabits();
  const today = getTodayKey();
  const yesterday = getDateKey(1);
  const stillActive = [];
  const newHistory = history.slice();
  let changed = false;

  habits.forEach(habit => {
    const last = habitLastEntryDate(habit);
    if (last === null) {
      if (habit.startDate < today) {
        newHistory.push({ ...habit, endDate: habit.startDate, finalStreak: 0 });
        changed = true;
      } else {
        stillActive.push(habit);
      }
    } else if (last === today || last === yesterday) {
      stillActive.push(habit);
    } else {
      newHistory.push({ ...habit, endDate: last, finalStreak: habitStreak(habit) });
      changed = true;
    }
  });

  if (changed) {
    await saveHabits(stillActive);
    await saveHabitHistory(newHistory);
  }
  return stillActive;
}

const openHabitGraphs = new Set();
let lastRenderedHabits = [];

// Historical note: habits used to be auto-archived into history the moment
// a day was missed (checkAndArchiveHabits, still defined below but no
// longer called). That silently "deleted" habits from the active list
// without the person choosing to — now a habit only ever moves to history
// via the explicit ✕ delete button, and stays on the active list (streak
// simply shows as broken/"Not started") until the person deletes it.
async function renderHabits() {
  const { habits } = await loadHabits();
  lastRenderedHabits = habits;
  const listEl  = document.getElementById("habitList");
  const emptyEl = document.getElementById("habitEmpty");
  if (!listEl) return;

  if (!habits.length) {
    listEl.innerHTML = "";
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  const today = getTodayKey();

  listEl.innerHTML = habits.map(h => {
    const streak = habitStreak(h);
    const todayVal = h.entries[today];
    const ticked = h.type === "check" && todayVal !== undefined;
    const controlHtml = h.type === "check"
      ? `<button class="habit-tick-btn ${ticked ? "ticked" : ""}" data-id="${h.id}" title="${ticked ? "Mark undone" : "Mark done today"}">${ticked ? "✅" : "⬜"}</button>`
      : `<input type="number" step="any" class="habit-num-input" data-id="${h.id}" placeholder="0" value="${todayVal !== undefined ? todayVal : ""}" />
         <button class="habit-num-save" data-id="${h.id}" title="Save today's value">✓</button>`;

    return `
      <div class="habit-item" data-id="${h.id}">
        <div class="habit-item-top">
          <div class="habit-name-wrap">
            <span class="habit-name" title="${escapeHtml(h.name)}">${escapeHtml(h.name)}</span>
            <span class="habit-streak">${streak > 0 ? "🔥 " + streak + (streak === 1 ? " day" : " days") : "Not started"}</span>
          </div>
          <div class="habit-actions">
            ${controlHtml}
            <button class="habit-backfill-btn" data-id="${h.id}" title="Fill in a day you forgot to tick">📅</button>
            <button class="habit-reminder-btn" data-id="${h.id}" title="Set a daily reminder">🔔</button>
            <button class="habit-advanced-btn" data-id="${h.id}" title="Advanced mode (sub-item tracking)">🧬</button>
            <button class="habit-del-btn" data-id="${h.id}" title="Delete habit (moves it to History)">✕</button>
          </div>
        </div>
        <div class="habit-meta">Since ${h.startDate}${h.type === "numeric" && h.unit ? " · " + escapeHtml(h.unit) : ""}${h.reminderTime ? " · 🔔 " + h.reminderTime : ""}${h.advancedMode ? " · 🧬 Advanced" : ""}</div>
        <div class="habit-reminder-row" id="habitReminder-${h.id}" style="display:none">
          <input type="time" class="habit-reminder-time" data-id="${h.id}" value="${h.reminderTime || "20:00"}" />
          <button class="btn btn-primary habit-reminder-save" data-id="${h.id}">Save</button>
          <button class="btn btn-danger habit-reminder-clear" data-id="${h.id}">Off</button>
        </div>
        <div class="habit-backfill-row" id="habitBackfill-${h.id}" style="display:none">
          ${Array.from({ length: 14 }, (_, k) => 13 - k).map(daysAgo => {
            const dayKey = getDateKey(daysAgo);
            if (dayKey === today) return "";
            const has = h.entries[dayKey] !== undefined;
            const label = new Date(dayKey).toLocaleDateString(undefined, { day: "numeric", month: "short" });
            return `<button type="button" class="habit-backfill-day ${has ? "active" : ""}" data-id="${h.id}" data-day="${dayKey}" title="${dayKey}">${label}</button>`;
          }).join("")}
        </div>
        <div class="habit-advanced-panel" id="habitAdvanced-${h.id}" style="display:none">
          <label class="settings-row-inline">
            <span>Advanced mode — add sub-habits (e.g. Bench Press, Running for a Gym habit), each tracked daily on its own</span>
            <input type="checkbox" class="habit-advanced-toggle" data-id="${h.id}" ${h.advancedMode ? "checked" : ""} />
          </label>
          ${h.advancedMode ? `
            <div class="settings-row">
              <input type="text" class="sub-habit-name" data-id="${h.id}" placeholder="Sub-habit name" />
              <select class="sub-habit-type" data-id="${h.id}">
                <option value="check">Check-off</option>
                <option value="numeric">Numeric</option>
              </select>
              <input type="text" class="sub-habit-unit" data-id="${h.id}" placeholder="Unit" style="display:none;max-width:70px" />
              <button class="btn btn-primary sub-habit-add" data-id="${h.id}" style="white-space:nowrap">+ Add</button>
            </div>
            <div class="sub-habit-list" id="subHabitList-${h.id}">
              ${(h.subHabits || []).map(sh => renderSubHabitHtml(h, sh, today)).join("") || `<span class="empty-state" style="padding:4px 0">No sub-habits yet — add one above.</span>`}
            </div>
          ` : ""}
        </div>
        ${h.type === "numeric" ? `<canvas class="habit-graph-canvas" id="habitGraph-${h.id}"></canvas>` : ""}
      </div>`;
  }).join("");

  attachHabitEvents();
  habits.forEach(h => {
    // Graph is only meaningful for numeric habits (shows the trend of
    // values) — a check-off habit is just 1/0, so no graph is drawn for it.
    if (h.type === "numeric") drawSingleHabitGraph(String(h.id), habits);
    if (h.advancedMode) (h.subHabits || []).forEach(sh => { if (sh.type === "numeric") drawSubHabitGraph(h.id, sh.id, habits); });
  });
}

function attachHabitEvents() {
  document.querySelectorAll(".habit-backfill-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const row = document.getElementById(`habitBackfill-${btn.dataset.id}`);
      if (row) row.style.display = row.style.display === "none" ? "flex" : "none";
    });
  });

  document.querySelectorAll(".habit-backfill-day").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const day = btn.dataset.day;
      const { habits } = await loadHabits();
      const h = habits.find(x => String(x.id) === id);
      if (!h) return;
      if (h.type === "check") {
        if (h.entries[day] !== undefined) delete h.entries[day];
        else h.entries[day] = true;
      } else {
        const current = h.entries[day];
        const val = prompt(`Value for ${day}${h.unit ? " (" + h.unit + ")" : ""}:`, current !== undefined ? String(current) : "");
        if (val === null) return; // cancelled
        if (val.trim() === "") delete h.entries[day];
        else {
          const num = Number(val);
          if (!Number.isNaN(num)) h.entries[day] = num;
        }
      }
      await saveHabits(habits);
      await renderHabits();
      const row = document.getElementById(`habitBackfill-${id}`);
      if (row) row.style.display = "flex"; // keep the panel open after a backfill edit
    });
  });

  document.querySelectorAll(".habit-reminder-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const row = document.getElementById(`habitReminder-${btn.dataset.id}`);
      if (row) row.style.display = row.style.display === "none" ? "flex" : "none";
    });
  });

  document.querySelectorAll(".habit-reminder-save").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.dataset.id;
      const timeInput = document.querySelector(`.habit-reminder-time[data-id="${id}"]`);
      const { habits } = await loadHabits();
      const h = habits.find(x => String(x.id) === id);
      if (!h || !timeInput.value) return;
      h.reminderTime = timeInput.value;
      await saveHabits(habits);
      try { await chrome.runtime.sendMessage({ type: "SCHEDULE_HABIT_REMINDER", habit: h }); } catch {}
      await renderHabits();
    });
  });

  document.querySelectorAll(".habit-reminder-clear").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.dataset.id;
      const { habits } = await loadHabits();
      const h = habits.find(x => String(x.id) === id);
      if (!h) return;
      delete h.reminderTime;
      await saveHabits(habits);
      try { await chrome.runtime.sendMessage({ type: "CLEAR_HABIT_REMINDER", id }); } catch {}
      await renderHabits();
    });
  });

  document.querySelectorAll(".habit-tick-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const { habits } = await loadHabits();
      const h = habits.find(x => String(x.id) === id);
      if (!h) return;
      const today = getTodayKey();
      if (h.entries[today] !== undefined) delete h.entries[today];
      else h.entries[today] = true;
      await saveHabits(habits);
      await renderHabits();
    });
  });

  document.querySelectorAll(".habit-num-save").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const input = document.querySelector(`.habit-num-input[data-id="${id}"]`);
      const val = parseFloat(input.value);
      if (isNaN(val)) return;
      const { habits } = await loadHabits();
      const h = habits.find(x => String(x.id) === id);
      if (!h) return;
      h.entries[getTodayKey()] = val;
      await saveHabits(habits);
      await renderHabits();
    });
  });

  document.querySelectorAll(".habit-num-input").forEach(inp => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const saveBtn = document.querySelector(`.habit-num-save[data-id="${inp.dataset.id}"]`);
        if (saveBtn) saveBtn.click();
      }
    });
  });

  document.querySelectorAll(".habit-advanced-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const row = document.getElementById(`habitAdvanced-${btn.dataset.id}`);
      if (row) row.style.display = row.style.display === "none" ? "block" : "none";
    });
  });

  document.querySelectorAll(".habit-advanced-toggle").forEach(cb => {
    cb.addEventListener("change", async (e) => {
      const id = e.target.dataset.id;
      const { habits } = await loadHabits();
      const h = habits.find(x => String(x.id) === id);
      if (!h) return;
      h.advancedMode = e.target.checked;
      if (h.advancedMode && !h.advancedEntries) h.advancedEntries = {};
      await saveHabits(habits);
      await renderHabits();
    });
  });

  document.querySelectorAll(".sub-habit-type").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const unitInput = document.querySelector(`.sub-habit-unit[data-id="${e.target.dataset.id}"]`);
      if (unitInput) unitInput.style.display = e.target.value === "numeric" ? "" : "none";
    });
  });

  document.querySelectorAll(".sub-habit-add").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.dataset.id;
      const nameInput = document.querySelector(`.sub-habit-name[data-id="${id}"]`);
      const typeSel = document.querySelector(`.sub-habit-type[data-id="${id}"]`);
      const unitInput = document.querySelector(`.sub-habit-unit[data-id="${id}"]`);
      const name = nameInput.value.trim();
      if (!name) return;
      const { habits } = await loadHabits();
      const h = habits.find(x => String(x.id) === id);
      if (!h) return;
      h.subHabits = h.subHabits || [];
      h.subHabits.push({
        id: Date.now() + Math.floor(Math.random() * 1000),
        name,
        type: typeSel.value,
        unit: typeSel.value === "numeric" ? unitInput.value.trim() : "",
        entries: {}
      });
      await saveHabits(habits);
      await renderHabits();
    });
  });

  document.querySelectorAll(".sub-habit-tick-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const pid = e.target.dataset.pid, sid = e.target.dataset.sid;
      const { habits } = await loadHabits();
      const h = habits.find(x => String(x.id) === pid);
      if (!h) return;
      const sh = (h.subHabits || []).find(x => String(x.id) === sid);
      if (!sh) return;
      const today = getTodayKey();
      if (sh.entries[today] !== undefined) delete sh.entries[today];
      else sh.entries[today] = true;
      await markParentDoneIfAnySubHabitLogged(h, today);
      await saveHabits(habits);
      await renderHabits();
    });
  });

  document.querySelectorAll(".sub-habit-num-save").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const pid = e.target.dataset.pid, sid = e.target.dataset.sid;
      const numInput = document.querySelector(`.sub-habit-num-input[data-pid="${pid}"][data-sid="${sid}"]`);
      const { habits } = await loadHabits();
      const h = habits.find(x => String(x.id) === pid);
      if (!h) return;
      const sh = (h.subHabits || []).find(x => String(x.id) === sid);
      if (!sh || !numInput) return;
      const today = getTodayKey();
      const val = numInput.value.trim();
      if (val === "") delete sh.entries[today];
      else sh.entries[today] = Number(val);
      await markParentDoneIfAnySubHabitLogged(h, today);
      await saveHabits(habits);
      await renderHabits();
    });
  });

  document.querySelectorAll(".sub-habit-del-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const pid = e.target.dataset.pid, sid = e.target.dataset.sid;
      if (!confirm("Delete this sub-habit? Its data can't be recovered.")) return;
      const { habits } = await loadHabits();
      const h = habits.find(x => String(x.id) === pid);
      if (!h) return;
      h.subHabits = (h.subHabits || []).filter(x => String(x.id) !== sid);
      await markParentDoneIfAnySubHabitLogged(h, getTodayKey());
      await saveHabits(habits);
      await renderHabits();
    });
  });

  document.querySelectorAll(".habit-del-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const { habits, history } = await loadHabits();
      const idx = habits.findIndex(x => String(x.id) === id);
      if (idx === -1) return;
      const h = habits[idx];
      habits.splice(idx, 1);
      const last = habitLastEntryDate(h);
      const historyEntry = { ...h, endDate: last || h.startDate, finalStreak: habitStreak(h) };
      history.push(historyEntry);
      await saveHabits(habits);
      await saveHabitHistory(history);
      try { await chrome.runtime.sendMessage({ type: "CLEAR_HABIT_REMINDER", id }); } catch {}
      await renderHabits();
      await renderHabitHistory();
      showUndoToast(`Deleted "${h.name}"`, async () => {
        const cur = await loadHabits();
        const histIdx = cur.history.findIndex(x => String(x.id) === id && x.endDate === historyEntry.endDate);
        if (histIdx !== -1) cur.history.splice(histIdx, 1);
        cur.habits.splice(Math.min(idx, cur.habits.length), 0, h);
        await saveHabits(cur.habits);
        await saveHabitHistory(cur.history);
        if (h.reminderTime) {
          try { await chrome.runtime.sendMessage({ type: "SCHEDULE_HABIT_REMINDER", habit: h }); } catch {}
        }
        await renderHabits();
        await renderHabitHistory();
      });
    });
  });
}

async function drawSingleHabitGraph(id, habitsArg) {
  const canvas = document.getElementById(`habitGraph-${id}`);
  if (!canvas) return;
  const list = habitsArg || (await loadHabits()).habits;
  const h = list.find(x => String(x.id) === String(id));
  if (!h) return;
  drawHabitGraph(canvas, h);
}

async function renderActiveHabitGraphs() {
  const { habits } = await loadHabits();
  habits.forEach(h => drawSingleHabitGraph(String(h.id), habits));
}

// Per-habit line graph — works for both check-off (1/0) and numeric habits
function drawHabitGraph(canvas, habit) {
  const W = 330, H = 90;
  const ctx = prepCanvasDPR(canvas, W, H);
  ctx.clearRect(0, 0, W, H);

  const theme  = graphTheme(canvas);
  const cBg3   = theme.text("--bg3")     || "#1e1e24";
  const cBord  = theme.text("--border2") || "#2e2e3a";
  const cMuted = theme.text("--text3")   || "#5e5a52";
  const cGold  = theme.text("--gold")    || "#7c9cff";
  const cGreen = theme.text("--green")   || "#4caf82";

  ctx.fillStyle = cBg3;
  ctx.fillRect(0, 0, W, H);

  const dates = Object.keys(habit.entries || {}).sort();
  if (!dates.length) {
    ctx.fillStyle = cMuted;
    ctx.font = `10px ${theme.font}`;
    ctx.textAlign = "center";
    ctx.fillText("No data yet", W / 2, H / 2);
    return;
  }

  const values = dates.map(d => habit.type === "numeric" ? (Number(habit.entries[d]) || 0) : 1);
  const leftM = 26, rightM = 10, topM = 12, bottomM = 16;
  const plotW = W - leftM - rightM;
  const plotH = H - topM - bottomM;
  const maxVal = Math.max(...values, 1) * 1.15;

  const xAt = i => dates.length === 1 ? leftM + plotW / 2 : leftM + (plotW / (dates.length - 1)) * i;
  const yAt = v => topM + plotH - (v / maxVal) * plotH;

  ctx.strokeStyle = cBord;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  [0, 0.5, 1].forEach(f => {
    const gy = topM + plotH * (1 - f);
    ctx.beginPath(); ctx.moveTo(leftM, gy); ctx.lineTo(W - rightM, gy); ctx.stroke();
  });
  ctx.setLineDash([]);

  const color = habit.type === "numeric" ? cGold : cGreen;

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = xAt(i), y = yAt(v);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();

  values.forEach((v, i) => {
    const x = xAt(i), y = yAt(v);
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });

  ctx.fillStyle = cMuted;
  ctx.font = `8px ${theme.font}`;
  ctx.textAlign = "center";
  const labelIdxs = dates.length <= 3
    ? dates.map((_, i) => i)
    : [0, Math.floor((dates.length - 1) / 2), dates.length - 1];
  labelIdxs.forEach(i => ctx.fillText(dates[i].slice(5), xAt(i), H - 4));

  if (habit.type === "numeric") {
    ctx.textAlign = "left";
    ctx.fillText(String(Math.round(maxVal)), 2, topM + 6);
  }
}

async function renderHabitHistory() {
  const { history } = await loadHabits();
  const listEl  = document.getElementById("habitHistoryList");
  const emptyEl = document.getElementById("habitHistoryEmpty");
  if (!listEl) return;

  if (!history.length) {
    listEl.innerHTML = "";
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  listEl.innerHTML = history.slice().reverse().map(h => `
    <div class="habit-history-item" data-id="${h.id}">
      <div class="habit-item-top">
        <div class="habit-name">${escapeHtml(h.name)}</div>
        <button class="habit-hist-del-btn" data-id="${h.id}" title="Permanently delete this history entry">✕</button>
      </div>
      <div class="habit-meta">
        <span>${h.startDate} → ${h.endDate}</span>
        <span>🔥 ${h.finalStreak || 0}${(h.finalStreak || 0) === 1 ? " day" : " days"}</span>
      </div>
      ${h.type === "numeric" ? `<canvas class="habit-graph-canvas" id="habitHistGraph-${h.id}"></canvas>` : ""}
    </div>
  `).join("");

  history.forEach(h => {
    if (h.type !== "numeric") return;
    const canvas = document.getElementById(`habitHistGraph-${h.id}`);
    if (canvas) drawHabitGraph(canvas, h);
  });

  // Permanent delete — unlike the active-list ✕ (which archives into
  // history), this one removes the entry from history for good, so it asks
  // for confirmation first.
  document.querySelectorAll(".habit-hist-del-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const entry = history.find(x => String(x.id) === id);
      if (!confirm(`Permanently delete "${entry ? entry.name : "this"}" from History? This can't be undone.`)) return;
      const { history: freshHistory } = await loadHabits();
      const next = freshHistory.filter(x => String(x.id) !== id);
      await saveHabitHistory(next);
      await renderHabitHistory();
    });
  });
}

document.getElementById("habitHistoryToggle").addEventListener("click", async () => {
  const section = document.getElementById("habitHistorySection");
  const showing = section.style.display !== "none";
  section.style.display = showing ? "none" : "block";
  if (!showing) await renderHabitHistory();
});

document.getElementById("habitTypeInput").addEventListener("change", (e) => {
  document.getElementById("habitUnitInput").style.display = e.target.value === "numeric" ? "block" : "none";
});

document.getElementById("addHabitBtn").addEventListener("click", async () => {
  const nameInp = document.getElementById("habitNameInput");
  const name = nameInp.value.trim();
  if (!name) return;
  const type = document.getElementById("habitTypeInput").value;
  const unitInp = document.getElementById("habitUnitInput");
  const unit = unitInp.value.trim();

  const { habits } = await loadHabits();
  habits.push({
    id: Date.now(),
    name,
    type,
    unit: type === "numeric" ? unit : "",
    startDate: getTodayKey(),
    entries: {}
  });
  await saveHabits(habits);
  nameInp.value = "";
  unitInp.value = "";
  await renderHabits();
});

document.getElementById("habitNameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("addHabitBtn").click();
});

// Initial render

// ---- Habit heatmap (GitHub-style, last 16 weeks) ----
// Each square = share of habits ticked that day, across active habits AND
// ones already moved to History (counted only for the days they were
// running). Purely derived from existing entries — nothing extra stored.
async function renderHabitHeatmap() {
  const grid = document.getElementById("habitHeatmapGrid");
  if (!grid) return;
  const { habits, history } = await loadHabits();
  const all = [...habits, ...history];
  const WEEKS = 16;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // Start on a Sunday so each column is one calendar week
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() - (WEEKS - 1) * 7);
  let html = "";
  for (let w = 0; w < WEEKS; w++) {
    html += '<div class="hm-col">';
    for (let d = 0; d < 7; d++) {
      const day = new Date(start); day.setDate(start.getDate() + w * 7 + d);
      if (day > today) { html += '<i class="hm-cell hm-future"></i>'; continue; }
      const k = key(day);
      let active = 0, done = 0;
      for (const h of all) {
        if (h.startDate && k < h.startDate) continue;
        if (h.endDate && k > h.endDate) continue;
        active++;
        if (h.entries && h.entries[k] !== undefined) done++;
      }
      const pct = active ? done / active : 0;
      const lvl = !active || pct === 0 ? 0 : pct < 0.34 ? 1 : pct < 0.67 ? 2 : pct < 1 ? 3 : 4;
      html += `<i class="hm-cell hm-l${lvl}" title="${k}: ${done}/${active} habits"></i>`;
    }
    html += "</div>";
  }
  grid.innerHTML = html;
}

document.getElementById("habitHeatmapBtn").addEventListener("click", async () => {
  const panel = document.getElementById("habitHeatmapPanel");
  const show = panel.style.display === "none";
  panel.style.display = show ? "block" : "none";
  if (show) await renderHabitHeatmap();
});

renderHabits();

// =============================================
// DAILY GOAL PROMPT
// =============================================
async function loadDailyGoal() {
  const r = await chrome.storage.local.get("dailyGoal");
  const g = r.dailyGoal;
  const today = getTodayKey();
  const textEl = document.getElementById("dailyGoalText");
  const inputEl = document.getElementById("dailyGoalInput");
  const editBtn = document.getElementById("dailyGoalEditBtn");
  const saveBtn = document.getElementById("dailyGoalSaveBtn");

  if (g && g.date === today && g.text) {
    textEl.textContent = "🎯 " + g.text;
    textEl.style.display = "";
    inputEl.style.display = "none";
    saveBtn.style.display = "none";
    editBtn.style.display = "";
  } else {
    textEl.style.display = "none";
    inputEl.style.display = "";
    inputEl.value = "";
    saveBtn.style.display = "";
    editBtn.style.display = "none";
  }
}

document.getElementById("dailyGoalEditBtn").addEventListener("click", () => {
  document.getElementById("dailyGoalText").style.display = "none";
  document.getElementById("dailyGoalEditBtn").style.display = "none";
  const inputEl = document.getElementById("dailyGoalInput");
  inputEl.style.display = "";
  inputEl.value = "";
  document.getElementById("dailyGoalSaveBtn").style.display = "";
});

document.getElementById("dailyGoalSaveBtn").addEventListener("click", async () => {
  const text = document.getElementById("dailyGoalInput").value.trim();
  if (!text) return;
  await chrome.storage.local.set({ dailyGoal: { date: getTodayKey(), text } });
  loadDailyGoal();
});
document.getElementById("dailyGoalInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("dailyGoalSaveBtn").click();
});

loadDailyGoal();

// =============================================
// WEEKLY REPORT
// =============================================
function aggregateDays(timeData, cats, dayKeys) {
  let study = 0, waste = 0;
  const perSiteWaste = {};
  dayKeys.forEach((key) => {
    const day = timeData[key] || {};
    Object.entries(day).forEach(([domain, secs]) => {
      if ((cats[domain] || "waste") === "study") {
        study += secs;
      } else {
        waste += secs;
        perSiteWaste[domain] = (perSiteWaste[domain] || 0) + secs;
      }
    });
  });
  return { study, waste, perSiteWaste };
}

async function renderWeeklyReport() {
  const r = await chrome.storage.local.get(["timeData", "siteCategories"]);
  const timeData = r.timeData || {};
  const cats = r.siteCategories || {};

  const thisWeekKeys = Array.from({ length: 7 }, (_, i) => getDateKey(i));
  const lastWeekKeys = Array.from({ length: 7 }, (_, i) => getDateKey(i + 7));
  const thisWeek = aggregateDays(timeData, cats, thisWeekKeys);
  const lastWeek = aggregateDays(timeData, cats, lastWeekKeys);

  // Streak: consecutive days (counting back from today) where study time
  // was logged and met or beat that day's waste time.
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const day = timeData[getDateKey(i)] || {};
    let s = 0, w = 0;
    Object.entries(day).forEach(([d, secs]) => {
      if ((cats[d] || "waste") === "study") s += secs; else w += secs;
    });
    if (s > 0 && s >= w) streak++; else break;
  }

  const topSite = Object.entries(thisWeek.perSiteWaste).sort((a, b) => b[1] - a[1])[0];

  const panel = document.getElementById("weeklyReportPanel");
  panel.innerHTML =
    `<div class="weekly-report-row"><span>This week — Study</span><strong>${fmtSec(thisWeek.study)}</strong></div>` +
    `<div class="weekly-report-row"><span>This week — Waste</span><strong>${fmtSec(thisWeek.waste)}</strong></div>` +
    `<div class="weekly-report-row"><span>Last week — Study</span><span>${fmtSec(lastWeek.study)}</span></div>` +
    `<div class="weekly-report-row"><span>Last week — Waste</span><span>${fmtSec(lastWeek.waste)}</span></div>` +
    `<div class="weekly-report-row"><span>🔥 Streak (study ≥ waste)</span><strong>${streak} day${streak === 1 ? "" : "s"}</strong></div>` +
    `<div class="weekly-report-row"><span>Top distraction (7d)</span><strong>${topSite ? topSite[0] + " — " + fmtSec(topSite[1]) : "—"}</strong></div>`;
}

document.getElementById("weeklyReportBtn").addEventListener("click", async () => {
  const panel = document.getElementById("weeklyReportPanel");
  const showing = panel.style.display !== "none";
  if (showing) { panel.style.display = "none"; return; }
  await renderWeeklyReport();
  panel.style.display = "";
});

// =============================================
// EYE-REST REMINDERS (20-20-20 rule)
// =============================================
(async () => {
  const r = await chrome.storage.local.get("eyeRestEnabled");
  document.getElementById("eyeRestToggle").checked = !!r.eyeRestEnabled;
})();

document.getElementById("eyeRestToggle").addEventListener("change", async (e) => {
  try { await chrome.runtime.sendMessage({ type: "SET_EYE_REST", enabled: e.target.checked }); } catch {}
});

// =============================================
// QUICK-ADD TASK (keyboard shortcut Ctrl+Shift+Y)
// =============================================
(async () => {
  const r = await chrome.storage.local.get("quickAddTaskRequested");
  if (!r.quickAddTaskRequested) return;
  await chrome.storage.local.remove("quickAddTaskRequested");
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
  const tasksBtn = document.querySelector('.tab-btn[data-tab="tasks"]');
  const tasksTab = document.getElementById("tab-tasks");
  if (tasksBtn) tasksBtn.classList.add("active");
  if (tasksTab) tasksTab.classList.add("active");
  const input = document.getElementById("taskInput");
  if (input) input.focus();
})();

// =============================================
// QUICK-ADD NOTE (keyboard shortcut Ctrl+Shift+U)
// Switches to the Notes tab and, if the page you were on is capturable,
// pre-fills the draft with its title + link so you just type your note
// underneath — nothing is saved until you hit "Save Note" yourself, so
// this never silently creates history entries.
// =============================================
(async () => {
  const r = await chrome.storage.local.get(["quickAddNoteRequested", "quickAddNoteTabInfo"]);
  if (!r.quickAddNoteRequested) return;
  await chrome.storage.local.remove(["quickAddNoteRequested", "quickAddNoteTabInfo"]);
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
  const notesBtn = document.querySelector('.tab-btn[data-tab="notes"]');
  const notesTab = document.getElementById("tab-notes");
  if (notesBtn) notesBtn.classList.add("active");
  if (notesTab) notesTab.classList.add("active");
  const area = document.getElementById("notesArea");
  if (area) {
    // The separate draft-restore `chrome.storage.local.get("quickNotes")`
    // a bit above this block is also async and its .then() may not have
    // populated the textarea yet — a short delay guarantees it has
    // resolved before we read/overwrite area.value, so we don't race it
    // and lose an in-progress draft.
    setTimeout(async () => {
      const info = r.quickAddNoteTabInfo;
      if (info && !area.value) {
        area.value = `${info.title}\n${info.url}\n\n`;
        await chrome.storage.local.set({ quickNotes: area.value }); // keep the draft-autosave in sync
      }
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length); // cursor at the end, ready to type
    }, 80);
  }
})();

// =============================================
// BACKUP & RESTORE — everything the extension stores, in one file
// =============================================
const BACKUP_KEYS = [
  "blockedSites", "blockLocks", "hardLocks", "wastedTimeLimitSeconds", "siteTimeLimits", "hardLockCooldownMin", "pomoSessionGoal", "ambient", "assignments", "distractionLog", "newTabDashboard",
  "timetables", "subjects", "siteSubjects", "autoOpens",
  "tasks", "habits", "habitHistory",
  "timeData", "hourlyTimeData", "subjectTime", "siteCategories", "activeTracking", "browserSessions",
  "arunWebpageStyle", "arunWebpageStylePresets", "arunCustomReminder", "arunMonthlyCalendarMonth",
  "arunAnalyticsPeriod", "arunAnalyticsMonth", "arunAnalyticsYear",
  "arunStudyHeatmapSource", "arunStudyHeatmapPeriod", "arunStudyHeatmapMonth", "arunStudyHeatmapYear",
  "notesHistory", "quickNotes",
  "siteSkins", "siteSkinDefault",
  "pomoState", "pomoHistory", "pomoStudySeconds",
  "adBlockEnabled", "eyeRestEnabled", "dailyGoal",
  "theme", "uiSettings"
];

document.getElementById("exportDataBtn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get(BACKUP_KEYS);
  const payload = {
    _arunProBackup: true,
    _exportedAt: new Date().toISOString(),
    _version: "4.6",
    data
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `arun-pro-backup-${getTodayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

document.getElementById("importDataBtn").addEventListener("click", () => {
  document.getElementById("importDataFile").click();
});

// Merge imported data conservatively: never discard current array records or object keys.
// Records with matching IDs are kept from the current profile to avoid silent overwrites.
function safeMergeBackupValue(current, incoming) {
  if (Array.isArray(current) && Array.isArray(incoming)) {
    const result = current.slice();
    const ids = new Set(current.filter(x => x && typeof x === "object" && x.id != null).map(x => String(x.id)));
    const signatures = new Set(current.map(x => { try { return JSON.stringify(x); } catch { return String(x); } }));
    for (const item of incoming) {
      const id = item && typeof item === "object" && item.id != null ? String(item.id) : null;
      let sig; try { sig = JSON.stringify(item); } catch { sig = String(item); }
      if ((id !== null && ids.has(id)) || signatures.has(sig)) continue;
      result.push(item);
      if (id !== null) ids.add(id);
      signatures.add(sig);
    }
    return result;
  }
  if (current && incoming && typeof current === "object" && typeof incoming === "object" && !Array.isArray(current) && !Array.isArray(incoming)) {
    const result = { ...current };
    for (const [key, value] of Object.entries(incoming)) {
      result[key] = Object.prototype.hasOwnProperty.call(current, key)
        ? safeMergeBackupValue(current[key], value)
        : value;
    }
    return result;
  }
  // On conflicting scalar/type values, preserve the current value in safe-merge mode.
  return current === undefined ? incoming : current;
}

document.getElementById("importDataFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const statusEl = document.getElementById("importStatus");
  const mode = document.getElementById("importMode")?.value || "merge";
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || parsed._arunProBackup !== true || !parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
      statusEl.textContent = "⚠ That doesn't look like a valid ARUN PRO backup file.";
      return;
    }
    // Only accept known backup keys; don't import arbitrary extension storage keys.
    const imported = {};
    for (const key of BACKUP_KEYS) {
      if (Object.prototype.hasOwnProperty.call(parsed.data, key)) imported[key] = parsed.data[key];
    }
    if (!Object.keys(imported).length) {
      statusEl.textContent = "⚠ No recognized ARUN PRO data was found in this backup.";
      return;
    }
    const when = parsed._exportedAt ? new Date(parsed._exportedAt).toLocaleString() : "an unknown time";
    if (mode === "replace") {
      if (!confirm(`REPLACE mode will overwrite the backed-up categories in your current profile with the backup from ${when}. Export a backup first. Continue?`)) return;
      await chrome.storage.local.set(imported);
      statusEl.textContent = "✅ Backed-up categories replaced. Reopen the popup to refresh all views.";
    } else {
      const current = await chrome.storage.local.get(Object.keys(imported));
      const merged = {};
      for (const [key, value] of Object.entries(imported)) {
        merged[key] = Object.prototype.hasOwnProperty.call(current, key)
          ? safeMergeBackupValue(current[key], value)
          : value;
      }
      await chrome.storage.local.set(merged);
      statusEl.textContent = "✅ Safe merge complete. Existing records and conflicting current values were preserved; reopen the popup to refresh views.";
    }
  } catch (err) {
    statusEl.textContent = "⚠ Import failed; current data was not intentionally cleared: " + err.message;
  } finally {
    e.target.value = "";
  }
});

// =============================================
// POMODORO + BLOCK INTEGRATION (opt-in)
// =============================================
(async () => {
  const r = await chrome.storage.local.get("pomoBlockEnabled");
  document.getElementById("pomoBlockToggle").checked = !!r.pomoBlockEnabled;
})();

document.getElementById("pomoBlockToggle").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ pomoBlockEnabled: e.target.checked });
});

// =============================================
// SUB-HABITS (Advanced mode) — each is a mini habit with its own
// type/unit/entries/streak/graph, nested under a parent habit
// =============================================
function renderSubHabitHtml(parent, sh, today) {
  const streak = habitStreak(sh);
  const ticked = sh.entries[today] !== undefined;
  const control = sh.type === "numeric"
    ? `<input type="number" class="sub-habit-num-input" data-pid="${parent.id}" data-sid="${sh.id}" value="${sh.entries[today] ?? ""}" placeholder="0" style="width:60px" />` +
      `<button class="btn btn-primary sub-habit-num-save" data-pid="${parent.id}" data-sid="${sh.id}" style="font-size:10px;padding:4px 8px">Save</button>`
    : `<button class="sub-habit-tick-btn" data-pid="${parent.id}" data-sid="${sh.id}" title="${ticked ? "Mark undone" : "Mark done today"}">${ticked ? "✅" : "⬜"}</button>`;
  return `
    <div class="sub-habit-item">
      <div class="sub-habit-row">
        <span class="sub-habit-name-text" title="${escapeHtml(sh.name)}">${escapeHtml(sh.name)}</span>
        <span class="habit-streak">${streak > 0 ? "🔥 " + streak : "—"}</span>
        ${control}
        <button class="sub-habit-del-btn" data-pid="${parent.id}" data-sid="${sh.id}" title="Delete sub-habit">✕</button>
      </div>
      ${sh.type === "numeric" ? `<canvas class="habit-graph-canvas sub-habit-graph" id="subHabitGraph-${parent.id}-${sh.id}"></canvas>` : ""}
    </div>`;
}

async function drawSubHabitGraph(parentId, subId, habitsArg) {
  const canvas = document.getElementById(`subHabitGraph-${parentId}-${subId}`);
  if (!canvas) return;
  const list = habitsArg || (await loadHabits()).habits;
  const parent = list.find(x => String(x.id) === String(parentId));
  if (!parent) return;
  const sh = (parent.subHabits || []).find(x => String(x.id) === String(subId));
  if (!sh) return;
  drawHabitGraph(canvas, sh);
}

async function markParentDoneIfAnySubHabitLogged(parent, dayKey) {
  const anyLogged = (parent.subHabits || []).some(sh => sh.entries[dayKey] !== undefined);
  if (anyLogged && parent.entries[dayKey] === undefined) parent.entries[dayKey] = true;
  if (!anyLogged && parent.entries[dayKey] !== undefined) delete parent.entries[dayKey];
}

// =============================================
// HABITS "ANALYSE" PANEL — overall summary, configurable range,
// body metrics (height/weight) growth, browser session activity
// =============================================
function rangeDayKeys(rangeVal, allTimeData) {
  if (rangeVal === "all") {
    const keys = Object.keys(allTimeData || {}).sort();
    return keys;
  }
  const n = Number(rangeVal);
  return Array.from({ length: n }, (_, i) => getDateKey(n - 1 - i));
}

function drawSimpleLineGraph(canvas, dates, values, opts = {}) {
  const W = 330, H = 90;
  const ctx = prepCanvasDPR(canvas, W, H);
  ctx.clearRect(0, 0, W, H);
  const theme  = graphTheme(canvas);
  const cBg3   = theme.text("--bg3")     || "#1e1e24";
  const cBord  = theme.text("--border2") || "#2e2e3a";
  const cMuted = theme.text("--text3")   || "#5e5a52";
  const cLine  = theme.text(opts.colorVar || "--gold") || "#7c9cff";

  ctx.fillStyle = cBg3;
  ctx.fillRect(0, 0, W, H);

  if (!dates.length || !values.some(v => v > 0)) {
    ctx.fillStyle = cMuted;
    ctx.font = `10px ${theme.font}`;
    ctx.textAlign = "center";
    ctx.fillText("No data yet", W / 2, H / 2);
    return;
  }

  const leftM = 30, rightM = 10, topM = 12, bottomM = 16;
  const plotW = W - leftM - rightM;
  const plotH = H - topM - bottomM;
  const maxVal = Math.max(...values, 1) * 1.15;

  const xAt = i => dates.length === 1 ? leftM + plotW / 2 : leftM + (plotW / (dates.length - 1)) * i;
  const yAt = v => topM + plotH - (v / maxVal) * plotH;

  ctx.strokeStyle = cBord;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  [0, 0.5, 1].forEach(f => {
    const y = topM + plotH * (1 - f);
    ctx.beginPath(); ctx.moveTo(leftM, y); ctx.lineTo(W - rightM, y); ctx.stroke();
  });
  ctx.setLineDash([]);

  ctx.strokeStyle = cLine;
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = xAt(i), y = yAt(v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = cLine;
  values.forEach((v, i) => {
    ctx.beginPath();
    ctx.arc(xAt(i), yAt(v), 2, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = cMuted;
  ctx.font = `9px ${theme.font}`;
  ctx.textAlign = "left";
  ctx.fillText(String(Math.round(maxVal / 1.15)), 2, topM + 4);
  ctx.fillText("0", 2, topM + plotH);
}

async function renderHabitsAnalyse() {
  const range = document.getElementById("analyseRangeSelect").value;
  const { habits } = await loadHabits();

  // --- Overall habit completion summary ---
  const r = await chrome.storage.local.get(["bodyMetrics", "browserSessions"]);
  const bodyMetrics = r.bodyMetrics || {};
  const browserSessions = r.browserSessions || {};

  const days = range === "all"
    ? Object.keys(habits.reduce((acc, h) => { Object.keys(h.entries || {}).forEach(k => acc[k] = 1); return acc; }, {})).sort()
    : rangeDayKeys(range, {});

  let totalPossible = 0, totalDone = 0;
  const perDayRate = days.map(dayKey => {
    let done = 0;
    habits.forEach(h => { if (h.entries && h.entries[dayKey] !== undefined) done++; });
    totalPossible += habits.length;
    totalDone += done;
    return habits.length ? Math.round((done / habits.length) * 100) : 0;
  });

  const bestStreak = Math.max(0, ...habits.map(h => habitStreak(h)));
  const completionRate = totalPossible ? Math.round((totalDone / totalPossible) * 100) : 0;

  document.getElementById("analyseSummary").innerHTML =
    `<div class="weekly-report-row"><span>Active habits</span><strong>${habits.length}</strong></div>` +
    `<div class="weekly-report-row"><span>🔥 Best current streak</span><strong>${bestStreak} day${bestStreak === 1 ? "" : "s"}</strong></div>` +
    `<div class="weekly-report-row"><span>Completion rate (${range === "all" ? "all time" : "last " + range + "d"})</span><strong>${completionRate}%</strong></div>`;

  drawSimpleLineGraph(document.getElementById("analyseGraph"), days, perDayRate, { colorVar: "--green" });

  // --- Body metrics (height/weight) ---
  const bmDays = range === "all" ? Object.keys(bodyMetrics).sort() : rangeDayKeys(range, bodyMetrics);
  const weights = bmDays.map(d => (bodyMetrics[d] && bodyMetrics[d].weight) || 0);
  drawSimpleLineGraph(document.getElementById("bodyMetricGraph"), bmDays, weights, { colorVar: "--blue" });

  const loggedDays = Object.keys(bodyMetrics).sort();
  const bmSummaryEl = document.getElementById("bodyMetricSummary");
  if (loggedDays.length) {
    const first = bodyMetrics[loggedDays[0]];
    const last = bodyMetrics[loggedDays[loggedDays.length - 1]];
    const weightDelta = (last.weight != null && first.weight != null) ? (last.weight - first.weight).toFixed(1) : null;
    const heightDelta = (last.height != null && first.height != null) ? (last.height - first.height).toFixed(1) : null;
    bmSummaryEl.innerHTML =
      `<div class="weekly-report-row"><span>Latest</span><strong>${last.weight ?? "—"}kg · ${last.height ?? "—"}cm</strong></div>` +
      (weightDelta !== null ? `<div class="weekly-report-row"><span>Weight change since first log</span><strong>${weightDelta > 0 ? "+" : ""}${weightDelta}kg</strong></div>` : "") +
      (heightDelta !== null ? `<div class="weekly-report-row"><span>Height change since first log</span><strong>${heightDelta > 0 ? "+" : ""}${heightDelta}cm</strong></div>` : "");
  } else {
    bmSummaryEl.innerHTML = "";
  }

  // --- Browser session activity ---
  const sessDays = range === "all" ? Object.keys(browserSessions).sort() : rangeDayKeys(range, browserSessions);
  const validSessDays = sessDays.filter(d => browserSessions[d]);
  const bsEl = document.getElementById("browserSessionSummary");
  if (validSessDays.length) {
    const fmtTime = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const todaySess = browserSessions[getTodayKey()];
    const avgFirstMin = Math.round(
      validSessDays.reduce((sum, d) => sum + (new Date(browserSessions[d].first).getHours() * 60 + new Date(browserSessions[d].first).getMinutes()), 0) / validSessDays.length
    );
    const avgH = String(Math.floor(avgFirstMin / 60)).padStart(2, "0");
    const avgM = String(avgFirstMin % 60).padStart(2, "0");
    bsEl.innerHTML =
      (todaySess ? `<div class="weekly-report-row"><span>Today — first seen</span><strong>${fmtTime(todaySess.first)}</strong></div>
         <div class="weekly-report-row"><span>Today — last seen</span><strong>${fmtTime(todaySess.last)}</strong></div>` : "") +
      `<div class="weekly-report-row"><span>Avg. first-open time (${range === "all" ? "all time" : "last " + range + "d"})</span><strong>${avgH}:${avgM}</strong></div>` +
      `<div class="weekly-report-row"><span>Days with activity</span><strong>${validSessDays.length}</strong></div>`;
  } else {
    bsEl.innerHTML = `<span class="empty-state">No browser activity data yet.</span>`;
  }
}

document.getElementById("habitsAnalyseBtn").addEventListener("click", async () => {
  const panel = document.getElementById("habitsAnalysePanel");
  const showing = panel.style.display !== "none";
  if (showing) { panel.style.display = "none"; return; }
  await renderHabitsAnalyse();
  panel.style.display = "";
});

document.getElementById("analyseRangeSelect").addEventListener("change", renderHabitsAnalyse);

document.getElementById("bodyMetricSaveBtn").addEventListener("click", async () => {
  const height = Number(document.getElementById("bodyHeightInput").value) || null;
  const weight = Number(document.getElementById("bodyWeightInput").value) || null;
  if (!height && !weight) return;
  const r = await chrome.storage.local.get("bodyMetrics");
  const bodyMetrics = r.bodyMetrics || {};
  const today = getTodayKey();
  bodyMetrics[today] = { ...(bodyMetrics[today] || {}), ...(height ? { height } : {}), ...(weight ? { weight } : {}) };
  await chrome.storage.local.set({ bodyMetrics });
  document.getElementById("bodyHeightInput").value = "";
  document.getElementById("bodyWeightInput").value = "";
  await renderHabitsAnalyse();
});
