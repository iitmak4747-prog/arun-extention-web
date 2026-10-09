// ===== CODER IITM — background.js v3.0 =====
// 100% ACCURATE — tracks every second via chrome.alarms keepalive
// Works even when Chrome is minimized, tab switched, or popup closed

// Only sites the user explicitly adds get blocked — nothing is blocked by default.
const OLD_HARDCODED_DEFAULTS = [
  "instagram.com","facebook.com","twitter.com","x.com",
  "snapchat.com","tiktok.com","reddit.com","9gag.com",
  "netflix.com","hotstar.com","primevideo.com"
];

let BLOCKED_SITES = [];
let BLOCK_LOCKS = {}; // domain -> ms timestamp the lock expires. While now < that timestamp, the site cannot be removed from BLOCKED_SITES.
const MAX_BLOCK_LOCK_MS = 12 * 60 * 60 * 1000; // hard cap: a timed block can never be set for more than 12 hours
let TIMETABLES = [];
let SUBJECTS = [];
let AUTO_OPENS = [];
let SITE_SUBJECTS = {}; // domain -> subjectId (auto-tracks time on that site into the subject)
let COOLDOWN_MIN = 0;   // 0 = a limit hit locks until midnight (original behavior); >0 = lock for just this many minutes
let LIMIT_BASES = { day: "", total: 0, sites: {} }; // seconds already spent when the last cooldown ended, so the next allowance counts from there
let LOCK_SCOPES = {};   // domain -> "site" | "total": which limit caused a cooldown lock (decides which base to reset when it ends)
let HARD_LOCKS = {}; // domain -> day-key ("2026-09-04") it got hard-locked on. Only counts as active while that key === today's.
let WASTED_LIMIT_SECONDS = 0; // 0 = off. Total time across all BLOCKED_SITES today.
let SITE_LIMITS = {}; // domain -> seconds. Per-site daily limit, independent of the total.

// ---- Single guarded init: prevents any message handler from reading/writing
// SUBJECTS / TIMETABLES / BLOCKED_SITES before storage has actually loaded.
// (Previously each of these loaded independently via a fire-and-forget
// .then(), so a message arriving right after a service-worker wake could
// run against an empty in-memory array and then get silently overwritten
// by the late-resolving storage read — e.g. a newly added subject would
// vanish. Every handler below now awaits stateReadyPromise first.)
let stateReady = false;
const stateReadyPromise = (async () => {
  const r = await chrome.storage.local.get(["blockedSites", "blockLocks", "timetables", "subjects", "autoOpens", "siteSubjects", "blockLockFreedOnceV39", "hardLocks", "wastedTimeLimitSeconds", "siteTimeLimits", "hardLockCooldownMin", "limitBases", "hardLockScopes"]);

  // Migrate away from the old hardcoded default block-list: if what's stored
  // is exactly that untouched default set (i.e. the user never customized
  // it), clear it so nothing is blocked until the user adds a site.
  if (r.blockedSites === undefined) {
    BLOCKED_SITES = [];
  } else {
    const isUntouchedDefault =
      r.blockedSites.length === OLD_HARDCODED_DEFAULTS.length &&
      OLD_HARDCODED_DEFAULTS.every(s => r.blockedSites.includes(s));
    BLOCKED_SITES = isUntouchedDefault ? [] : r.blockedSites;
  }

  TIMETABLES = r.timetables || [];
  SUBJECTS = r.subjects || [];
  AUTO_OPENS = r.autoOpens || [];
  SITE_SUBJECTS = r.siteSubjects || {};
  BLOCK_LOCKS = r.blockLocks || {};
  HARD_LOCKS = r.hardLocks || {};
  COOLDOWN_MIN = Math.max(0, Number(r.hardLockCooldownMin) || 0);
  LIMIT_BASES = r.limitBases || { day: "", total: 0, sites: {} };
  LOCK_SCOPES = r.hardLockScopes || {};
  WASTED_LIMIT_SECONDS = r.wastedTimeLimitSeconds || 0;
  SITE_LIMITS = r.siteTimeLimits || {};

  // One-time migration (v3.9 -> v3.10): any lock that was already active
  // before this update gets freed right now, so it becomes removable
  // immediately. This does NOT touch BLOCKED_SITES — the sites themselves
  // stay in the block list exactly as they were, only the "can't remove
  // yet" restriction on them is lifted. Runs once, ever (flag persisted),
  // so it never interferes with genuine new timed locks added afterward.
  if (!r.blockLockFreedOnceV39) {
    BLOCK_LOCKS = {};
    await chrome.storage.local.set({ blockLockFreedOnceV39: true });
  }

  pruneExpiredLocks(); // drop anything that expired while the browser/extension was closed
  await chrome.storage.local.set({ blockedSites: BLOCKED_SITES, blockLocks: BLOCK_LOCKS });
  stateReady = true;
})();

// Removes any lock whose timer has already run out AND unblocks that site —
// a timed block (added via ADD_BLOCK_LOCK) is only supposed to last until
// its timer ends, so once it expires the domain is removed from
// BLOCKED_SITES too, not just unlocked. Returns true if either BLOCK_LOCKS
// or BLOCKED_SITES changed, so callers know whether to persist + re-check.
function pruneExpiredLocks() {
  const now = Date.now();
  let changed = false;
  for (const domain of Object.keys(BLOCK_LOCKS)) {
    if (BLOCK_LOCKS[domain] <= now) {
      delete BLOCK_LOCKS[domain];
      const idx = BLOCKED_SITES.indexOf(domain);
      if (idx !== -1) { BLOCKED_SITES.splice(idx, 1); }
      chrome.alarms.clear("unblock-" + domain);
      changed = true;
    }
  }
  return changed;
}

// A timed block must not depend solely on the 1-second tick alarm — that
// alarm gets clamped to ~1 minute by Chrome once packed/installed, and can
// be delayed further after long idle periods (exactly what previously made
// auto-open silently miss its time). So every timed lock also gets its own
// one-shot chrome.alarms entry firing exactly at expiry, same pattern as
// POMO_ALARM / auto-open rules — this is what actually guarantees the site
// unblocks itself on time even if the tick alarm is late or throttled.
async function scheduleUnblockAlarm(domain, until) {
  await chrome.alarms.clear("unblock-" + domain);
  chrome.alarms.create("unblock-" + domain, { when: until });
}

async function ensureState() {
  if (!stateReady) await stateReadyPromise;
}

// ---- Helpers ----
// When a blocked site is opened, route to the ARUN PRO study dashboard
// instead of showing the old shaming/blocked screen. The dashboard reads
// existing local records and opens its analytics view for an immediate reset.
function blockedPageUrl(domain) {
  const base = chrome.runtime.getURL("newtab.html");
  return domain ? `${base}?blockedSite=${encodeURIComponent(domain)}&showAnalytics=1` : `${base}?showAnalytics=1`;
}

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return null; }
}

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ---- Timetable helpers ----
function hmToMinutes(hm) {
  if (!hm) return 0;
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + (m || 0);
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// A timetable is "active" (locked + blocking) if the current time falls
// inside its start–end window. Supports overnight windows (e.g. 22:00–02:00).
function isTimetableActive(tt) {
  if (!tt || !tt.start || !tt.end) return false;
  const now = nowMinutes();
  const start = hmToMinutes(tt.start);
  const end = hmToMinutes(tt.end);
  if (start === end) return false;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end; // overnight wrap
}

function getActiveTimetables() {
  return TIMETABLES.filter(isTimetableActive);
}

// A lock value is either today's day-key string (locked until midnight)
// or a millisecond timestamp (cooldown mode — locked until then).
function isHardLocked(domain) {
  if (!domain) return false;
  const v = HARD_LOCKS[domain];
  return typeof v === "number" ? v > Date.now() : v === getTodayKey();
}

function newHardLockValue(dayKey) {
  return COOLDOWN_MIN > 0 ? Date.now() + COOLDOWN_MIN * 60000 : dayKey;
}

// During an active focus-timetable window, the listed sites are an
// ALLOWLIST (study sites) — those work, everything else is blocked until
// the window ends. Outside any active window, only the manual
// BLOCKED_SITES list applies (nothing else is touched).
function isBlocked(domain) {
  if (!domain) return false;
  if (isHardLocked(domain)) return true;
  if (BLOCKED_SITES.some(b => domain === b || domain.endsWith("." + b))) return true;
  const active = getActiveTimetables();
  if (active.length > 0) {
    const allowed = active.some(tt => (tt.sites || []).some(b => domain === b || domain.endsWith("." + b)));
    return !allowed;
  }
  return false;
}

// ---- Wasted-time limit: today's cumulative minutes spent on the sites in
// BLOCKED_SITES (the person's own "distraction list"), checked after every
// second gets flushed. Two independent triggers, either can fire:
//   - a single site crosses ITS OWN per-site limit (SITE_LIMITS[domain])
//   - the TOTAL across every BLOCKED_SITES domain crosses WASTED_LIMIT_SECONDS
// Either one hard-locks the relevant domain(s): added to BLOCKED_SITES if
// not already there, and marked in HARD_LOCKS for today's date — which
// isBlocked() above treats as blocked, and which the popup can never
// remove (see SET_BLOCKED_SITES below) until the day rolls over, since
// HARD_LOCKS[domain] stops matching getTodayKey() automatically at
// midnight — no explicit "clear locks" step needed.
async function checkWastedTimeLimits(justUpdatedDomain) {
  if (!WASTED_LIMIT_SECONDS && Object.keys(SITE_LIMITS).length === 0) return;
  const key = getTodayKey();
  const r = await chrome.storage.local.get("timeData");
  const today = (r.timeData && r.timeData[key]) || {};
  let changed = false;

  // The "already spent when the last cooldown ended" baselines are per-day.
  if (LIMIT_BASES.day !== key) { LIMIT_BASES = { day: key, total: 0, sites: {} }; changed = true; }

  const totalNow = BLOCKED_SITES.reduce((sum, d) => sum + (today[d] || 0), 0);

  // Cooldown locks that have run out: free the domain and start a fresh
  // allowance counted from this point (otherwise the very next flush would
  // see the old total still over the limit and lock it straight back).
  for (const d of Object.keys(HARD_LOCKS)) {
    if (typeof HARD_LOCKS[d] === "number" && HARD_LOCKS[d] <= Date.now()) {
      delete HARD_LOCKS[d];
      if (LOCK_SCOPES[d] === "total") LIMIT_BASES.total = totalNow;
      else LIMIT_BASES.sites[d] = today[d] || 0;
      delete LOCK_SCOPES[d];
      changed = true;
    }
  }

  // Per-site limit
  if (justUpdatedDomain && SITE_LIMITS[justUpdatedDomain] && !isHardLocked(justUpdatedDomain)) {
    const spent = (today[justUpdatedDomain] || 0) - (LIMIT_BASES.sites[justUpdatedDomain] || 0);
    if (spent >= SITE_LIMITS[justUpdatedDomain]) {
      HARD_LOCKS[justUpdatedDomain] = newHardLockValue(key);
      LOCK_SCOPES[justUpdatedDomain] = "site";
      if (!BLOCKED_SITES.includes(justUpdatedDomain)) BLOCKED_SITES.push(justUpdatedDomain);
      changed = true;
    }
  }

  // Total-wasted-time limit, across every BLOCKED_SITES domain
  if (WASTED_LIMIT_SECONDS) {
    const total = totalNow - (LIMIT_BASES.total || 0);
    if (total >= WASTED_LIMIT_SECONDS) {
      for (const d of BLOCKED_SITES) {
        if (!isHardLocked(d)) { HARD_LOCKS[d] = newHardLockValue(key); LOCK_SCOPES[d] = "total"; changed = true; }
      }
    }
  }

  if (changed) {
    await chrome.storage.local.set({ blockedSites: BLOCKED_SITES, hardLocks: HARD_LOCKS, limitBases: LIMIT_BASES, hardLockScopes: LOCK_SCOPES });
  }
}

// ---- Task scheduling & notifications ----
// Each scheduled task gets up to 3 one-shot alarms named "task-<id>-r0/1/2"
// (2h before, 1h before, at the due time) — same reliable dedicated-alarm
// pattern as unblock-<domain> elsewhere in this file, not a polling loop.
// On the final reminder (r2, the due time), a repeating task reschedules
// itself for its next occurrence and re-arms its own 3 alarms; a one-off
// task just fires once and is left for the person to mark done or delete.
function taskAlarmName(id, i) { return `task-${id}-r${i}`; }

async function clearTaskAlarms(id) {
  await Promise.all([0, 1, 2].map(i => chrome.alarms.clear(taskAlarmName(id, i))));
}

// ---- Ambient focus sounds ----
// Setting lives in storage as `ambient: { sound: "off"|"white"|"pink"|"brown"|"rain",
// volume: 0-1, onlyDuringStudy: bool }`. The actual audio is generated in a
// hidden offscreen page so it survives the popup closing.
async function ensureOffscreenAudio() {
  try {
    if (await chrome.offscreen.hasDocument()) return true;
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play ambient focus sounds while the popup is closed"
    });
    return true;
  } catch { return false; }
}

async function applyAmbient() {
  const r = await chrome.storage.local.get("ambient");
  const a = r.ambient || { sound: "off", volume: 0.4, onlyDuringStudy: false };
  let shouldPlay = a.sound && a.sound !== "off";
  if (shouldPlay && a.onlyDuringStudy) {
    const st = await getPomoState();
    shouldPlay = !!(st.running && st.phase === "study");
  }
  if (shouldPlay) {
    if (!(await ensureOffscreenAudio())) return;
    try { await chrome.runtime.sendMessage({ target: "offscreen", type: "AMBIENT_PLAY", sound: a.sound, volume: a.volume }); } catch {}
  } else {
    try { if (await chrome.offscreen.hasDocument()) await chrome.runtime.sendMessage({ target: "offscreen", type: "AMBIENT_STOP" }); } catch {}
  }
}

// ---- Assignment deadlines ----
// Stored as `assignments: [{id, name, course, due(ms), weight}]`. Every time
// the list changes the popup sends SYNC_ASSIGNMENT_ALARMS and we rebuild the
// whole set: a reminder 1 day before and 2 hours before each future due date.
async function syncAssignmentAlarms() {
  const all = await chrome.alarms.getAll();
  await Promise.all(all.filter(a => a.name.startsWith("assign-")).map(a => chrome.alarms.clear(a.name)));
  const r = await chrome.storage.local.get("assignments");
  for (const a of (r.assignments || [])) {
    if (!a.due || a.done) continue;
    [[24 * 3600000, "d"], [2 * 3600000, "h"]].forEach(([off, tag]) => {
      const when = a.due - off;
      if (when > Date.now()) chrome.alarms.create(`assign-${a.id}-${tag}`, { when });
    });
  }
}

async function handleAssignmentAlarm(alarmName) {
  const m = alarmName.match(/^assign-(.+)-([dh])$/);
  if (!m) return;
  const r = await chrome.storage.local.get("assignments");
  const a = (r.assignments || []).find(x => String(x.id) === m[1]);
  if (!a || a.done) return;
  try {
    chrome.notifications.create(`assign-n-${Date.now()}`, {
      type: "basic", iconUrl: "icon.png",
      title: m[2] === "d" ? "🎓 Due tomorrow" : "🎓 Due in 2 hours",
      message: `${a.name}${a.course ? " — " + a.course : ""}`,
      priority: 2
    });
  } catch {}
}

async function scheduleTaskAlarms(task) {
  await clearTaskAlarms(task.id);
  if (!task.scheduledAt || task.done) return;
  const offsets = [2 * 3600000, 1 * 3600000, 0]; // 2h before, 1h before, at due time
  offsets.forEach((off, i) => {
    const when = task.scheduledAt - off;
    if (when > Date.now()) chrome.alarms.create(taskAlarmName(task.id, i), { when });
  });
}

function nextTaskOccurrence(scheduledAt, repeat, repeatDays) {
  const d = new Date(scheduledAt);
  if (repeat === "daily") { d.setDate(d.getDate() + 1); return d.getTime(); }
  if (repeat === "weekly") { d.setDate(d.getDate() + 7); return d.getTime(); }
  if (repeat === "custom" && Array.isArray(repeatDays) && repeatDays.length) {
    for (let add = 1; add <= 7; add++) {
      const cand = new Date(d);
      cand.setDate(cand.getDate() + add);
      if (repeatDays.includes(cand.getDay())) return cand.getTime();
    }
  }
  return null;
}

async function handleTaskAlarm(alarmName) {
  const m = alarmName.match(/^task-(.+)-r(\d)$/);
  if (!m) return;
  const id = m[1];
  const step = Number(m[2]);
  const r = await chrome.storage.local.get("tasks");
  const tasks = r.tasks || [];
  const task = tasks.find(t => String(t.id) === id);
  if (!task || task.done) return;

  const labels = ["⏰ 2 hours left", "⏰ 1 hour left", "🔔 Task due now"];
  try {
    chrome.notifications.create(`task-notif-${id}-${step}-${Date.now()}`, {
      type: "basic",
      iconUrl: "icon.png",
      title: labels[step] || "Task reminder",
      message: task.text
    });
  } catch {
    // notifications permission missing/denied — reminders just silently
    // don't show rather than breaking anything else.
  }

  if (step === 2 && task.repeat && task.repeat !== "none") {
    const next = nextTaskOccurrence(task.scheduledAt, task.repeat, task.repeatDays);
    if (next) {
      task.scheduledAt = next;
      await chrome.storage.local.set({ tasks });
      await scheduleTaskAlarms(task);
    }
  }
}

// ---- Auto-Open (scheduled link opener) ----
// Two kinds of rule:
//  - "daily": fires once at a specific HH:MM every day
//  - "interval": fires every N minutes
// Each rule gets its own real chrome.alarms entry (name === rule.id) so it
// fires exactly on schedule via the browser's alarm scheduler — it no
// longer depends on the 1-second keepalive tick surviving, which is what
// made auto-open silently miss its time whenever that tick got throttled
// after the service worker went idle.
function nextDailyTimestamp(hhmm) {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m || 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime();
}

async function scheduleAutoOpen(rule) {
  await chrome.alarms.clear(rule.id);
  if (rule.mode === "daily") {
    chrome.alarms.create(rule.id, { when: nextDailyTimestamp(rule.time) });
  } else if (rule.mode === "interval") {
    const mins = Math.max(1, rule.intervalMinutes || 1);
    chrome.alarms.create(rule.id, { delayInMinutes: mins, periodInMinutes: mins });
  }
}

async function fireAutoOpen(rule) {
  try { await chrome.tabs.create({ url: rule.url, active: false }); } catch {}
  // One-shot "daily" alarms don't repeat on their own — reschedule for
  // tomorrow. "interval" alarms already repeat via periodInMinutes.
  if (rule.mode === "daily") await scheduleAutoOpen(rule);
}

// ---- TRACKING STATE (in-memory, persisted every second) ----
let activeTabId     = null;
let activeTabDomain = null;
let activeTabStart  = null; // timestamp in ms when current session started
let pomoLastTick    = null; // timestamp in ms of the last credited pomo tick

// ---- Flush: write elapsed seconds to storage ----
async function flushSeconds(domain, secs, startedAt = Date.now() - Math.max(0, Number(secs) || 0) * 1000) {
  const amount = Number(secs);
  if (!domain || !Number.isFinite(amount) || amount <= 0) return;
  const intervalStart = Number.isFinite(Number(startedAt)) ? Number(startedAt) : Date.now() - amount * 1000;
  const intervalEnd = intervalStart + amount * 1000;
  const r = await chrome.storage.local.get(["timeData", "hourlyTimeData"]);
  const timeData = r.timeData && typeof r.timeData === "object" ? r.timeData : {};
  const hourlyTimeData = r.hourlyTimeData && typeof r.hourlyTimeData === "object" ? r.hourlyTimeData : {};

  // New hourly records start now; historic daily totals cannot be backfilled honestly.
  // Split a flushed interval across local date/hour boundaries for accurate hour-of-day charts.
  let cursor = intervalStart;
  let guard = 0;
  while (cursor < intervalEnd && guard++ < 50000) {
    const d = new Date(cursor);
    if (!Number.isFinite(d.getTime())) break;
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const hourKey = String(d.getHours()).padStart(2, "0");
    const nextHour = new Date(d);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    const nextCursor = Math.min(intervalEnd, nextHour.getTime());
    const chunk = Math.max(0, (nextCursor - cursor) / 1000);
    if (chunk > 0) {
      // Daily totals and hourly breakdown share the same date bucket, including intervals crossing midnight.
      if (!timeData[dateKey] || typeof timeData[dateKey] !== "object") timeData[dateKey] = {};
      timeData[dateKey][domain] = (Number(timeData[dateKey][domain]) || 0) + chunk;
      if (!hourlyTimeData[dateKey] || typeof hourlyTimeData[dateKey] !== "object") hourlyTimeData[dateKey] = {};
      if (!hourlyTimeData[dateKey][hourKey] || typeof hourlyTimeData[dateKey][hourKey] !== "object") hourlyTimeData[dateKey][hourKey] = {};
      hourlyTimeData[dateKey][hourKey][domain] = (Number(hourlyTimeData[dateKey][hourKey][domain]) || 0) + chunk;
    }
    if (nextCursor <= cursor) break;
    cursor = nextCursor;
  }
  await chrome.storage.local.set({ timeData, hourlyTimeData });
  await checkWastedTimeLimits(domain);
}

// ---- Flush real elapsed study-seconds into total + per-subject pomodoro time ----
async function flushPomoSecond(subjectId, secs = 1) {
  if (secs <= 0) return;
  const key = getTodayKey();
  const r = await chrome.storage.local.get(["pomoStudySeconds", "subjectTime"]);
  const pomoStudySeconds = r.pomoStudySeconds || {};
  pomoStudySeconds[key] = (pomoStudySeconds[key] || 0) + secs;

  const subjectTime = r.subjectTime || {};
  if (subjectId) {
    if (!subjectTime[key]) subjectTime[key] = {};
    subjectTime[key][subjectId] = (subjectTime[key][subjectId] || 0) + secs;
  }
  await chrome.storage.local.set({ pomoStudySeconds, subjectTime });
}

// ---- Flush seconds into a subject's time via a site->subject link
// (auto-tracking — independent of whether the Pomodoro timer is running) ----
async function flushSubjectSecond(subjectId, secs = 1) {
  if (!subjectId || secs <= 0) return;
  const key = getTodayKey();
  const r = await chrome.storage.local.get("subjectTime");
  const subjectTime = r.subjectTime || {};
  if (!subjectTime[key]) subjectTime[key] = {};
  subjectTime[key][subjectId] = (subjectTime[key][subjectId] || 0) + secs;
  await chrome.storage.local.set({ subjectTime });
}

// ---- Called by alarm every 1 second ----
// ---- Browser session tracking (for the Habits Analyse tab) — when the
// browser was first active today and when it was last seen active. Runs
// on every tick (roughly once a minute), which is a reasonable proxy for
// "browser open" since there's no reliable extension-side event for
// "browser closing" to hook instead.
async function updateBrowserSession() {
  const key = getTodayKey();
  const now = Date.now();
  const r = await chrome.storage.local.get("browserSessions");
  const sessions = r.browserSessions || {};
  if (!sessions[key]) sessions[key] = { first: now, last: now };
  else sessions[key].last = now;
  await chrome.storage.local.set({ browserSessions: sessions });
}

async function onTick() {
  await ensureState();
  await updateBrowserSession();

  // Auto-unblock any site whose timed block just ran out — this must happen
  // every tick (not just when the popup is opened), otherwise a site stays
  // blocked forever after its interval ends until someone manually opens
  // the popup and removes it.
  if (pruneExpiredLocks()) {
    await chrome.storage.local.set({ blockedSites: BLOCKED_SITES, blockLocks: BLOCK_LOCKS });
  }

  // Update active tab tracking
  if (activeTabDomain && activeTabStart) {
    const now = Date.now();
    // Flush every second
    await flushSeconds(activeTabDomain, 1, activeTabStart);
    activeTabStart = now; // reset start to now (we already flushed this second)
    // Keep the recovery marker current; a restarted service worker must not credit a long stale interval twice.
    await chrome.storage.local.set({ activeTracking: { tabId: activeTabId, domain: activeTabDomain, start: activeTabStart } });

    // Re-check block status every tick — a focus timetable window can
    // switch on mid-session and should block immediately.
    if (isBlocked(activeTabDomain) && activeTabId) {
      chrome.tabs.update(activeTabId, { url: blockedPageUrl(activeTabDomain) });
      await stopTracking();
    }
  }

  // Accumulate pomodoro study time (only while running + in the study phase).
  // Uses the real elapsed time since the last tick (clamped) rather than a
  // flat 1 second, so the count stays accurate even if a tick is delayed.
  const pomoState = await getPomoState();
  if (pomoState.running && pomoState.phase === "study") {
    const now = Date.now();
    let delta = pomoLastTick ? (now - pomoLastTick) / 1000 : 1;
    delta = Math.min(Math.max(delta, 0), 5); // clamp: avoid inflating after a sleep/suspend gap
    await flushPomoSecond(pomoState.subjectId || null, delta);
    pomoLastTick = now;
  } else {
    pomoLastTick = null;
  }

  // Auto-allocate this second of site time to a subject, if the current
  // site has been linked to one — independent of whether Pomodoro is
  // running. Skip it if Pomodoro is already crediting this exact subject
  // this tick, so the second isn't counted twice.
  if (activeTabDomain) {
    const mapped = SITE_SUBJECTS[activeTabDomain];
    const pomoCredited = (pomoState.running && pomoState.phase === "study") ? (pomoState.subjectId || null) : null;
    if (mapped && mapped !== pomoCredited) {
      await flushSubjectSecond(mapped, 1);
    }
  }
}

// ---- Start tracking a domain ----
async function startTracking(tabId, domain) {
  // Stop previous if different
  if (activeTabDomain && activeTabDomain !== domain && activeTabStart) {
    const elapsed = (Date.now() - activeTabStart) / 1000;
    if (elapsed > 0) await flushSeconds(activeTabDomain, elapsed, activeTabStart);
  }
  activeTabId     = tabId;
  activeTabDomain = domain;
  activeTabStart  = Date.now();
  // Persist active state so alarm tick can work even after SW restart
  await chrome.storage.local.set({
    activeTracking: { tabId, domain, start: activeTabStart }
  });
}

// ---- Stop tracking ----
async function stopTracking() {
  if (activeTabDomain && activeTabStart) {
    const elapsed = (Date.now() - activeTabStart) / 1000;
    if (elapsed > 0) await flushSeconds(activeTabDomain, elapsed, activeTabStart);
  }
  activeTabId     = null;
  activeTabDomain = null;
  activeTabStart  = null;
  await chrome.storage.local.remove("activeTracking");
}

// ---- Handle tab focus changes ----
async function handleTabFocus(tabId) {
  try {
    await ensureState();
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.url.startsWith("chrome") || tab.url.startsWith("about") || tab.url.startsWith("chrome-extension:")) {
      await stopTracking(); return;
    }
    const domain = getDomain(tab.url);
    if (isBlocked(domain)) {
      chrome.tabs.update(tabId, { url: blockedPageUrl(domain) });
      await stopTracking(); return;
    }
    if (domain) await startTracking(tabId, domain);
    else await stopTracking();
  } catch { await stopTracking(); }
}

// ---- Alarm: 1-second keepalive + tick ----
const TICK_ALARM   = "tickAlarm";
const POMO_ALARM   = "pomoAlarm";
const EYE_REST_ALARM = "eyeRestAlarm";
const CUSTOM_REMINDER_ALARM = "arunCustomDailyReminder";

// ---- Eye-rest reminders (20-20-20 rule) ----
async function setEyeRestEnabled(enabled) {
  await chrome.storage.local.set({ eyeRestEnabled: !!enabled });
  if (enabled) {
    const existing = await chrome.alarms.get(EYE_REST_ALARM);
    if (!existing) chrome.alarms.create(EYE_REST_ALARM, { periodInMinutes: 20 });
  } else {
    await chrome.alarms.clear(EYE_REST_ALARM);
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === EYE_REST_ALARM) {
    try {
      chrome.notifications.create(`eyerest-${Date.now()}`, {
        type: "basic",
        iconUrl: "icon.png",
        title: "👁️ Eye rest — 20-20-20 rule",
        message: "Look at something 20 feet away for 20 seconds."
      });
    } catch {
      // notifications permission missing/denied — skip silently
    }
    return;
  }
  if (alarm.name === CUSTOM_REMINDER_ALARM) {
    const saved = (await chrome.storage.local.get("arunCustomReminder")).arunCustomReminder || {};
    if (saved.enabled) {
      try {
        chrome.notifications.create(`arun-reminder-${Date.now()}`, {
          type: "basic", iconUrl: "icon.png", title: "ARUN PRO · Reminder",
          message: String(saved.message || "Time for your planned study check-in.").slice(0, 220), priority: 0
        });
      } catch (err) { console.warn("Custom reminder notification unavailable", err); }
    }
    return;
  }
  if (alarm.name === TICK_ALARM) {
    await onTick();
    return;
  }
  if (alarm.name === POMO_ALARM) {
    await handlePomoAlarm();
    return;
  }
  if (alarm.name.startsWith("ao-")) {
    await ensureState();
    const rule = AUTO_OPENS.find(r => r.id === alarm.name);
    if (rule) await fireAutoOpen(rule);
    return;
  }
  if (alarm.name.startsWith("habit-reminder-")) {
    await ensureState();
    await handleHabitAlarm(alarm.name);
    return;
  }
  if (alarm.name.startsWith("assign-")) {
    await handleAssignmentAlarm(alarm.name);
    return;
  }
  if (alarm.name.startsWith("task-")) {
    await ensureState();
    await handleTaskAlarm(alarm.name);
    return;
  }
  if (alarm.name.startsWith("unblock-")) {
    // Fires exactly at a timed block's expiry — the reliable path.
    // pruneExpiredLocks() re-checks everything (cheap, and covers any other
    // lock that happens to be due at the same moment) rather than trusting
    // alarm.name alone to know which domain is actually due.
    await ensureState();
    if (pruneExpiredLocks()) {
      await chrome.storage.local.set({ blockedSites: BLOCKED_SITES, blockLocks: BLOCK_LOCKS });
    }
  }
});

// ---- On install / SW startup: restore state + create alarm ----
async function init() {
  await ensureState();
  const savedReminder = (await chrome.storage.local.get("arunCustomReminder")).arunCustomReminder || {};
  if (savedReminder.enabled && /^([01]\d|2[0-3]):[0-5]\d$/.test(savedReminder.time || "")) {
    const reminderAlarm = await chrome.alarms.get(CUSTOM_REMINDER_ALARM);
    if (!reminderAlarm) chrome.alarms.create(CUSTOM_REMINDER_ALARM, { when: nextDailyTimestamp(savedReminder.time), periodInMinutes: 1440 });
  } else {
    await chrome.alarms.clear(CUSTOM_REMINDER_ALARM);
  }
  await applyAdBlockRules(); // reads adBlockEnabled from storage (defaults ON)
  await updateBadge();
  // Restore active tracking from storage (in case SW restarted)
  const r = await chrome.storage.local.get("activeTracking");
  if (r.activeTracking) {
    const { tabId, domain, start } = r.activeTracking;
    // Check if that tab still exists and is active
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.active) {
        activeTabId     = tabId;
        activeTabDomain = domain;
        // Flush missed seconds from when SW was dead
        const missedSec = Math.floor((Date.now() - start) / 1000);
        if (missedSec > 0) await flushSeconds(domain, missedSec, start);
        activeTabStart = Date.now();
      }
    } catch { await chrome.storage.local.remove("activeTracking"); }
  }

  // Ensure 1-second tick alarm is always running
  const existing = await chrome.alarms.get(TICK_ALARM);
  if (!existing) {
    chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1/60 }); // every ~1 sec
  }

  // Restore pomo alarm if it was running
  const ps = await getPomoState();
  if (ps.running && ps.endTime && ps.endTime > Date.now()) {
    const existing = await chrome.alarms.get(POMO_ALARM);
    if (!existing) chrome.alarms.create(POMO_ALARM, { when: ps.endTime });
  }

  // Re-arm any auto-open rules whose alarm went missing (e.g. the
  // extension was updated/reloaded and the browser dropped it).
  for (const rule of AUTO_OPENS) {
    const existing = await chrome.alarms.get(rule.id);
    if (!existing) await scheduleAutoOpen(rule);
  }

  // Same re-arm safety net for timed block locks — if the extension was
  // updated/reloaded and Chrome dropped the "unblock-<domain>" alarm, any
  // lock still active in storage gets its alarm recreated here so it still
  // unblocks on time instead of staying blocked forever.
  for (const domain of Object.keys(BLOCK_LOCKS)) {
    const existing = await chrome.alarms.get("unblock-" + domain);
    if (!existing) await scheduleUnblockAlarm(domain, BLOCK_LOCKS[domain]);
  }

  // Same re-arm safety net for scheduled tasks — re-create any missing
  // reminder alarms for tasks that are still pending and still due in
  // the future (a task whose due time already passed while the browser
  // was closed just doesn't get a stale reminder re-armed for it).
  const tr = await chrome.storage.local.get("tasks");
  const tasks = tr.tasks || [];
  for (const task of tasks) {
    if (!task.scheduledAt || task.done) continue;
    let anyMissing = false;
    for (let i = 0; i < 3; i++) {
      if (!(await chrome.alarms.get(taskAlarmName(task.id, i)))) { anyMissing = true; break; }
    }
    if (anyMissing) await scheduleTaskAlarms(task);
  }

  // Same re-arm safety net for the eye-rest reminder.
  const er = await chrome.storage.local.get("eyeRestEnabled");
  if (er.eyeRestEnabled) {
    const existing = await chrome.alarms.get(EYE_REST_ALARM);
    if (!existing) chrome.alarms.create(EYE_REST_ALARM, { periodInMinutes: 20 });
  }

  // And for habit reminders — each habit with its own reminderTime gets
  // its daily alarm re-armed if it went missing.
  const hr = await chrome.storage.local.get("habits");
  const habits = hr.habits || [];
  for (const habit of habits) {
    if (!habit.reminderTime) continue;
    if (!(await chrome.alarms.get(habitAlarmName(habit.id)))) await scheduleHabitAlarm(habit);
  }
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

// Also run init on SW activation
// ---- Keyboard shortcut: quick-add a task from anywhere ----
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "quick-add-task") {
    await chrome.storage.local.set({ quickAddTaskRequested: true });
    try { await chrome.action.openPopup(); } catch {
      // openPopup() needs a window with focus — if that's unavailable this
      // tick, the flag is still saved and the popup will pick it up the
      // next time it's opened normally.
    }
    return;
  }
  if (command === "quick-add-note") {
    // Grab the current tab's title/URL now, while it's still the active
    // tab — by the time the popup opens, focus has already moved to the
    // extension, so the popup itself can no longer reliably query "the
    // tab the person was just looking at".
    let tabInfo = null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("chrome-extension://")) {
        tabInfo = { title: tab.title || "", url: tab.url };
      }
    } catch {
      // tabs permission issue or no active tab — note still opens, just without the auto-attached link
    }
    await chrome.storage.local.set({ quickAddNoteRequested: true, quickAddNoteTabInfo: tabInfo });
    try { await chrome.action.openPopup(); } catch {
      // same fallback as above — flag + tab info are saved either way
    }
  }
});

// ---- Habit reminders ----
// One person-set time per habit, re-fires every day (periodInMinutes)
// rather than a one-shot — the reminder should keep coming back daily
// until the habit is deleted or its reminder is turned off, unlike a
// task's alarms which are meant to fire only a few times total.
function habitAlarmName(id) { return `habit-reminder-${id}`; }

async function clearHabitAlarm(id) {
  await chrome.alarms.clear(habitAlarmName(id));
}

async function scheduleHabitAlarm(habit) {
  await clearHabitAlarm(habit.id);
  if (!habit.reminderTime) return;
  const [hh, mm] = String(habit.reminderTime).split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return;
  const when = new Date();
  when.setHours(hh, mm, 0, 0);
  if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 1);
  chrome.alarms.create(habitAlarmName(habit.id), { when: when.getTime(), periodInMinutes: 24 * 60 });
}

async function handleHabitAlarm(alarmName) {
  const m = alarmName.match(/^habit-reminder-(.+)$/);
  if (!m) return;
  const id = m[1];
  const r = await chrome.storage.local.get("habits");
  const habits = r.habits || [];
  const habit = habits.find(h => String(h.id) === id);
  if (!habit) { await clearHabitAlarm(id); return; } // habit deleted — stop reminding
  const today = getTodayKey();
  if (habit.entries && habit.entries[today] !== undefined) return; // already logged today
  try {
    chrome.notifications.create(`habit-notif-${id}-${Date.now()}`, {
      type: "basic",
      iconUrl: "icon.png",
      title: "🔔 Habit reminder",
      message: `Don't forget: ${habit.name}`
    });
  } catch {
    // notifications permission missing/denied — skip silently
  }
}

// ---- Toolbar badge: pending task count for TODAY only (unscheduled +
// scheduled for today) — matches the popup's "Pending" status, so a
// task scheduled for a future date doesn't inflate the badge. Updates
// live via storage.onChanged, so it stays correct even when tasks are
// added/completed while the popup is closed.
function taskDateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isTaskUpcoming(t) {
  if (!t.scheduledAt) return false;
  return taskDateKey(t.scheduledAt) > getTodayKey();
}

async function updateBadge() {
  const r = await chrome.storage.local.get("tasks");
  const tasks = r.tasks || [];
  const pending = tasks.filter(t => !t.done && !isTaskUpcoming(t)).length;
  try {
    chrome.action.setBadgeText({ text: pending > 0 ? String(pending) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#7c9cff" });
  } catch {
    // action API can be briefly unavailable right after an update — skip
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.tasks) updateBadge();
});

init();

// ---- Tab Events ----
chrome.tabs.onActivated.addListener(({ tabId }) => handleTabFocus(tabId));

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url || tab.url.startsWith("chrome") || tab.url.startsWith("about") || tab.url.startsWith("chrome-extension:")) return;
  await ensureState();
  const domain = getDomain(tab.url);
  if (isBlocked(domain)) {
    chrome.tabs.update(tabId, { url: blockedPageUrl(domain) });
    await stopTracking(); return;
  }
  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active && active.id === tabId) await startTracking(tabId, domain);
  } catch {}
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === activeTabId) await stopTracking();
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Don't stop tracking when window loses focus (user minimized)
    // Just keep tracking the last active tab
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab) await handleTabFocus(tab.id);
    else await stopTracking();
  } catch {}
});

// ---- Messages ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SET_CUSTOM_REMINDER") {
    (async () => {
      const input = msg.reminder && typeof msg.reminder === "object" ? msg.reminder : {};
      const reminder = {
        enabled: !!input.enabled,
        time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.time || "")) ? String(input.time) : "09:00",
        message: String(input.message || "Time for your planned study check-in.").trim().slice(0, 220)
      };
      await chrome.storage.local.set({ arunCustomReminder: reminder });
      await chrome.alarms.clear(CUSTOM_REMINDER_ALARM);
      if (reminder.enabled) chrome.alarms.create(CUSTOM_REMINDER_ALARM, { when: nextDailyTimestamp(reminder.time), periodInMinutes: 1440 });
      sendResponse({ ok: true, enabled: reminder.enabled, time: reminder.time });
    })().catch(err => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }
  if (msg.type === "GET_LIVE_STATUS") {
    const elapsed = (activeTabStart && activeTabDomain)
      ? Math.floor((Date.now() - activeTabStart) / 1000)
      : 0;
    sendResponse({ domain: activeTabDomain, elapsedSeconds: elapsed });
  }

  if (msg.type === "SCHEDULE_HABIT_REMINDER") {
    (async () => {
      await scheduleHabitAlarm(msg.habit);
      sendResponse({ ok: true });
    })(); return true;
  }

  if (msg.type === "CLEAR_HABIT_REMINDER") {
    (async () => {
      await clearHabitAlarm(msg.id);
      sendResponse({ ok: true });
    })(); return true;
  }

  if (msg.type === "SCHEDULE_TASK") {
    (async () => {
      await scheduleTaskAlarms(msg.task);
      sendResponse({ ok: true });
    })(); return true;
  }

  if (msg.type === "CLEAR_TASK_ALARMS") {
    (async () => {
      await clearTaskAlarms(msg.id);
      sendResponse({ ok: true });
    })(); return true;
  }

  if (msg.type === "GET_WASTED_TIME") {
    (async () => {
      await ensureState();
      const key = getTodayKey();
      const r = await chrome.storage.local.get("timeData");
      const today = (r.timeData && r.timeData[key]) || {};
      const perSite = {};
      BLOCKED_SITES.forEach(d => { perSite[d] = today[d] || 0; });
      const total = Object.values(perSite).reduce((a, b) => a + b, 0);
      sendResponse({
        total,
        perSite,
        wastedLimitSeconds: WASTED_LIMIT_SECONDS,
        siteLimits: SITE_LIMITS,
        hardLocked: Object.keys(HARD_LOCKS).filter(isHardLocked)
      });
    })(); return true;
  }

  if (msg.type === "SET_EYE_REST") {
    (async () => {
      await setEyeRestEnabled(msg.enabled);
      sendResponse({ ok: true });
    })(); return true;
  }

  if (msg.type === "SET_WASTED_TIME_LIMIT") {
    (async () => {
      await ensureState();
      WASTED_LIMIT_SECONDS = Math.max(0, Number(msg.seconds) || 0);
      await chrome.storage.local.set({ wastedTimeLimitSeconds: WASTED_LIMIT_SECONDS });
      sendResponse({ ok: true });
    })(); return true;
  }

  if (msg.type === "SET_SITE_TIME_LIMIT") {
    (async () => {
      await ensureState();
      const seconds = Math.max(0, Number(msg.seconds) || 0);
      if (seconds > 0) SITE_LIMITS[msg.domain] = seconds;
      else delete SITE_LIMITS[msg.domain];
      await chrome.storage.local.set({ siteTimeLimits: SITE_LIMITS });
      sendResponse({ ok: true, siteLimits: SITE_LIMITS });
    })(); return true;
  }

  if (msg.type === "GET_BLOCKED_SITES") {
    (async () => {
      await ensureState();
      if (pruneExpiredLocks()) {
        await chrome.storage.local.set({ blockedSites: BLOCKED_SITES, blockLocks: BLOCK_LOCKS });
      }
      sendResponse({ sites: BLOCKED_SITES });
    })(); return true;
  }

  if (msg.type === "SET_BLOCKED_SITES") {
    (async () => {
      await ensureState();
      pruneExpiredLocks();
      const now = Date.now();
      // A site currently under an active lock can never be dropped from the
      // new list, no matter what the caller sent — this is enforced here
      // (the source of truth) rather than only in the popup UI, so a locked
      // site can't be removed by any path, not just the visible Remove button.
      // Same rule for a wasted-time hard lock — it can't be edited away
      // either, only expires naturally once the day rolls over.
      const stillLocked = BLOCKED_SITES.filter(
        s => (BLOCK_LOCKS[s] && BLOCK_LOCKS[s] > now || isHardLocked(s)) && !msg.sites.includes(s)
      );
      BLOCKED_SITES = [...new Set([...msg.sites, ...stillLocked])];
      await chrome.storage.local.set({ blockedSites: BLOCKED_SITES, blockLocks: BLOCK_LOCKS });
      sendResponse({ ok: true, blockedLocked: stillLocked });
    })(); return true;
  }

  if (msg.type === "ADD_BLOCK_LOCK") {
    // Starts (or extends) a timed lock on an already-blocked site: until
    // msg.until (ms epoch), that site cannot be removed from BLOCKED_SITES
    // by SET_BLOCKED_SITES above, from this popup or any other caller.
    (async () => {
      await ensureState();
      if (typeof msg.domain === "string" && typeof msg.until === "number") {
        if (!BLOCKED_SITES.includes(msg.domain)) BLOCKED_SITES.push(msg.domain);
        // Hard cap: no timed block can run longer than 12 hours from now,
        // no matter what the caller requested.
        const cappedUntil = Math.min(msg.until, Date.now() + MAX_BLOCK_LOCK_MS);
        // Only ever extend a lock, never shorten one that's already running —
        // otherwise re-adding the same site with a short/zero duration would
        // be a trivial way to cancel an existing lock early. Still capped at
        // 12 hours total even when extending.
        BLOCK_LOCKS[msg.domain] = Math.min(
          Math.max(BLOCK_LOCKS[msg.domain] || 0, cappedUntil),
          Date.now() + MAX_BLOCK_LOCK_MS
        );
        await chrome.storage.local.set({ blockedSites: BLOCKED_SITES, blockLocks: BLOCK_LOCKS });
        await scheduleUnblockAlarm(msg.domain, BLOCK_LOCKS[msg.domain]);
      }
      sendResponse({ ok: true, locks: BLOCK_LOCKS });
    })(); return true;
  }

  if (msg.type === "GET_BLOCK_LOCKS") {
    (async () => {
      await ensureState();
      pruneExpiredLocks();
      await chrome.storage.local.set({ blockedSites: BLOCKED_SITES, blockLocks: BLOCK_LOCKS });
      const hardLocked = Object.keys(HARD_LOCKS).filter(isHardLocked);
      sendResponse({ locks: BLOCK_LOCKS, hardLocked });
    })(); return true;
  }

  if (msg.type === "AMBIENT_APPLY") {
    applyAmbient().then(() => sendResponse({ ok: true })); return true;
  }

  if (msg.type === "SYNC_ASSIGNMENT_ALARMS") {
    syncAssignmentAlarms().then(() => sendResponse({ ok: true })); return true;
  }

  if (msg.type === "POMO_GET_STATE") {
    getPomoState().then(sendResponse); return true;
  }

  if (msg.type === "POMO_START") {
    (async () => {
      const state = await getPomoState();
      const studySec = msg.studySec || POMO_STUDY_SEC;
      const breakSec = msg.breakSec || POMO_BREAK_SEC;
      const fullDur  = state.phase === "study" ? studySec : breakSec;
      const remaining = state.remaining > 0 ? state.remaining : fullDur;
      const endTime   = Date.now() + remaining * 1000;
      const subjectId = msg.subjectId !== undefined ? msg.subjectId : (state.subjectId || null);
      const newState  = { running: true, phase: state.phase, remaining, endTime, studySec, breakSec, subjectId };
      await setPomoState(newState);
      await chrome.alarms.create(POMO_ALARM, { when: endTime });
      if (state.phase === "study") await startPomoBlock();
      await applyAmbient();
      sendResponse(newState);
    })(); return true;
  }

  if (msg.type === "POMO_PAUSE") {
    (async () => {
      const state = await getPomoState();
      const remaining = (state.running && state.endTime)
        ? Math.max(0, Math.round((state.endTime - Date.now()) / 1000))
        : state.remaining;
      await chrome.alarms.clear(POMO_ALARM);
      const newState = { running: false, phase: state.phase, remaining, endTime: null,
        studySec: state.studySec, breakSec: state.breakSec, subjectId: state.subjectId || null };
      await setPomoState(newState);
      await endPomoBlock();
      await applyAmbient();
      sendResponse(newState);
    })(); return true;
  }

  if (msg.type === "POMO_SET_SUBJECT") {
    (async () => {
      const state = await getPomoState();
      const newState = { ...state, subjectId: msg.subjectId || null };
      await setPomoState(newState);
      sendResponse(newState);
    })(); return true;
  }

  if (msg.type === "POMO_RESET") {
    (async () => {
      await chrome.alarms.clear(POMO_ALARM);
      const state = await getPomoState();
      const newState = defaultPomoState(state.studySec || POMO_STUDY_SEC, state.breakSec || POMO_BREAK_SEC);
      await setPomoState(newState);
      await endPomoBlock();
      sendResponse(newState);
    })(); return true;
  }

  if (msg.type === "POMO_SET_DURATIONS") {
    (async () => {
      const state = await getPomoState();
      if (state.running) { sendResponse({ ok: false, reason: "Stop timer first" }); return; }
      const newState = defaultPomoState(msg.studySec, msg.breakSec);
      await setPomoState(newState);
      sendResponse(newState);
    })(); return true;
  }

  // ===== SUBJECTS =====
  if (msg.type === "GET_SUBJECTS") {
    (async () => {
      await ensureState();
      sendResponse({ subjects: SUBJECTS });
    })(); return true;
  }

  if (msg.type === "ADD_SUBJECT") {
    (async () => {
      await ensureState();
      const name = (msg.name || "").trim();
      if (!name) { sendResponse({ subjects: SUBJECTS }); return; }
      const palette = ["#c9a84c","#4caf82","#5b8def","#c0564a","#a86dc9","#4dc0c9","#e0913a","#8fa33f"];
      const color = palette[SUBJECTS.length % palette.length];
      const subject = { id: "sub-" + Date.now(), name, color };
      SUBJECTS.push(subject);
      await chrome.storage.local.set({ subjects: SUBJECTS });
      sendResponse({ subjects: SUBJECTS });
    })(); return true;
  }

  if (msg.type === "DELETE_SUBJECT") {
    (async () => {
      await ensureState();
      SUBJECTS = SUBJECTS.filter(s => s.id !== msg.id);
      await chrome.storage.local.set({ subjects: SUBJECTS });
      sendResponse({ subjects: SUBJECTS });
    })(); return true;
  }

  // ===== POMO / SUBJECT STATS =====
  if (msg.type === "GET_POMO_STATS") {
    (async () => {
      const r = await chrome.storage.local.get("pomoStudySeconds");
      const data = r.pomoStudySeconds || {};
      const today = getTodayKey();
      const yd = new Date(); yd.setDate(yd.getDate() - 1);
      const yesterdayKey = `${yd.getFullYear()}-${String(yd.getMonth()+1).padStart(2,'0')}-${String(yd.getDate()).padStart(2,'0')}`;
      const total = Object.values(data).reduce((a, b) => a + b, 0);
      sendResponse({ total, today: data[today] || 0, yesterday: data[yesterdayKey] || 0 });
    })(); return true;
  }

  if (msg.type === "GET_SUBJECT_STATS") {
    (async () => {
      const r = await chrome.storage.local.get("subjectTime");
      sendResponse({ subjectTime: r.subjectTime || {} });
    })(); return true;
  }

  // ===== FOCUS TIMETABLES =====
  if (msg.type === "GET_TIMETABLES") {
    (async () => {
      await ensureState();
      sendResponse({ timetables: TIMETABLES, active: getActiveTimetables().map(t => t.id) });
    })(); return true;
  }

  if (msg.type === "ADD_TIMETABLE") {
    (async () => {
      try {
        await ensureState();
        if (getActiveTimetables().length > 0) {
          sendResponse({ ok: false, reason: "locked", timetables: TIMETABLES });
          return;
        }
        const tt = { id: "tt-" + Date.now(), start: msg.start, end: msg.end, sites: msg.sites || [] };
        TIMETABLES.push(tt);
        await chrome.storage.local.set({ timetables: TIMETABLES });
        sendResponse({ ok: true, timetables: TIMETABLES });
      } catch (e) {
        console.error("ADD_TIMETABLE failed:", e);
        sendResponse({ ok: false, reason: "error", error: String(e && e.message || e) });
      }
    })(); return true;
  }

  if (msg.type === "DELETE_TIMETABLE") {
    (async () => {
      try {
        await ensureState();
        // Nothing about the schedule can be changed while ANY window is
        // currently locked-in — not just the one being deleted.
        if (getActiveTimetables().length > 0) {
          sendResponse({ ok: false, reason: "locked", timetables: TIMETABLES });
          return;
        }
        TIMETABLES = TIMETABLES.filter(t => t.id !== msg.id);
        await chrome.storage.local.set({ timetables: TIMETABLES });
        sendResponse({ ok: true, timetables: TIMETABLES });
      } catch (e) {
        console.error("DELETE_TIMETABLE failed:", e);
        sendResponse({ ok: false, reason: "error", error: String(e && e.message || e) });
      }
    })(); return true;
  }

  // ===== AUTO-OPEN (scheduled link opener) =====
  if (msg.type === "GET_AUTO_OPENS") {
    (async () => {
      await ensureState();
      sendResponse({ autoOpens: AUTO_OPENS });
    })(); return true;
  }

  if (msg.type === "ADD_AUTO_OPEN") {
    (async () => {
      await ensureState();
      const rule = {
        id: "ao-" + Date.now(),
        url: msg.url,
        mode: msg.mode, // "daily" | "interval"
        time: msg.mode === "daily" ? msg.time : null,
        intervalMinutes: msg.mode === "interval" ? msg.intervalMinutes : null
      };
      AUTO_OPENS.push(rule);
      await chrome.storage.local.set({ autoOpens: AUTO_OPENS });
      await scheduleAutoOpen(rule);
      sendResponse({ ok: true, autoOpens: AUTO_OPENS });
    })(); return true;
  }

  if (msg.type === "DELETE_AUTO_OPEN") {
    (async () => {
      await ensureState();
      AUTO_OPENS = AUTO_OPENS.filter(r => r.id !== msg.id);
      await chrome.storage.local.set({ autoOpens: AUTO_OPENS });
      await chrome.alarms.clear(msg.id);
      sendResponse({ ok: true, autoOpens: AUTO_OPENS });
    })(); return true;
  }

  // ===== SITE → SUBJECT AUTO-TRACKING =====
  if (msg.type === "GET_SITE_SUBJECTS") {
    (async () => {
      try {
        await ensureState();
        sendResponse({ siteSubjects: SITE_SUBJECTS });
      } catch (e) {
        console.error("GET_SITE_SUBJECTS failed:", e);
        sendResponse({ siteSubjects: {}, error: String(e && e.message || e) });
      }
    })(); return true;
  }

  if (msg.type === "SET_SITE_SUBJECT") {
    (async () => {
      try {
        await ensureState();
        const domain = (msg.domain || "").trim().toLowerCase().replace(/^www\./, "");
        if (!domain) { sendResponse({ ok: false, reason: "no-domain", siteSubjects: SITE_SUBJECTS }); return; }
        if (msg.subjectId) SITE_SUBJECTS[domain] = msg.subjectId;
        else delete SITE_SUBJECTS[domain];
        await chrome.storage.local.set({ siteSubjects: SITE_SUBJECTS });
        sendResponse({ ok: true, siteSubjects: SITE_SUBJECTS });
      } catch (e) {
        console.error("SET_SITE_SUBJECT failed:", e);
        sendResponse({ ok: false, reason: "error", error: String(e && e.message || e) });
      }
    })(); return true;
  }

  // ===== AD BLOCKER =====
  if (msg.type === "GET_ADBLOCK_STATE") {
    (async () => {
      const r = await chrome.storage.local.get("adBlockEnabled");
      sendResponse({ enabled: r.adBlockEnabled !== false }); // default ON
    })(); return true;
  }

  if (msg.type === "SET_ADBLOCK_STATE") {
    (async () => {
      const enabled = !!msg.enabled;
      await chrome.storage.local.set({ adBlockEnabled: enabled });
      await applyAdBlockRules(enabled);
      sendResponse({ ok: true, enabled });
    })(); return true;
  }

  return true;
});

// ===== POMODORO =====
const POMO_STUDY_SEC = 25 * 60;
const POMO_BREAK_SEC = 5  * 60;

function defaultPomoState(studySec = POMO_STUDY_SEC, breakSec = POMO_BREAK_SEC) {
  return { running: false, phase: "study", remaining: studySec, endTime: null, studySec, breakSec };
}

async function getPomoState() {
  const r = await chrome.storage.local.get("pomoState");
  return r.pomoState || defaultPomoState();
}

async function setPomoState(state) {
  await chrome.storage.local.set({ pomoState: state });
}

async function savePomoHistory(phase) {
  const r = await chrome.storage.local.get("pomoHistory");
  const history = r.pomoHistory || {};
  const today = getTodayKey();
  if (!history[today]) history[today] = [];
  history[today].unshift({
    phase, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  });
  if (history[today].length > 50) history[today] = history[today].slice(0, 50);
  await chrome.storage.local.set({ pomoHistory: history });
}

function notifyPomoDone(donePhase) {
  try {
    chrome.notifications.create("pomo-" + Date.now(), {
      type: "basic", iconUrl: "icon.png",
      title: donePhase === "study" ? "✅ Study Session Complete!" : "⏰ Break Over!",
      message: donePhase === "study" ? "Time for a well-earned break." : "Back to work — stay focused.",
      priority: 2
    });
  } catch {}
}

async function handlePomoAlarm() {
  const state = await getPomoState();
  const donePhase = state.phase;
  await savePomoHistory(donePhase);
  notifyPomoDone(donePhase);
  if (donePhase === "study") await endPomoBlock();
  const nextPhase     = donePhase === "study" ? "break" : "study";
  const studySec      = state.studySec || POMO_STUDY_SEC;
  const breakSec      = state.breakSec || POMO_BREAK_SEC;
  const nextRemaining = nextPhase === "study" ? studySec : breakSec;
  await setPomoState({ running: false, phase: nextPhase, remaining: nextRemaining, endTime: null, studySec, breakSec, subjectId: state.subjectId || null });
  await applyAmbient();
  if (donePhase === "study") await checkSessionGoal();
}

// Session goal: `pomoSessionGoal: { day, target }` — a heads-up notification
// the moment today's finished study sessions reach the target.
async function checkSessionGoal() {
  const r = await chrome.storage.local.get(["pomoSessionGoal", "pomoHistory"]);
  const g = r.pomoSessionGoal;
  if (!g || g.day !== getTodayKey() || !g.target) return;
  const done = ((r.pomoHistory || {})[g.day] || []).filter(e => e.phase === "study").length;
  if (done === g.target) {
    try {
      chrome.notifications.create("goal-" + Date.now(), {
        type: "basic", iconUrl: "icon.png",
        title: "🎯 Session goal reached!",
        message: `${done}/${g.target} study sessions done today.`, priority: 2
      });
    } catch {}
  }
}

// ---- Pomodoro + Block integration (opt-in) ----
// While a study session is actively running, every site the person has
// tagged "waste" (the same study/waste categorization the Track tab
// already uses) gets added to BLOCKED_SITES — and ONLY those specific
// sites get removed again when the session ends, never touching sites
// the person blocked manually themselves.
async function startPomoBlock() {
  const r = await chrome.storage.local.get(["siteCategories", "blockedSites", "pomoBlockEnabled"]);
  if (!r.pomoBlockEnabled) return;
  const cats = r.siteCategories || {};
  const wasteSites = Object.keys(cats).filter(d => cats[d] === "waste");
  if (!wasteSites.length) return;
  const current = r.blockedSites || [];
  const newlyAdded = wasteSites.filter(d => !current.includes(d));
  if (!newlyAdded.length) { await chrome.storage.local.set({ pomoLockSites: [] }); return; }
  BLOCKED_SITES = [...new Set([...current, ...newlyAdded])];
  await chrome.storage.local.set({ blockedSites: BLOCKED_SITES, pomoLockSites: newlyAdded });
}

async function endPomoBlock() {
  const r = await chrome.storage.local.get(["pomoLockSites", "blockedSites"]);
  const lockSites = r.pomoLockSites || [];
  if (!lockSites.length) return;
  BLOCKED_SITES = (r.blockedSites || []).filter(d => !lockSites.includes(d));
  await chrome.storage.local.set({ blockedSites: BLOCKED_SITES, pomoLockSites: [] });
}

// ===== AD BLOCKER (Google ad network + YouTube ads) =====
// Blocks the network requests that serve ads (banner/display ads anywhere,
// and the ad-request endpoints YouTube's player calls before playing a
// video ad). This doesn't touch normal Google/YouTube functionality —
// only known ad-serving domains/paths are blocked.
const AD_BLOCK_RULE_ID_BASE = 90000;
const AD_DOMAINS = [
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "google-analytics.com",
  "googletagservices.com",
  "adservice.google.com",
  "adservice.google.co.in",
  "pagead2.googlesyndication.com",
  "tpc.googlesyndication.com",
  "static.doubleclick.net",
  "securepubads.g.doubleclick.net",
  "pubads.g.doubleclick.net"
];
// YouTube ad-request endpoints (does not block youtube.com itself)
const YT_AD_URL_PATTERNS = [
  "||youtube.com/api/stats/ads*",
  "||youtube.com/pagead/*",
  "||youtube.com/ptracking*",
  "||s.youtube.com/api/stats/ads*"
];

async function applyAdBlockRules(forceEnabled) {
  if (!chrome.declarativeNetRequest) return;
  let enabled = forceEnabled;
  if (enabled === undefined) {
    const r = await chrome.storage.local.get("adBlockEnabled");
    enabled = r.adBlockEnabled !== false; // default ON
  }

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map(r => r.id);

  const addRules = [];
  if (enabled) {
    let id = AD_BLOCK_RULE_ID_BASE;
    AD_DOMAINS.forEach(domain => {
      addRules.push({
        id: id++,
        priority: 1,
        action: { type: "block" },
        condition: { requestDomains: [domain], resourceTypes: [
          "script","image","xmlhttprequest","sub_frame","media","other"
        ] }
      });
    });
    YT_AD_URL_PATTERNS.forEach(pattern => {
      addRules.push({
        id: id++,
        priority: 1,
        action: { type: "block" },
        condition: { urlFilter: pattern, resourceTypes: [
          "script","image","xmlhttprequest","sub_frame","media","other"
        ] }
      });
    });
  }

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  } catch (e) { console.warn("adblock rule update failed:", e.message); }
}

// ===== TASK-BASED BLOCKING =====
// When tasks change, check if sites should stay blocked
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes.tasks) {
    const tasks = changes.tasks.newValue || [];
    const hasPending = tasks.some(t => !t.done);
    // No action needed here — popup handles SET_BLOCKED_SITES via message
    // Background already intercepts all navigations via isBlocked()
    // which reads BLOCKED_SITES (kept in sync via SET_BLOCKED_SITES messages)
  }
});

// Cooldown length is written straight to storage by the popup — pick it up
// live so a change applies to the next lock without reloading anything.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.hardLockCooldownMin) {
    COOLDOWN_MIN = Math.max(0, Number(changes.hardLockCooldownMin.newValue) || 0);
  }
});
