// ===== CODER IITM — youtube-adblock.js =====
// Runs on youtube.com. Auto-skips/fast-forwards video ads and hides ad
// overlays. Network-level ad requests are blocked separately in
// background.js via declarativeNetRequest. Respects the "adBlockEnabled"
// toggle in the Speed tab (defaults ON).

(function () {
  let enabled = true;

  function refreshSetting() {
    try {
      chrome.storage.local.get("adBlockEnabled", (r) => {
        enabled = r.adBlockEnabled !== false;
      });
    } catch { /* extension context may be gone on page unload */ }
  }
  refreshSetting();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.adBlockEnabled) {
        enabled = changes.adBlockEnabled.newValue !== false;
      }
    });
  } catch {}

  function realClick(el) {
    try {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
      el.click(); // belt-and-suspenders fallback
    } catch { try { el.click(); } catch {} }
  }

  function clickSkipButtons() {
    const selectors = [
      ".ytp-ad-skip-button",
      ".ytp-ad-skip-button-modern",
      ".ytp-skip-ad-button",
      ".videoAdUiSkipButton",
      "button.ytp-ad-skip-button-slot",
      ".ytp-ad-skip-button-container button",
      "[class*='ytp-ad-skip-button']",
      ".ytp-ad-overlay-close-button",
      ".ytp-ad-overlay-close-container button",
      "[class*='ytp-ad-overlay-close']"
    ];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(btn => realClick(btn));
    });

    // Fallback: YouTube renames these classes often, which is what silently
    // breaks auto-skip. Catch anything that looks/labels itself as a skip
    // control inside the player, regardless of its current class name.
    document.querySelectorAll(".html5-video-player button, .html5-video-player [role='button']").forEach(el => {
      const label = ((el.getAttribute("aria-label") || "") + " " + (el.textContent || "")).trim().toLowerCase();
      if (!label) return;
      if (label.includes("skip") && el.offsetParent !== null) realClick(el);
    });
  }

  function hideOverlayAds() {
    const overlaySelectors = [
      ".ytp-ad-overlay-container",
      ".ytp-ad-text-overlay",
      "ytd-display-ad-renderer",
      "ytd-promoted-sparkles-web-renderer",
      "ytd-in-feed-ad-layout-renderer",
      "#player-ads",
      "ytd-ad-slot-renderer"
    ];
    overlaySelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => { el.style.display = "none"; });
    });
  }

  // Only fast-forward a given ad ONCE — repeatedly forcing currentTime on
  // every tick (previously: every 500ms + on every single DOM mutation) is
  // what was freezing the player on a black frame. We track whether we've
  // already handled the ad currently showing, and reset that flag once the
  // ad-showing class goes away (i.e. we're back to real content).
  let handledThisAd = false;

  function muteAndFastForwardAd() {
    const player = document.querySelector(".html5-video-player");
    const adShowing = player && player.classList.contains("ad-showing");

    if (!adShowing) { handledThisAd = false; return; }

    const video = document.querySelector("video.html5-main-video");
    if (!video) return;

    // Mute immediately every time (cheap, safe, no side effects on playback).
    try { video.muted = true; } catch {}

    if (handledThisAd) return; // already tried to skip this ad instance
    if (isFinite(video.duration) && video.duration > 0 && video.duration < 90) {
      // Only jump ahead for short ad-length videos, and only once, a bit
      // short of the very end (jumping to the exact end/duration is what
      // was confusing the player into a stuck black frame).
      try {
        video.currentTime = Math.max(0, video.duration - 0.25);
        handledThisAd = true;
      } catch {}
    }
  }

  function tick() {
    if (!enabled) return;
    clickSkipButtons();
    hideOverlayAds();
    muteAndFastForwardAd();
  }

  // Throttle: YouTube's DOM mutates continuously even outside ads (progress
  // bar, captions, recommendations), so an unthrottled MutationObserver was
  // calling tick() far more often than the interval alone — piling on top
  // of the repeated-seek problem above. Cap it to run at most 3x/second.
  let lastMutationTick = 0;
  setInterval(tick, 200);
  const observer = new MutationObserver(() => {
    if (!enabled) return;
    const now = Date.now();
    if (now - lastMutationTick < 150) return;
    lastMutationTick = now;
    tick();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
