// ===== CODER IITM — blocked.js (Matrix Rain) =====

const canvas = document.getElementById("matrix");
const ctx = canvas.getContext("2d");

const CHARS = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$#@%&";
const FONT_SIZE = 14;
let cols, drops;

function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  cols  = Math.floor(canvas.width / FONT_SIZE);
  drops = Array.from({ length: cols }, () => Math.floor(Math.random() * -canvas.height / FONT_SIZE));
}

resize();
window.addEventListener("resize", resize);

function drawMatrix() {
  // Fade trail
  ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = FONT_SIZE + "px 'Share Tech Mono', monospace";

  for (let i = 0; i < cols; i++) {
    const char = CHARS[Math.floor(Math.random() * CHARS.length)];
    const x = i * FONT_SIZE;
    const y = drops[i] * FONT_SIZE;

    // Leading character is bright white
    if (drops[i] >= 0) {
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "#00ff41";
      ctx.shadowBlur = 6;
      ctx.fillText(char, x, y);
    }

    // Trail is neon green
    if (drops[i] > 1) {
      ctx.fillStyle = "#00ff41";
      ctx.shadowColor = "#00ff41";
      ctx.shadowBlur = 3;
      const trailChar = CHARS[Math.floor(Math.random() * CHARS.length)];
      ctx.fillText(trailChar, x, (drops[i] - 1) * FONT_SIZE);
    }

    // Reset drop with random delay
    if (y > canvas.height && Math.random() > 0.975) {
      drops[i] = 0;
    }
    drops[i]++;
  }
}

setInterval(drawMatrix, 40);

// ---- Distraction journal ----
// One tap (or a short note) logging why you ended up on a blocked site.
// Stored locally as distractionLog: [{ ts, site, reason }], newest last,
// capped so it can't grow without bound.
(function () {
  const site = new URLSearchParams(location.search).get("site") || "";
  const done = document.getElementById("journalDone");
  async function log(reason) {
    reason = (reason || "").trim();
    if (!reason) return;
    const r = await chrome.storage.local.get("distractionLog");
    const list = r.distractionLog || [];
    list.push({ ts: Date.now(), site, reason });
    await chrome.storage.local.set({ distractionLog: list.slice(-300) });
    document.querySelector(".journal-chips").style.display = "none";
    document.querySelector(".journal-row").style.display = "none";
    done.style.display = "block";
  }
  document.querySelectorAll(".journal-chip").forEach(b => b.addEventListener("click", () => log(b.dataset.reason)));
  document.getElementById("journalSave").addEventListener("click", () => log(document.getElementById("journalInput").value));
  document.getElementById("journalInput").addEventListener("keydown", e => { if (e.key === "Enter") log(e.target.value); });
})();
