// New-tab dashboard: a read-mostly view of what's already in storage (tasks,
// habits, deadlines, Pomodoro). It only ever flips a task's done flag or
// today's habit tick — the same two edits the popup makes.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// Validate stored calendar keys as real dates; malformed dates must never distort a range or heatmap.
const isValidDateKey = (value, maxKey = "9999-12-31") => {
  const key = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key > maxKey) return false;
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(0); date.setHours(0, 0, 0, 0); date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};
const isUpcoming = (t) => t.scheduledAt && dayKey(new Date(t.scheduledAt)) > dayKey();

async function boot() {
  const s = await chrome.storage.local.get(["newTabDashboard", "theme"]);
  const params = new URLSearchParams(location.search);
  const blockedSite = params.get("blockedSite");
  const redirectedFromBlock = Boolean(blockedSite || params.get("showAnalytics") === "1");
  // A user preference can disable the normal new-tab dashboard, but must not
  // send a blocked-site redirect back out to a distraction website.
  if (s.newTabDashboard === false && !redirectedFromBlock) { location.replace("https://www.google.com/"); return; }
  document.documentElement.setAttribute("data-theme", s.theme === "light" ? "light" : "dark");
  if (redirectedFromBlock) {
    const notice = $("blockedRedirectNotice");
    notice.hidden = false;
    $("blockedRedirectText").textContent = blockedSite
      ? `${blockedSite} is on your block list. Here's your ARUN PRO progress and next-step dashboard instead.`
      : "ARUN PRO opened your study analytics instead of the blocked site.";
    $("blockedNoticeDismiss").addEventListener("click", () => { notice.hidden = true; });
  }
  await render();
  // Analytics is the homepage: render it on every normal new-tab load, not only after a feature-tab click.
  try { await renderDeepAnalytics(); } catch (err) { console.warn("ARUN PRO analytics initial render failed", err); }
  try { await renderStudyInsights(); await renderMonthlyCalendar(); } catch (err) { console.warn("ARUN PRO study insights render failed", err); }
  if (redirectedFromBlock) {
    activateFeature("analytics");
    setTimeout(() => document.getElementById("featureCenter")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    // Remove the query after handling it so refreshes don't keep the redirect banner.
    history.replaceState(null, "", location.pathname);
  }
  tickClock();
  setInterval(tickClock, 1000);
}

function tickClock() {
  const d = new Date();
  $("ntClock").textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const h = d.getHours();
  $("ntGreeting").textContent = (h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 21 ? "Good evening" : "Good night")
    + " · " + d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  updatePomo();
}

let pomoState = null;
function updatePomo() {
  const el = $("ntPomo");
  if (!pomoState) { el.style.display = "none"; return; }
  el.style.display = "";
  const secs = pomoState.running && pomoState.endTime ? Math.max(0, Math.round((pomoState.endTime - Date.now()) / 1000)) : pomoState.remaining || 0;
  const mm = String(Math.floor(secs / 60)).padStart(2, "0"), ss = String(secs % 60).padStart(2, "0");
  el.innerHTML = `${pomoState.phase === "study" ? "STUDY" : "BREAK"}${pomoState.running ? "" : " (paused)"}<b>${mm}:${ss}</b>`;
}

async function render() {
  const r = await chrome.storage.local.get(["tasks", "habits", "assignments", "dailyGoal", "pomoState", "studyHistory", "timeData", "siteCategories"]);
  pomoState = r.pomoState || null;
  updatePomo();

  const g = r.dailyGoal;
  const goalEl = $("ntGoal");
  if (g && g.date === dayKey() && g.text) { goalEl.textContent = "🎯 " + g.text; goalEl.style.display = ""; } else goalEl.style.display = "none";

  // tasks (today scope; pinned first)
  const tasks = r.tasks || [];
  const todays = tasks.map((t, i) => ({ t, i })).filter(({ t }) => !isUpcoming(t)).sort((a, b) => (b.t.pinned ? 1 : 0) - (a.t.pinned ? 1 : 0));
  $("ntTasks").innerHTML = todays.length ? todays.map(({ t, i }) => `
    <div class="nt-row ${t.done ? "done" : ""}">
      <button class="nt-check" data-task="${i}">${t.done ? "✅" : "⬜"}</button>
      <span class="nt-text">${t.pinned ? '<span class="nt-pin">📌</span> ' : ""}${esc(t.text)}</span>
      ${Array.isArray(t.subtasks) && t.subtasks.length ? `<span class="nt-meta">${t.subtasks.filter(x => x.done).length}/${t.subtasks.length}</span>` : ""}
    </div>`).join("") : '<div class="nt-empty">Nothing for today.</div>';

  // Compact progress cards, derived from existing records only.
  const doneTasks = tasks.filter(t => t.done).length;
  const habitsForStats = r.habits || [];
  const completedHabits = habitsForStats.filter(h => h.entries && h.entries[dayKey()] !== undefined).length;
  const openDeadlines = (r.assignments || []).filter(a => !a.done).length;
  $("statTasks").textContent = `${doneTasks}/${tasks.length}`;
  $("statHabits").textContent = `${completedHabits}/${habitsForStats.length}`;
  $("statDeadlines").textContent = String(openDeadlines);

  // habits
  const today = dayKey();
  const habits = r.habits || [];
  $("ntHabits").innerHTML = habits.length ? habits.map(h => {
    const v = h.entries && h.entries[today];
    return h.type === "check"
      ? `<div class="nt-row ${v !== undefined ? "done" : ""}"><button class="nt-check" data-habit="${h.id}">${v !== undefined ? "✅" : "⬜"}</button><span class="nt-text">${esc(h.name)}</span></div>`
      : `<div class="nt-row"><span class="nt-text">${esc(h.name)}</span><span class="nt-meta">${v !== undefined ? v + (h.unit ? " " + esc(h.unit) : "") : "—"}</span></div>`;
  }).join("") : '<div class="nt-empty">No habits yet.</div>';

  // Productivity insights based only on existing local records; never replaces data.
  const todayTracked = (r.timeData && r.timeData[dayKey()]) || {};
  const categories = r.siteCategories || {};
  const seconds = Object.entries(todayTracked).reduce((n,[site,value]) => n + ((categories[site] || "waste") === "study" ? Math.max(0,Number(value)||0) : 0), 0);
  const mins = Math.round(seconds / 60);
  const habitPct = habitsForStats.length ? Math.round(completedHabits / habitsForStats.length * 100) : 0;
  const taskPct = tasks.length ? Math.round(doneTasks / tasks.length * 100) : 0;
  $("ntAnalytics").innerHTML = `<div class="analytics-grid"><div><small>Task completion</small><strong>${taskPct}%</strong><div class="progress"><i style="width:${taskPct}%"></i></div></div><div><small>Habit check-ins</small><strong>${habitPct}%</strong><div class="progress"><i style="width:${habitPct}%"></i></div></div><div><small>Study time today</small><strong>${mins ? `${Math.floor(mins/60)}h ${mins%60}m` : "No logged time"}</strong><small class="analytics-note">Matches popup website tracking · Study-classified seconds from timeData</small></div></div>`;

  // deadlines
  const items = (r.assignments || []).filter(a => !a.done).sort((a, b) => a.due - b.due).slice(0, 4);
  $("ntAssign").innerHTML = items.length ? items.map(a => {
    const ms = a.due - Date.now(), hrs = ms / 3600000;
    const text = ms <= 0 ? "overdue" : hrs < 24 ? `${Math.max(1, Math.round(hrs))}h left` : `${Math.ceil(hrs / 24)}d left`;
    const cls = ms <= 0 ? "overdue" : hrs < 72 ? "urgent" : "";
    return `<div class="nt-row"><span class="nt-text">${esc(a.name)}${a.course ? ` <span class="nt-meta">· ${esc(a.course)}</span>` : ""}</span><span class="nt-badge ${cls}">${text}</span></div>`;
  }).join("") : '<div class="nt-empty">No deadlines set.</div>';

  document.querySelectorAll("[data-task]").forEach(b => b.addEventListener("click", async () => {
    const cur = (await chrome.storage.local.get("tasks")).tasks || [];
    const t = cur[Number(b.dataset.task)];
    if (!t) return;
    t.done = !t.done;
    await chrome.storage.local.set({ tasks: cur });
    // Same alarm bookkeeping the popup does when a task is ticked/unticked.
    try {
      if (t.done) await chrome.runtime.sendMessage({ type: "CLEAR_TASK_ALARMS", id: t.id });
      else if (t.scheduledAt) await chrome.runtime.sendMessage({ type: "SCHEDULE_TASK", task: t });
    } catch {}
  }));
  document.querySelectorAll("[data-habit]").forEach(b => b.addEventListener("click", async () => {
    const cur = (await chrome.storage.local.get("habits")).habits || [];
    const h = cur.find(x => String(x.id) === b.dataset.habit);
    if (!h) return;
    h.entries = h.entries || {};
    if (h.entries[dayKey()] !== undefined) delete h.entries[dayKey()]; else h.entries[dayKey()] = true;
    await chrome.storage.local.set({ habits: cur });
  }));
}

// Anything changed elsewhere (popup, another tab) → redraw.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.tasks || changes.habits || changes.assignments || changes.dailyGoal || changes.pomoState)) render();
});

$("ntOff").addEventListener("click", async () => {
  await chrome.storage.local.set({ newTabDashboard: false });
  location.replace("https://www.google.com/");
});

boot();


// Private diary. Entries are stored separately from existing task/habit data.
// The password is a convenience UI lock, not cryptographic protection: extension
// source and local storage can be inspected by someone with access to this browser profile.
const DIARY_PASSWORD = "ak47";
let diaryUnlocked = false;
let activeDiaryId = null;
const diaryPanel = $("diaryPanel");
const diaryLock = $("diaryLock");
const diaryEditor = $("diaryEditor");
const makeDiaryId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const diaryDate = (value) => new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

async function getDiaryEntries() {
  const r = await chrome.storage.local.get("diaryEntries");
  return Array.isArray(r.diaryEntries) ? r.diaryEntries : [];
}
function showDiaryLock() {
  diaryUnlocked = false;
  diaryLock.hidden = false;
  diaryEditor.hidden = true;
  $("diaryPassword").value = "";
  $("diaryError").textContent = "";
}
async function openDiary() {
  diaryPanel.hidden = false;
  diaryPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  if (!diaryUnlocked) { showDiaryLock(); setTimeout(() => $("diaryPassword").focus(), 200); }
}
function lockDiary() { showDiaryLock(); }
async function refreshDiaryEntries() {
  if (!diaryUnlocked) return;
  const entries = (await getDiaryEntries()).sort((a,b) => b.updatedAt - a.updatedAt);
  $("diaryEntries").innerHTML = entries.map(e => `<div class="diary-entry ${e.id === activeDiaryId ? "active" : ""}" data-entry-id="${esc(e.id)}"><div class="diary-entry-main"><strong>${esc(e.title || "Untitled entry")}</strong><small>${esc(diaryDate(e.updatedAt))} · ${esc((e.body || "").slice(0,90).replace(/\s+/g," "))}</small></div><button type="button" data-entry-delete="${esc(e.id)}" aria-label="Delete ${esc(e.title || "entry")}">×</button></div>`).join("");
  const q = ($("diarySearch").value || "").toLowerCase().trim();
  document.querySelectorAll("[data-entry-id]").forEach(el => { const entryText = el.textContent.toLowerCase(); el.hidden = !!q && !entryText.includes(q); });
  document.querySelectorAll("[data-entry-id]").forEach(el => el.addEventListener("click", async (event) => {
    if (event.target.closest("[data-entry-delete]")) return;
    const entry = (await getDiaryEntries()).find(e => e.id === el.dataset.entryId);
    if (!entry) return;
    activeDiaryId = entry.id; $("diaryTitle").value = entry.title || ""; $("diaryBody").value = entry.body || ""; $("diaryMood").value = entry.mood || "🙂"; $("diaryTags").value = Array.isArray(entry.tags) ? entry.tags.join(", ") : "";
    $("diarySaveStatus").textContent = `Edited ${diaryDate(entry.updatedAt)}`;
    await refreshDiaryEntries();
  }));
  document.querySelectorAll("[data-entry-delete]").forEach(btn => btn.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!confirm("Delete this diary entry? This cannot be undone.")) return;
    const id = btn.dataset.entryDelete;
    const entriesNow = await getDiaryEntries();
    await chrome.storage.local.set({ diaryEntries: entriesNow.filter(e => e.id !== id) });
    if (activeDiaryId === id) newDiaryEntry();
    await refreshDiaryEntries();
  }));
}
function newDiaryEntry() {
  activeDiaryId = null; $("diaryTitle").value = ""; $("diaryBody").value = ""; $("diaryMood").value = "🙂"; $("diaryTags").value = "";
  $("diarySaveStatus").textContent = "New entry · not saved yet";
  $("diaryTitle").focus();
  refreshDiaryEntries();
}
async function saveDiaryEntry() {
  if (!diaryUnlocked) return;
  const title = $("diaryTitle").value.trim();
  const body = $("diaryBody").value;
  const mood = $("diaryMood").value;
  const tags = $("diaryTags").value.split(",").map(x=>x.trim()).filter(Boolean).slice(0,20);
  if (!title && !body.trim()) { $("diarySaveStatus").textContent = "Write something before saving."; return; }
  const entries = await getDiaryEntries();
  const now = Date.now();
  if (activeDiaryId) {
    const idx = entries.findIndex(e => e.id === activeDiaryId);
    if (idx >= 0) entries[idx] = { ...entries[idx], title, body, mood, tags, updatedAt: now };
    else { activeDiaryId = makeDiaryId(); entries.push({ id: activeDiaryId, title, body, mood, tags, createdAt: now, updatedAt: now }); }
  } else {
    activeDiaryId = makeDiaryId(); entries.push({ id: activeDiaryId, title, body, mood, tags, createdAt: now, updatedAt: now });
  }
  await chrome.storage.local.set({ diaryEntries: entries });
  $("diarySaveStatus").textContent = `Saved · ${diaryDate(now)}`;
  await refreshDiaryEntries();
}

$("diaryOpen").addEventListener("click", openDiary);
$("diaryClose").addEventListener("click", () => { diaryPanel.hidden = true; });
$("diaryUnlockForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if ($("diaryPassword").value === DIARY_PASSWORD) {
    diaryUnlocked = true; diaryLock.hidden = true; diaryEditor.hidden = false;
    $("diarySaveStatus").textContent = "Saved on this device";
    await refreshDiaryEntries();
    if (!activeDiaryId) newDiaryEntry();
  } else { $("diaryError").textContent = "Incorrect password. Please try again."; $("diaryPassword").select(); }
});
$("diarySave").addEventListener("click", saveDiaryEntry);
$("diaryNew").addEventListener("click", newDiaryEntry);
$("diaryLockAgain").addEventListener("click", lockDiary);
$("diaryDelete").addEventListener("click", async () => {
  if (!activeDiaryId) { newDiaryEntry(); return; }
  if (!confirm("Delete this diary entry? This cannot be undone.")) return;
  const entries = await getDiaryEntries();
  await chrome.storage.local.set({ diaryEntries: entries.filter(e => e.id !== activeDiaryId) });
  newDiaryEntry(); await refreshDiaryEntries();
});
$("quickFocus").addEventListener("click", async () => {
  const r = await chrome.storage.local.get("pomoState");
  if (r.pomoState) {
    alert("Your focus timer is shown in the top-right. Open the extension popup to start or resume a session.");
  } else {
    alert("Open the extension popup to start a Pomodoro focus session.");
  }
});


// Safe backup/restore utilities. Import defaults to MERGE; no storage is cleared.
function downloadJson(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:"application/json"}));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$("refreshDashboard").addEventListener("click", render);
$("themeToggle").addEventListener("click", async () => { const cur=await chrome.storage.local.get(["theme","arunWebpageStyle"]);const currentTheme=(cur.arunWebpageStyle&&cur.arunWebpageStyle.theme)||cur.theme||"dark";const theme=currentTheme==="light"?"dark":"light";const style={...(cur.arunWebpageStyle||{}),theme};await chrome.storage.local.set({theme,arunWebpageStyle:style});applyWebpageStyle(style);if($("webThemeSetting"))$("webThemeSetting").value=theme; });
$("exportBackup").addEventListener("click", async () => { const data = await chrome.storage.local.get(null); downloadJson(`arun-pro-backup-${dayKey()}.json`, {app:"ARUN PRO", backupVersion:1, exportedAt:new Date().toISOString(), data}); });
$("importBackup").addEventListener("click", () => $("backupFile").click());
$("backupFile").addEventListener("change", async e => { const file=e.target.files?.[0]; if(!file) return; try { const parsed=JSON.parse(await file.text()); const incoming=parsed.data && typeof parsed.data==="object" ? parsed.data : parsed; if(!incoming || Array.isArray(incoming) || typeof incoming!=="object") throw new Error("Invalid backup format"); const current=await chrome.storage.local.get(null); const safe={}; // Only supported, currently-missing keys may be added.
      const allowed = new Set(["tasks","habits","assignments","notes","pomoState","studyHistory","dailyGoal","theme","diaryEntries","settings","blockedSites","newTabDashboard","timeData","hourlyTimeData","siteCategories","pomoStudySeconds","pomoHistory","subjectTime","subjects","arunAnalyticsPeriod","arunAnalyticsMonth","arunAnalyticsYear","arunStudyHeatmapSource","arunStudyHeatmapPeriod","arunStudyHeatmapMonth","arunStudyHeatmapYear","arunMonthlyCalendarMonth","arunWebpageStyle","arunWebpageStylePresets","arunCustomReminder"]);
      for(const key of Object.keys(incoming)) if(allowed.has(key) && !(key in current)) safe[key]=incoming[key];
      if(!Object.keys(safe).length){alert("No missing supported keys to merge. Existing data was left unchanged.");return;}
      if(!confirm(`Safe merge will add ${Object.keys(safe).length} missing supported key(s) and preserve all existing data. Continue?`)) return;
      await chrome.storage.local.set(safe); alert("Backup merged safely. Existing keys were preserved."); await render();
    } catch(err) { alert("Could not import backup: " + err.message); } finally { e.target.value=""; } });
$("diarySearch").addEventListener("input", refreshDiaryEntries);
$("diaryExport").addEventListener("click", async () => { if(!diaryUnlocked) return; downloadJson(`arun-pro-diary-${dayKey()}.json`, {app:"ARUN PRO Diary", exportedAt:new Date().toISOString(), diaryEntries:await getDiaryEntries(), peopleInteractions:await getPeopleRecords()}); });


// People & Interaction Journal — additive feature, stored under a new key only.
const PEOPLE_KEY = "arunDiaryPeople";
let activePersonRecordId = null;
const personVal = id => (document.getElementById(id)?.value || "").trim();
const peopleDateLabel = value => { const d = new Date((value || "") + "T12:00:00"); return Number.isNaN(d.getTime()) ? (value || "Date unknown") : d.toLocaleDateString([], {year:"numeric",month:"short",day:"numeric"}); };
async function getPeopleRecords(){ const r=await chrome.storage.local.get(PEOPLE_KEY); return Array.isArray(r[PEOPLE_KEY])?r[PEOPLE_KEY]:[]; }
function resetPersonForm(){ activePersonRecordId=null; ["personName","personPlace","personWanted","myWanted","personTopics","personNoticed","personOutcome"].forEach(id=>document.getElementById(id).value=""); document.getElementById("personDate").value=new Date().toISOString().slice(0,10); document.getElementById("personInitiated").value="me"; document.getElementById("personSave").textContent="Save interaction"; document.getElementById("personSaveStatus").textContent="Each meeting is saved separately."; }
function escapePeople(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function renderPeopleJournal(){
 const records=(await getPeopleRecords()).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.updatedAt||0)-(a.updatedAt||0));
 const names=new Set(records.map(r=>(r.name||"").trim().toLowerCase()).filter(Boolean));
 const topicCounts={}; records.forEach(r=>(r.topics||[]).forEach(t=>{const k=t.trim();if(k)topicCounts[k]=(topicCounts[k]||0)+1;}));
 const topTopic=Object.entries(topicCounts).sort((a,b)=>b[1]-a[1])[0];
 const month=new Date().toISOString().slice(0,7), thisMonth=records.filter(r=>(r.date||"").startsWith(month)).length;
 document.getElementById("peopleAnalytics").innerHTML=`<div class="people-metric"><small>MEETINGS LOGGED</small><strong>${records.length}</strong><p>All saved interactions</p></div><div class="people-metric"><small>PEOPLE MET</small><strong>${names.size}</strong><p>Unique names / nicknames</p></div><div class="people-metric"><small>THIS MONTH</small><strong>${thisMonth}</strong><p>Meetings recorded this month</p></div><div class="people-metric"><small>TOP DISCUSSION</small><strong style="font-size:14px">${escapePeople(topTopic?.[0]||"—")}</strong><p>${topTopic?`${topTopic[1]} conversation${topTopic[1]===1?"":"s"}`:"Add topics to see patterns"}</p></div>`;
 const q=personVal("peopleSearch").toLowerCase(); const filtered=records.filter(r=>[r.name,r.place,r.wanted,r.myWanted,r.noticed,r.outcome,...(r.topics||[])].join(" ").toLowerCase().includes(q));
 document.getElementById("peopleRecordCount").textContent=`${records.length} saved interaction${records.length===1?"":"s"}`;
 document.getElementById("peopleRecords").innerHTML=filtered.length?filtered.map(r=>`<article class="people-record"><div class="people-record-top"><div><strong>${escapePeople(r.name)}</strong><div class="people-meta">${escapePeople(peopleDateLabel(r.date))} · ${escapePeople(r.initiated==="me"?"You approached":r.initiated==="them"?"They approached":"Mutual / group")}${r.place?` · ${escapePeople(r.place)}`:""}</div></div><div class="people-record-actions"><button type="button" data-person-edit="${escapePeople(r.id)}">Edit</button><button type="button" data-person-delete="${escapePeople(r.id)}">Delete</button></div></div>${r.wanted?`<p><b>What they wanted:</b> ${escapePeople(r.wanted)}</p>`:""}${r.myWanted?`<p><b>What I wanted:</b> ${escapePeople(r.myWanted)}</p>`:""}${r.topics?.length?`<div class="people-topics">${r.topics.map(t=>`<span class="people-topic">${escapePeople(t)}</span>`).join("")}</div>`:""}${r.noticed?`<p><b>What I noticed:</b> ${escapePeople(r.noticed)}</p>`:""}${r.outcome?`<p><b>Outcome / follow-up:</b> ${escapePeople(r.outcome)}</p>`:""}</article>`).join(""):`<div class="people-empty">${q?"No matching interactions found.":"No meetings logged yet. Add the first person above; each meeting will have its own dated record."}</div>`;
 document.querySelectorAll("[data-person-edit]").forEach(b=>b.addEventListener("click",async()=>{const r=(await getPeopleRecords()).find(x=>x.id===b.dataset.personEdit);if(!r)return;activePersonRecordId=r.id;document.getElementById("personName").value=r.name||"";document.getElementById("personDate").value=r.date||"";document.getElementById("personPlace").value=r.place||"";document.getElementById("personInitiated").value=r.initiated||"me";document.getElementById("personWanted").value=r.wanted||"";document.getElementById("myWanted").value=r.myWanted||"";document.getElementById("personTopics").value=(r.topics||[]).join(", ");document.getElementById("personNoticed").value=r.noticed||"";document.getElementById("personOutcome").value=r.outcome||"";document.getElementById("personSave").textContent="Update interaction";document.getElementById("personSaveStatus").textContent="Editing saved interaction";document.getElementById("personName").focus();}));
 document.querySelectorAll("[data-person-delete]").forEach(b=>b.addEventListener("click",async()=>{if(!confirm("Delete this interaction record?"))return;const arr=await getPeopleRecords();await chrome.storage.local.set({[PEOPLE_KEY]:arr.filter(x=>x.id!==b.dataset.personDelete)});if(activePersonRecordId===b.dataset.personDelete)resetPersonForm();await renderPeopleJournal();}));
}
document.getElementById("personDate").value=new Date().toISOString().slice(0,10);
document.getElementById("personReset").addEventListener("click",resetPersonForm);
document.getElementById("personSearch")?.addEventListener("input",renderPeopleJournal);
document.getElementById("peopleSearch").addEventListener("input",renderPeopleJournal);
document.getElementById("personSave").addEventListener("click",async()=>{if(!diaryUnlocked){alert("Unlock the diary first to save interaction notes.");return;}const name=personVal("personName");if(!name){document.getElementById("personName").focus();document.getElementById("personSaveStatus").textContent="Please enter a person name.";return;}const arr=await getPeopleRecords(),now=Date.now(),record={id:activePersonRecordId||makeDiaryId(),name,date:personVal("personDate")||new Date().toISOString().slice(0,10),place:personVal("personPlace"),initiated:personVal("personInitiated")||"me",wanted:personVal("personWanted"),myWanted:personVal("myWanted"),topics:personVal("personTopics").split(",").map(x=>x.trim()).filter(Boolean).slice(0,20),noticed:personVal("personNoticed"),outcome:personVal("personOutcome"),updatedAt:now};const i=arr.findIndex(x=>x.id===record.id);if(i>=0)arr[i]=record;else arr.push({...record,createdAt:now});await chrome.storage.local.set({[PEOPLE_KEY]:arr});resetPersonForm();document.getElementById("personSaveStatus").textContent=`Saved · ${new Date(now).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`;await renderPeopleJournal();});
document.getElementById("peopleExport").addEventListener("click",async()=>{if(!diaryUnlocked)return;downloadJson(`arun-pro-people-journal-${dayKey()}.json`,{app:"ARUN PRO People & Interaction Journal",exportedAt:new Date().toISOString(),records:await getPeopleRecords()});});
// Render after diary unlock and include interaction records in the diary's own export without altering existing entries.
const _peopleRenderOnUnlock = refreshDiaryEntries;
refreshDiaryEntries = async function(){await _peopleRenderOnUnlock();if(diaryUnlocked)await renderPeopleJournal();};

// Advanced toolkit (all new records use separate storage keys; existing records are not replaced).
const TOOL_KEYS = ["arunExams","arunVault","arunFlashcards","arunUsageLog","arunReviews","arunDeleted","arunPreferences","arunFocusSession"];
const readList = async key => { const x=(await chrome.storage.local.get(key))[key]; return Array.isArray(x)?x:[]; };
const writeList = async (key,val) => chrome.storage.local.set({[key]:val});
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
const safeText = x => esc(x == null ? "" : String(x));
const niceDate = value => { if(!value)return "No date"; const d=new Date(value+"T12:00:00"); return isNaN(d)?String(value):d.toLocaleDateString([], {dateStyle:"medium"}); };
function activateFeature(name){
  document.querySelectorAll(".feature-tab").forEach(b=>b.classList.toggle("active",b.dataset.feature===name));
  document.querySelectorAll(".feature-pane").forEach(p=>p.hidden=p.id!==`pane-${name}`);
}
document.querySelectorAll(".feature-tab").forEach(b=>b.addEventListener("click",()=>activateFeature(b.dataset.feature)));

async function renderExams(){
 const exams=(await readList("arunExams")).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 $("examList").innerHTML=exams.length?exams.map(e=>{const days=Math.ceil((new Date(e.date+"T23:59:59")-new Date())/86400000);return `<div class="feature-item"><div class="feature-item-main"><b>${safeText(e.name)}</b><small>${niceDate(e.date)} · ${days<0?`${Math.abs(days)} days overdue`:days===0?"Today":`${days} days left`}</small><p>${safeText((e.topics||[]).map(t=>`${t.done?"✓":"○"} ${t.name}`).join(" · ")||"No syllabus topics added")}</p></div><button data-exam-topic="${safeText(e.id)}">Topic ✓</button><button data-exam-del="${safeText(e.id)}">Delete</button></div>`}).join(""):'<div class="nt-empty">No exams yet. Add your first exam above.</div>';
 $("examList").querySelectorAll("[data-exam-del]").forEach(b=>b.onclick=async()=>{if(confirm("Move this exam to Recently Deleted?")){const a=await readList("arunExams"),item=a.find(x=>x.id===b.dataset.examDel);await trashItem("exam",item);await writeList("arunExams",a.filter(x=>x.id!==b.dataset.examDel));renderExams();}});
 $("examList").querySelectorAll("[data-exam-topic]").forEach(b=>b.onclick=async()=>{const a=await readList("arunExams"),e=a.find(x=>x.id===b.dataset.examTopic);if(!e)return;e.topics=e.topics||[];if(!e.topics.length){const topic=prompt("Topic name to track:");if(topic?.trim())e.topics.push({name:topic.trim(),done:true});}else{const unfinished=e.topics.find(t=>!t.done);if(unfinished)unfinished.done=true;else {const topic=prompt("All current topics complete. Add another topic:");if(topic?.trim())e.topics.push({name:topic.trim(),done:false});}}await writeList("arunExams",a);renderExams();});
}
$("examForm").addEventListener("submit",async e=>{e.preventDefault();const exams=await readList("arunExams");exams.push({id:uid(),name:$("examName").value.trim(),date:$("examDate").value,topics:$("examTopics").value.split(",").map(x=>x.trim()).filter(Boolean).map(name=>({name,done:false})),createdAt:Date.now()});await writeList("arunExams",exams);e.target.reset();renderExams();});

async function renderVault(){
 const items=(await readList("arunVault")).sort((a,b)=>b.updatedAt-a.updatedAt);
 $("vaultList").innerHTML=items.length?items.map(n=>`<div class="feature-item"><div class="feature-item-main"><b>${safeText(n.title)} <span class="nt-badge">${safeText(n.type)}</span></b><small>${safeText((n.tags||[]).join(", "))} · ${new Date(n.updatedAt).toLocaleString()}</small><p>${safeText(n.body)}</p>${n.url?`<small><a href="${safeText(n.url)}" target="_blank" rel="noreferrer">${safeText(n.url)}</a></small>`:""}</div><button data-vault-edit="${safeText(n.id)}">Edit</button><button data-vault-del="${safeText(n.id)}">Delete</button></div>`).join(""):'<div class="nt-empty">No saved notes or links yet.</div>';
 $("vaultList").querySelectorAll("[data-vault-edit]").forEach(b=>b.onclick=async()=>{const arr=await readList("arunVault"),n=arr.find(x=>x.id===b.dataset.vaultEdit);if(!n)return;$("vaultTitle").value=n.title;$("vaultType").value=n.type;$("vaultTags").value=(n.tags||[]).join(", ");$("vaultBody").value=n.body; $("vaultForm").dataset.editId=n.id; $("vaultTitle").focus();});
 $("vaultList").querySelectorAll("[data-vault-del]").forEach(b=>b.onclick=async()=>{const arr=await readList("arunVault"),n=arr.find(x=>x.id===b.dataset.vaultDel);if(confirm("Move this item to Recently Deleted?")){await trashItem("vault",n);await writeList("arunVault",arr.filter(x=>x.id!==b.dataset.vaultDel));renderVault();}});
}
$("vaultForm").addEventListener("submit",async e=>{e.preventDefault();const arr=await readList("arunVault"),editId=e.target.dataset.editId;const item={id:editId||uid(),title:$("vaultTitle").value.trim(),type:$("vaultType").value,tags:$("vaultTags").value.split(",").map(x=>x.trim()).filter(Boolean),body:$("vaultBody").value,updatedAt:Date.now()};const old=arr.find(x=>x.id===editId);item.createdAt=old?.createdAt||Date.now();const next=old?arr.map(x=>x.id===editId?item:x):[item,...arr];await writeList("arunVault",next);e.target.reset();delete e.target.dataset.editId;renderVault();});
$("capturePage").addEventListener("click",async()=>{try{const tabs=await chrome.tabs.query({active:true,currentWindow:true});const t=tabs[0];if(!t||!t.url||t.url.startsWith("chrome://"))throw Error("This browser page cannot be captured.");$("vaultTitle").value=t.title||"Saved page";$("vaultType").value="Link";$("vaultBody").value=t.url; if(!$("vaultTags").value)$("vaultTags").value="quick-capture";$("vaultForm").requestSubmit();}catch(e){alert(e.message||"Could not capture this page.");}});
$("vaultExport").addEventListener("click",async()=>downloadJson(`arun-pro-vault-${dayKey()}.json`,{app:"ARUN PRO Knowledge Vault",items:await readList("arunVault")}));

let activeCardId=null, cardRevealed=false;
async function renderCards(){
 const cards=await readList("arunFlashcards");if(!cards.length){$("flashQuestion").textContent="Add your first card to begin."; $("flashAnswer").hidden=true;$("cardStats").textContent="0 cards";$("cardList").innerHTML="";return;}
 let idx=cards.findIndex(c=>c.id===activeCardId);if(idx<0)idx=0;activeCardId=cards[idx].id;const c=cards[idx];
 $("flashQuestion").textContent=`${c.deck||"General"} · ${idx+1}/${cards.length}\n${c.question}`;$("flashAnswer").textContent=c.answer;$("flashAnswer").hidden=!cardRevealed;$("revealAnswer").textContent=cardRevealed?"Hide answer":"Reveal answer";
 $("cardStats").textContent=`${cards.length} cards · ${cards.filter(c=>c.known).length} marked known · ${cards.filter(c=>!c.known).length} to revise`;
 $("cardList").innerHTML=cards.map(c=>`<div class="feature-item"><div class="feature-item-main"><b>${safeText(c.question)}</b><small>${safeText(c.deck||"General")} · ${c.known?"Known":"Needs revision"}</small></div><button data-card-review="${safeText(c.id)}">Review</button><button data-card-del="${safeText(c.id)}">Delete</button></div>`).join("");
 $("cardList").querySelectorAll("[data-card-review]").forEach(b=>b.onclick=()=>{activeCardId=b.dataset.cardReview;cardRevealed=false;renderCards();});
 $("cardList").querySelectorAll("[data-card-del]").forEach(b=>b.onclick=async()=>{const arr=await readList("arunFlashcards"),item=arr.find(c=>c.id===b.dataset.cardDel);if(confirm("Move this flashcard to Recently Deleted?")){await trashItem("flashcard",item);await writeList("arunFlashcards",arr.filter(c=>c.id!==b.dataset.cardDel));if(activeCardId===b.dataset.cardDel)activeCardId=null;renderCards();}});
}
$("cardForm").addEventListener("submit",async e=>{e.preventDefault();const a=await readList("arunFlashcards");a.push({id:uid(),question:$("cardQuestion").value.trim(),answer:$("cardAnswer").value.trim(),deck:$("cardDeck").value.trim(),known:false,createdAt:Date.now(),lastReviewed:null});await writeList("arunFlashcards",a);e.target.reset();activeCardId=a[a.length-1].id;cardRevealed=false;renderCards();});
$("revealAnswer").addEventListener("click",()=>{cardRevealed=!cardRevealed;renderCards();});
$("nextCard").addEventListener("click",async()=>{const a=await readList("arunFlashcards");if(!a.length)return;let i=a.findIndex(c=>c.id===activeCardId);activeCardId=a[(i+1)%a.length].id;cardRevealed=false;renderCards();});
$("cardKnown").addEventListener("click",async()=>{const a=await readList("arunFlashcards"),c=a.find(x=>x.id===activeCardId);if(!c)return;c.known=true;c.lastReviewed=Date.now();await writeList("arunFlashcards",a);await renderCards();});

async function renderUsage(){
 const a=await readList("arunUsageLog"),productive=a.filter(x=>x.kind==="productive").reduce((n,x)=>n+x.minutes,0),distract=a.filter(x=>x.kind==="distraction").reduce((n,x)=>n+x.minutes,0);
 $("usageSummary").innerHTML=`<div class="feature-item"><div class="feature-item-main"><b>Productive time: ${productive} min</b><small>Distraction time: ${distract} min · ${a.length} logged activities</small></div></div>`+a.slice().reverse().slice(0,20).map(x=>`<div class="feature-item"><div class="feature-item-main"><b>${safeText(x.site)}</b><small>${x.minutes} min · ${x.kind} · ${new Date(x.at).toLocaleString()}</small></div><button data-usage-del="${safeText(x.id)}">Delete</button></div>`).join("");
 $("usageSummary").querySelectorAll("[data-usage-del]").forEach(b=>b.onclick=async()=>{await writeList("arunUsageLog",a.filter(x=>x.id!==b.dataset.usageDel));renderUsage();});
}
$("usageForm").addEventListener("submit",async e=>{e.preventDefault();const a=await readList("arunUsageLog");a.push({id:uid(),site:$("usageSite").value.trim(),minutes:Number($("usageMinutes").value),kind:$("usageKind").value,at:Date.now()});await writeList("arunUsageLog",a);e.target.reset();renderUsage();});
let focusInterval=null;
async function paintFocus(){const s=(await chrome.storage.local.get("arunFocusSession")).arunFocusSession;if(!s){$("focusClock").textContent="No active session";if(focusInterval)clearInterval(focusInterval);return;}const sec=Math.max(0,Math.ceil((s.endAt-Date.now())/1000));$("focusClock").textContent=`${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")} remaining`;if(sec<=0){await chrome.storage.local.remove("arunFocusSession");await logFocus(s);$("focusClock").textContent="Session complete ✓";if(focusInterval)clearInterval(focusInterval);const p=(await chrome.storage.local.get("arunPreferences")).arunPreferences||{};if(p.reminders==="on"&&chrome.notifications)chrome.notifications.create({type:"basic",iconUrl:"icon.png",title:"ARUN PRO Focus",message:"Focus session completed. Take a short break."});}}
async function logFocus(s){const a=await readList("arunUsageLog");a.push({id:uid(),site:"Focus session",minutes:s.minutes,kind:"productive",at:Date.now()});await writeList("arunUsageLog",a);renderUsage();}
$("focusStart").addEventListener("click",async()=>{const minutes=Math.max(1,Math.min(180,Number($("focusMinutes").value)||25));await chrome.storage.local.set({arunFocusSession:{startedAt:Date.now(),endAt:Date.now()+minutes*60000,minutes}});if(focusInterval)clearInterval(focusInterval);paintFocus();focusInterval=setInterval(paintFocus,1000);});
$("focusStop").addEventListener("click",async()=>{const s=(await chrome.storage.local.get("arunFocusSession")).arunFocusSession;if(s&&confirm("Save elapsed focus time and stop?")){const elapsed=Math.max(1,Math.floor((Date.now()-s.startedAt)/60000));await chrome.storage.local.remove("arunFocusSession");await logFocus({...s,minutes:Math.min(s.minutes,elapsed)});}else await chrome.storage.local.remove("arunFocusSession");paintFocus();});

async function renderHeatmap(){
 const r=await chrome.storage.local.get(['habits','timeData','siteCategories','pomoStudySeconds','arunStudyHeatmapSource','arunStudyHeatmapPeriod','arunStudyHeatmapMonth','arunStudyHeatmapYear']);
 const habits=Array.isArray(r.habits)?r.habits:[];
 const timeData=r.timeData&&typeof r.timeData==='object'?r.timeData:{};
 const siteCategories=r.siteCategories&&typeof r.siteCategories==='object'?r.siteCategories:{};
 const pomoStudySeconds=r.pomoStudySeconds&&typeof r.pomoStudySeconds==='object'?r.pomoStudySeconds:{};
 const today=new Date();today.setHours(0,0,0,0);
 const todayKey=dayKey(today),currentMonth=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
 const isDateKey=k=>isValidDateKey(k,todayKey);
 const fmtDate=k=>{const d=new Date(`${k}T12:00:00`);return Number.isNaN(d.getTime())?String(k):d.toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'});};
 const fmtDuration=raw=>{const n=Math.max(0,Math.round(Number(raw)||0)),h=Math.floor(n/3600),m=Math.floor((n%3600)/60),s=n%60;return h?`${h}h ${m}m${s?` ${s}s`:''}`:m?`${m}m${s?` ${s}s`:''}`:`${s}s`;};
 const sourceControl=$('studyHeatmapSource'),periodControl=$('studyHeatmapPeriod'),monthControl=$('studyHeatmapMonth'),yearControl=$('studyHeatmapYear');
 const source=r.arunStudyHeatmapSource==='pomodoro'?'pomodoro':'website';
 const allowedPeriods=new Set(['rolling52','monthly','yearly','alltime']);
 const period=allowedPeriods.has(r.arunStudyHeatmapPeriod)?r.arunStudyHeatmapPeriod:'alltime';
 if(sourceControl)sourceControl.value=source;if(periodControl)periodControl.value=period;
 if(monthControl){monthControl.max=currentMonth;monthControl.value=/^\d{4}-\d{2}$/.test(r.arunStudyHeatmapMonth||'')&&r.arunStudyHeatmapMonth<=currentMonth?r.arunStudyHeatmapMonth:currentMonth;}
 const allDateKeys=[...new Set([...Object.keys(timeData),...Object.keys(pomoStudySeconds)].filter(isDateKey))].sort();
 const availableYears=[...new Set([today.getFullYear(),...allDateKeys.map(k=>Number(k.slice(0,4)))])].filter(y=>Number.isFinite(y)&&y<=today.getFullYear()).sort((a,b)=>b-a);
 if(yearControl){const old=String(r.arunStudyHeatmapYear||today.getFullYear());yearControl.innerHTML=availableYears.map(y=>`<option value="${y}">${y}</option>`).join('');yearControl.value=availableYears.includes(Number(old))?old:String(today.getFullYear());}
 const monthLabel=$('studyHeatmapMonthLabel'),yearLabel=$('studyHeatmapYearLabel');
 if(monthLabel)monthLabel.hidden=period!=='monthly';if(yearLabel)yearLabel.hidden=period!=='yearly';
 const sourceKeys=(source==='website'?Object.keys(timeData):Object.keys(pomoStudySeconds)).filter(isDateKey).sort();
 let startDate,endDate=new Date(today),selectedYear=Number(yearControl?.value)||today.getFullYear(),selectedMonth=(monthControl?.value||currentMonth);
 if(period==='rolling52'){const sunday=new Date(today);sunday.setDate(sunday.getDate()-sunday.getDay());startDate=new Date(sunday);startDate.setDate(startDate.getDate()-51*7);}
 else if(period==='monthly'){const [yy,mm]=selectedMonth.split('-').map(Number);startDate=new Date(yy,mm-1,1);const monthEnd=new Date(yy,mm,0);endDate=monthEnd>today?new Date(today):monthEnd;}
 else if(period==='yearly'){startDate=new Date(selectedYear,0,1);const yearEnd=new Date(selectedYear,11,31);endDate=yearEnd>today?new Date(today):yearEnd;}
 else{startDate=new Date(`${sourceKeys[0]||`${today.getFullYear()}-01-01`}T00:00:00`);}
 startDate.setHours(0,0,0,0);endDate.setHours(0,0,0,0);
 if(startDate>today)startDate=new Date(today);if(endDate<startDate)endDate=new Date(startDate);
 const startKey=dayKey(startDate),endKey=dayKey(endDate),actualDays=[];
 for(let d=new Date(startDate);d<=endDate;d.setDate(d.getDate()+1)){
   const key=dayKey(d),entries=timeData[key]&&typeof timeData[key]==='object'?timeData[key]:{};
   let studySec=0,wasteSec=0,siteCount=0;
   Object.entries(entries).forEach(([site,raw])=>{const n=Math.max(0,Math.round(Number(raw)||0));if(!n)return;siteCount++;if((siteCategories[site]||'waste')==='study')studySec+=n;else wasteSec+=n;});
   const hasPomo=Object.prototype.hasOwnProperty.call(pomoStudySeconds,key)&&Number.isFinite(Number(pomoStudySeconds[key]))&&Number(pomoStudySeconds[key])>0;
   const pomoSec=hasPomo?Math.max(0,Math.round(Number(pomoStudySeconds[key])||0)):0;
   actualDays.push({key,studySec,wasteSec,totalSec:studySec+wasteSec,siteCount,hasWebsiteEntry:Object.keys(entries).length>0,pomoSec,hasPomo});
 }
 const dataMap=new Map(actualDays.map(d=>[d.key,d]));
 // Pad the calendar to Sunday–Saturday columns; padding is visual alignment only.
 const paddedStart=new Date(startDate);paddedStart.setDate(paddedStart.getDate()-paddedStart.getDay());
 const paddedEnd=new Date(endDate);paddedEnd.setDate(paddedEnd.getDate()+(6-paddedEnd.getDay()));
 const gridDays=[];for(let d=new Date(paddedStart);d<=paddedEnd;d.setDate(d.getDate()+1)){const key=dayKey(d);gridDays.push({key,date:new Date(d),pad:key<startKey||key>endKey,stats:dataMap.get(key)||null});}
 const columnCount=Math.ceil(gridDays.length/7),maxWebsiteVolume=Math.max(1,...actualDays.map(d=>d.totalSec));
 const positivePomo=actualDays.filter(d=>d.pomoSec>0).map(d=>d.pomoSec).sort((a,b)=>a-b),pomoLevelByValue=new Map();
 for(let i=0;i<positivePomo.length;){let j=i+1;while(j<positivePomo.length&&positivePomo[j]===positivePomo[i])j++;const rank=(i+j)/(2*positivePomo.length),level=positivePomo.length<4?2:rank<.25?1:rank<.5?2:rank<.75?3:4;pomoLevelByValue.set(positivePomo[i],level);i=j;}
 const heatmap=$('studyTimeHeatmap'),monthStrip=$('studyHeatmapMonths'),legend=$('studyHeatmapLegend');
 if(heatmap){
   heatmap.className=`study-heatmap-grid heat-mode-${source}`;heatmap.style.gridTemplateColumns=`repeat(${columnCount},13px)`;
   heatmap.innerHTML=gridDays.map(cell=>{
     if(cell.pad)return '<span class="study-heat-day heat-pad" aria-hidden="true"></span>';
     const d=cell.stats,has=source==='website'?d.totalSec>0:d.hasPomo;let level=0,title='';
     let inlineStyle='';
     if(source==='website'&&has){const share=d.studySec/d.totalSec;level=share>=.8?1:share>=.6?2:share>=.4?3:share>=.2?4:5;const sp=Math.round(share*100),wp=100-sp,ratio=d.wasteSec>0?(d.studySec/d.wasteSec).toFixed(2)+' : 1':'No Waste time recorded';const intensity=.28+.72*(Math.log1p(d.totalSec)/Math.log1p(maxWebsiteVolume));inlineStyle=`background:linear-gradient(90deg,rgba(66,215,167,.95) 0 ${sp}%,rgba(233,107,120,.95) ${sp}% 100%);opacity:${intensity.toFixed(2)};`;title=`${fmtDate(cell.key)} · Study ${fmtDuration(d.studySec)} (${sp}%) · Waste ${fmtDuration(d.wasteSec)} (${wp}%) · Study/Waste ratio ${ratio} · Total ${fmtDuration(d.totalSec)} · ${d.siteCount} positive site record(s). Teal = Study share, coral = Waste share; opacity represents relative recorded total. Unclassified websites count as Waste, matching extension analytics.`;}
     else if(source==='website')title=`${fmtDate(cell.key)} · No positive website time record saved${d.hasWebsiteEntry?' (entries exist but have no positive seconds)':''}. This does not prove no study occurred.`;
     else if(has){level=pomoLevelByValue.get(d.pomoSec)||2;const distribution=positivePomo.length<4?'Few recorded days; colour is a neutral recorded-time level':`Relative rank among ${positivePomo.length} days with positive Pomodoro time in this selected range`;title=`${fmtDate(cell.key)} · Pomodoro study ${fmtDuration(d.pomoSec)} · ${distribution}.`;}
     else title=`${fmtDate(cell.key)} · No positive elapsed Pomodoro study-time record saved. This does not prove no study occurred.`;
     return `<span class="study-heat-day heat-level-${level}" role="gridcell" tabindex="0" title="${safeText(title)}" aria-label="${safeText(title)}" data-date="${cell.key}" style="${inlineStyle}"></span>`;
   }).join('');
 }
 if(monthStrip){
   monthStrip.style.gridTemplateColumns=`repeat(${columnCount},13px)`;const starts=[],seen=new Set();
   gridDays.forEach((cell,index)=>{if(cell.pad)return;const d=cell.date;if(d.getDate()===1||cell.key===startKey){const col=Math.floor(index/7);if(!seen.has(col)){seen.add(col);const label=(period==='alltime'&&d.getMonth()===0)?d.toLocaleDateString(undefined,{month:'short',year:'2-digit'}):d.toLocaleDateString(undefined,{month:'short'});starts.push({col,label});}}});
   monthStrip.innerHTML=starts.map((item,i)=>{const next=i+1<starts.length?starts[i+1].col:columnCount;return `<span style="grid-column:${item.col+1} / span ${Math.max(1,next-item.col)}">${safeText(item.label)}</span>`;}).join('');
 }
 if(legend){legend.className=`study-heatmap-legend heat-mode-${source}`;const item=(level,label)=>`<span><i class="heat-level-${level}"></i>${label}</span>`;
   legend.innerHTML=source==='website'?item(0,'No positive record')+`<span><i style="background:linear-gradient(90deg,#42d7a7 0 60%,#e96b78 60% 100%)"></i>Teal share = Study · coral share = Waste</span>`+`<span>Opacity = total tracked time relative to this range</span>`:item(0,'No positive record')+(positivePomo.length<4?item(2,'Recorded Pomodoro time'):item(1,'Lower quarter')+item(2,'Below median')+item(3,'Above median')+item(4,'Top quarter'));
 }
 const summary=$('studyHeatmapSummary'),method=$('studyHeatmapMethod');
 const dateLabel=date=>date.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'});
 const activeWebsiteDays=actualDays.filter(d=>d.totalSec>0).length,trackedPomoDays=actualDays.filter(d=>d.hasPomo).length;
 const sumStudy=actualDays.reduce((n,d)=>n+d.studySec,0),sumWaste=actualDays.reduce((n,d)=>n+d.wasteSec,0),sumPomo=actualDays.reduce((n,d)=>n+d.pomoSec,0),totalWebsite=sumStudy+sumWaste;
 const selectedLabel=period==='rolling52'?`Recent 52 weeks · ${dateLabel(startDate)} – ${dateLabel(endDate)}`:period==='monthly'?`${startDate.toLocaleDateString(undefined,{month:'long',year:'numeric'})} · through ${dateLabel(endDate)}`:period==='yearly'?`${selectedYear} · ${dateLabel(startDate)} – ${dateLabel(endDate)}`:`All time · ${dateLabel(startDate)} – ${dateLabel(endDate)}`;
 if(summary){if(source==='website'){
   const sp=totalWebsite?Math.round(sumStudy/totalWebsite*100):0,wp=totalWebsite?100-sp:0,ratio=sumWaste>0?(sumStudy/sumWaste).toFixed(2)+'×':sumStudy>0?'Study recorded; no Waste time recorded':'N/A';
   summary.textContent=`${selectedLabel} · Study ${fmtDuration(sumStudy)} (${sp}%) · Waste ${fmtDuration(sumWaste)} (${wp}%) · Study/Waste ratio ${ratio} · ${activeWebsiteDays} day(s) with positive website time.`;
 }else summary.textContent=`${selectedLabel} · Pomodoro study ${fmtDuration(sumPomo)} across ${trackedPomoDays} day(s) with positive elapsed seconds. ${positivePomo.length<4?'Too few recorded days for useful percentile ranking.':'Colours rank daily values within this selected range.'}`;}
 if(method)method.textContent=source==='website'
   ?'Colour represents the split of recorded Website Study vs Waste time for that day (not a fixed minutes threshold). Hover or focus a square for exact time, both percentages and the ratio. Sites without an explicit Study category are counted as Waste, matching the analytics report. No browser history is scanned.'
   :'Colour represents the relative rank of recorded Pomodoro study seconds within the selected period, not an arbitrary 60-minute threshold. For fewer than four recorded days, colours avoid a misleading ranking. Website Study/Waste is not mixed into Pomodoro time.';
 const dayMs=86400000;
 const validCheckins=h=>Object.keys(h.entries||{}).filter(k=>{
   if(!isValidDateKey(k,todayKey))return false;const v=h.entries[k];if(v===undefined||v===null||v===false||v===0)return false;
   if(typeof v==='number')return Number.isFinite(v)&&v>0;
   const text=String(v).trim().toLowerCase();if(!text||text==='false'||text==='no'||text==='0')return false;
   const n=Number(text);return !Number.isFinite(n)||n>0;
 }).sort();
 const longestRun=keys=>{let best=0,run=0,prev=null;for(const k of keys){const t=Date.parse(k+'T00:00:00Z');if(prev!==null&&t-prev===dayMs)run++;else run=1;best=Math.max(best,run);prev=t;}return best;};
 const currentRun=keys=>{const set=new Set(keys),todayKey=dayKey(today),yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);let cursor=set.has(todayKey)?new Date(today):yesterday,n=0;while(set.has(dayKey(cursor))){n++;cursor.setDate(cursor.getDate()-1);}return n;};
 const streaks=$('habitStreaks');
 if(streaks)streaks.innerHTML=habits.map(h=>{const keys=validCheckins(h),current=currentRun(keys),best=longestRun(keys);return `<div class="feature-item"><div class="feature-item-main"><b>${safeText(h.name||'Untitled habit')}</b><small>🔥 ${current} day current streak · 🏆 ${best} day best streak · ${keys.length} saved positive check-in day(s)</small></div></div>`}).join('')||'<div class="nt-empty">No habits saved yet. Add habits in the extension popup; current and best streaks will appear here after check-ins.</div>';
}
async function saveHeatmapControl(controlId,storageKey){const el=$(controlId);if(!el)return;await chrome.storage.local.set({[storageKey]:el.value});await renderHeatmap();}
$('studyHeatmapSource')?.addEventListener('change',()=>saveHeatmapControl('studyHeatmapSource','arunStudyHeatmapSource'));
$('studyHeatmapPeriod')?.addEventListener('change',()=>saveHeatmapControl('studyHeatmapPeriod','arunStudyHeatmapPeriod'));
$('studyHeatmapMonth')?.addEventListener('change',()=>saveHeatmapControl('studyHeatmapMonth','arunStudyHeatmapMonth'));
$('studyHeatmapYear')?.addEventListener('change',()=>saveHeatmapControl('studyHeatmapYear','arunStudyHeatmapYear'));

async function renderReview(){
 const r=await chrome.storage.local.get(["tasks","habits","studyHistory","arunReviews"]);const tasks=r.tasks||[],habits=r.habits||[],history=r.studyHistory||[],done=tasks.filter(t=>t.done).length,todayHabits=habits.filter(h=>h.entries&&h.entries[dayKey()]!==undefined).length,secs=history.filter(x=>(x.date||x.day||"").slice(0,10)===dayKey()).reduce((n,x)=>n+(Number(x.duration)||Number(x.seconds)||0),0);
 $("reviewSummary").innerHTML=`<div><small>Tasks done</small><strong>${done}/${tasks.length}</strong></div><div><small>Habits checked</small><strong>${todayHabits}/${habits.length}</strong></div><div><small>Study logged</small><strong>${Math.round(secs/60)} min</strong></div>`;
 const reviews=Array.isArray(r.arunReviews)?r.arunReviews:[],today=reviews.find(x=>x.date===dayKey());$("reviewText").value=today?.text||"";
 $("reviewHistory").innerHTML=reviews.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,14).map(x=>`<div class="feature-item"><div class="feature-item-main"><b>${safeText(x.date)}</b><p>${safeText(x.text)}</p></div></div>`).join("");
}
$("saveReview").addEventListener("click",async()=>{const a=await readList("arunReviews"),i=a.findIndex(x=>x.date===dayKey()),item={date:dayKey(),text:$("reviewText").value,updatedAt:Date.now()};if(i>=0)a[i]=item;else a.push(item);await writeList("arunReviews",a);renderReview();alert("Today's review saved.");});
async function loadPreferences(){const p=(await chrome.storage.local.get("arunPreferences")).arunPreferences||{};$("densitySetting").value=p.density||"comfortable";$("analyticsSetting").value=p.analytics||"show";$("reminderSetting").value=p.reminders||"off";document.querySelector(".nt-grid").classList.toggle("compact",p.density==="compact");const analytics=document.querySelector("#ntAnalytics")?.closest(".nt-card");if(analytics)analytics.hidden=p.analytics==="hide";}
$("savePreferences").addEventListener("click",async()=>{const p={density:$("densitySetting").value,analytics:$("analyticsSetting").value,reminders:$("reminderSetting").value};await chrome.storage.local.set({arunPreferences:p});await loadPreferences();alert("Preferences saved.");});
async function trashItem(type,item){if(!item)return;const t=await readList("arunDeleted");t.push({type,item,deletedAt:Date.now()});await writeList("arunDeleted",t);}
$("safetyExport").addEventListener("click",async()=>{const data=await chrome.storage.local.get(null);downloadJson(`arun-pro-full-backup-${dayKey()}.json`,{app:"ARUN PRO",backupVersion:2,exportedAt:new Date().toISOString(),data});});
$("safetyImport").addEventListener("click",()=>$("backupFile").click());
$("healthCheck").addEventListener("click",async()=>{const d=await chrome.storage.local.get(null),checks=[["tasks",Array.isArray(d.tasks)],["habits",Array.isArray(d.habits)],["assignments",Array.isArray(d.assignments)],["diaryEntries",d.diaryEntries===undefined||Array.isArray(d.diaryEntries)],["arunExams",d.arunExams===undefined||Array.isArray(d.arunExams)],["arunVault",d.arunVault===undefined||Array.isArray(d.arunVault)],["arunFlashcards",d.arunFlashcards===undefined||Array.isArray(d.arunFlashcards)],["arunReviews",d.arunReviews===undefined||Array.isArray(d.arunReviews)]];$("healthReport").innerHTML=checks.map(([k,ok])=>`<div class="feature-item"><div class="feature-item-main"><b>${safeText(k)}</b><small>${ok?"✓ Valid or not created yet":"⚠ Unexpected data type — export backup before repair"}</small></div></div>`).join("");});
$("exportTrash").addEventListener("click",async()=>downloadJson(`arun-pro-trash-${dayKey()}.json`,{items:await readList("arunDeleted")}));
$("restoreTrash").addEventListener("click",async()=>{const t=await readList("arunDeleted");if(!t.length){alert("Recently deleted is empty.");return;}const last=t[t.length-1],map={exam:"arunExams",vault:"arunVault",flashcard:"arunFlashcards"};if(!confirm(`Restore last deleted ${last.type}?`))return;const key=map[last.type];if(!key){alert("This item type cannot be restored automatically yet. Export Recently Deleted backup.");return;}const arr=await readList(key);if(!arr.some(x=>x.id===last.item.id))arr.push(last.item);await writeList(key,arr);t.pop();await writeList("arunDeleted",t);renderExams();renderVault();renderCards();alert("Item restored.");});

$("globalSearch").addEventListener("input",async()=>{const q=$("globalSearch").value.trim().toLowerCase(),box=$("featureSearchResults");if(!q){box.hidden=true;return;}const [tasks,notes,cards,exams]=await Promise.all([chrome.storage.local.get("tasks").then(r=>r.tasks||[]),readList("arunVault"),readList("arunFlashcards"),readList("arunExams")]);const results=[...tasks.filter(x=>(x.text||"").toLowerCase().includes(q)).map(x=>({kind:"Task",title:x.text,body:x.done?"Completed":"Pending"})),...notes.filter(x=>JSON.stringify(x).toLowerCase().includes(q)).map(x=>({kind:"Vault",title:x.title,body:x.body})),...cards.filter(x=>JSON.stringify(x).toLowerCase().includes(q)).map(x=>({kind:"Flashcard",title:x.question,body:x.answer})),...exams.filter(x=>JSON.stringify(x).toLowerCase().includes(q)).map(x=>({kind:"Exam",title:x.name,body:x.date}))];box.hidden=false;box.innerHTML=results.length?results.slice(0,30).map(x=>`<div class="feature-item"><div class="feature-item-main"><b>${safeText(x.kind)} · ${safeText(x.title)}</b><small>${safeText(x.body||"")}</small></div></div>`).join(""):'<div class="nt-empty">No matches found.</div>';});
async function initAdvanced(){await Promise.all([renderExams(),renderVault(),renderCards(),renderUsage(),renderHeatmap(),renderReview(),loadPreferences(),paintFocus()]);const s=(await chrome.storage.local.get("arunFocusSession")).arunFocusSession;if(s){if(focusInterval)clearInterval(focusInterval);focusInterval=setInterval(paintFocus,1000);}}
initAdvanced();
chrome.storage.onChanged.addListener((changes,area)=>{if(area!=="local")return;if(changes.habits)renderHeatmap();if(changes.tasks||changes.habits||changes.studyHistory)renderReview();if(changes.arunExams)renderExams();if(changes.arunVault)renderVault();if(changes.arunFlashcards)renderCards();});


// ARUN PRO v4.0: additional local-first workspace modules. All records use new arunSuite* keys.
const suiteKeys={plans:'arunSuitePlans',goals:'arunSuiteGoals',expenses:'arunSuiteExpenses',reminders:'arunSuiteReminders',quiz:'arunSuiteQuiz',reading:'arunSuiteReading',snippets:'arunSuiteSnippets',sound:'arunSuiteSound',style:'arunSuiteStyle',rewards:'arunSuiteRewards'};
async function suiteGet(k){const r=await chrome.storage.local.get(suiteKeys[k]);return Array.isArray(r[suiteKeys[k]])?r[suiteKeys[k]]:[]}
async function suitePut(k,v){await chrome.storage.local.set({[suiteKeys[k]]:v});}
const suiteId=()=>`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
function suiteItem(title,detail='',buttons=''){return `<div class="suite-item"><div><b>${safeText(title)}</b>${detail?`<small>${safeText(detail)}</small>`:''}</div>${buttons}</div>`}
async function suiteRender(){
 const plans=await suiteGet('plans');$('suitePlans').innerHTML=plans.slice().sort((a,b)=>(a.when||'').localeCompare(b.when||'')).map(x=>suiteItem(x.title,`${x.kind} · ${x.when?new Date(x.when).toLocaleString():'Unscheduled'} · ${x.done?'Completed':'Planned'}`,`<button data-plan-done="${x.id}" class="mini-action">${x.done?'↺':'✓'}</button><button data-plan-del="${x.id}" class="mini-action">×</button>`)).join('')||'<p class="nt-empty">Add your first study block.</p>';
 const goals=await suiteGet('goals');$('suiteGoals').innerHTML=goals.map(x=>suiteItem(x.title,`${x.progress||0}/${x.target} completed · ${Math.min(100,Math.round((x.progress||0)/x.target*100))}%`, `<button data-goal-plus="${x.id}" class="mini-action">+1</button><button data-goal-del="${x.id}" class="mini-action">×</button>`)).join('')||'<p class="nt-empty">Create a small goal to get started.</p>';
 const expenses=await suiteGet('expenses'),total=expenses.reduce((n,x)=>n+x.amount,0);$('suiteExpenses').innerHTML=`<div class="suite-total">Total tracked <b>₹${total.toLocaleString('en-IN',{maximumFractionDigits:2})}</b></div>`+expenses.slice(-5).reverse().map(x=>suiteItem(x.name,`₹${x.amount.toLocaleString('en-IN')} · ${x.date}`,`<button data-expense-del="${x.id}" class="mini-action">×</button>`)).join('');
 const reminders=await suiteGet('reminders');$('suiteReminders').innerHTML=reminders.slice().sort((a,b)=>a.when.localeCompare(b.when)).map(x=>suiteItem(x.title,new Date(x.when).toLocaleString(),`<button data-reminder-del="${x.id}" class="mini-action">×</button>`)).join('')||'<p class="nt-empty">No reminders saved yet.</p>';
 const quiz=await suiteGet('quiz');$('suiteQuizList').innerHTML=quiz.slice(-5).reverse().map(x=>suiteItem(x.q,`${x.deck||'General'} · ${x.a}`,`<button data-quiz-show="${x.id}" class="mini-action">Reveal</button><button data-quiz-del="${x.id}" class="mini-action">×</button>`)).join('')||'<p class="nt-empty">Build a small practice bank.</p>';
 const reading=await suiteGet('reading');$('suiteReadList').innerHTML=reading.slice().reverse().map(x=>suiteItem(x.title,x.done?'Read ✓':'Unread',`${x.url?`<button data-read-open="${x.id}" class="mini-action">Open</button>`:''}<button data-read-done="${x.id}" class="mini-action">${x.done?'↺':'✓'}</button><button data-read-del="${x.id}" class="mini-action">×</button>`)).join('')||'<p class="nt-empty">Save tutorials to read later.</p>';
 const snippets=await suiteGet('snippets');$('suiteCodeList').innerHTML=snippets.slice().reverse().map(x=>suiteItem(x.title,x.lang,`<button data-code-copy="${x.id}" class="mini-action">Copy</button><button data-code-del="${x.id}" class="mini-action">×</button>`)).join('')||'<p class="nt-empty">Save reusable code snippets here.</p>';
 const rewards=(await suiteGet('rewards'))[0]||{xp:0};$('suiteRewards').innerHTML=suiteItem(`${rewards.xp||0} XP earned`,`${Math.floor((rewards.xp||0)/100)} level(s) · Complete plans and goals to earn XP`);
}
async function suiteReward(n){const a=await suiteGet('rewards');const r=a[0]||{xp:0};r.xp=(r.xp||0)+n;await suitePut('rewards',[r]);}
$('suitePlanForm').addEventListener('submit',async e=>{e.preventDefault();const a=await suiteGet('plans');a.push({id:suiteId(),title:$('suitePlanTitle').value.trim(),when:$('suitePlanWhen').value,kind:$('suitePlanKind').value,done:false,createdAt:Date.now()});await suitePut('plans',a);e.target.reset();await suiteRender();});
$('suiteGoalForm').addEventListener('submit',async e=>{e.preventDefault();const a=await suiteGet('goals');a.push({id:suiteId(),title:$('suiteGoalTitle').value.trim(),target:Number($('suiteGoalTarget').value)||1,progress:0,createdAt:Date.now()});await suitePut('goals',a);e.target.reset();await suiteRender();});
$('suiteExpenseForm').addEventListener('submit',async e=>{e.preventDefault();const a=await suiteGet('expenses');a.push({id:suiteId(),name:$('suiteExpenseName').value.trim(),amount:Number($('suiteExpenseAmount').value),date:dayKey()});await suitePut('expenses',a);e.target.reset();await suiteRender();});
$('suiteReminderForm').addEventListener('submit',async e=>{e.preventDefault();const a=await suiteGet('reminders');a.push({id:suiteId(),title:$('suiteReminderTitle').value.trim(),when:$('suiteReminderWhen').value});await suitePut('reminders',a);e.target.reset();await suiteRender();});
$('suiteQuizForm').addEventListener('submit',async e=>{e.preventDefault();const a=await suiteGet('quiz');a.push({id:suiteId(),q:$('suiteQuizQ').value.trim(),a:$('suiteQuizA').value.trim(),deck:$('suiteQuizDeck').value.trim()});await suitePut('quiz',a);e.target.reset();await suiteRender();});
$('suiteReadForm').addEventListener('submit',async e=>{e.preventDefault();const a=await suiteGet('reading');a.push({id:suiteId(),title:$('suiteReadTitle').value.trim(),url:$('suiteReadUrl').value.trim(),done:false});await suitePut('reading',a);e.target.reset();await suiteRender();});
$('suiteCodeForm').addEventListener('submit',async e=>{e.preventDefault();const a=await suiteGet('snippets');a.push({id:suiteId(),title:$('suiteCodeTitle').value.trim(),lang:$('suiteCodeLang').value,body:$('suiteCodeBody').value});await suitePut('snippets',a);e.target.reset();await suiteRender();});
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
 for(const [attr,key] of [['plan-del','plans'],['goal-del','goals'],['expense-del','expenses'],['reminder-del','reminders'],['quiz-del','quiz'],['read-del','reading'],['code-del','snippets']])if(d[attr]){await suitePut(key,(await suiteGet(key)).filter(x=>x.id!==d[attr]));await suiteRender();return;}
 if(d.planDone){const a=await suiteGet('plans'),x=a.find(x=>x.id===d.planDone);if(x){x.done=!x.done;if(x.done)await suiteReward(10);await suitePut('plans',a);await suiteRender();}return;}
 if(d.goalPlus){const a=await suiteGet('goals'),x=a.find(x=>x.id===d.goalPlus);if(x){x.progress=Math.min(x.target,(x.progress||0)+1);await suitePut('goals',a);await suiteReward(5);await suiteRender();}return;}
 if(d.quizShow){const x=(await suiteGet('quiz')).find(x=>x.id===d.quizShow);if(x)alert('Answer: '+x.a);return;}
 if(d.readDone){const a=await suiteGet('reading'),x=a.find(x=>x.id===d.readDone);if(x)x.done=!x.done;await suitePut('reading',a);await suiteRender();return;}
 if(d.readOpen){const x=(await suiteGet('reading')).find(x=>x.id===d.readOpen);if(x?.url)window.open(x.url,'_blank','noopener');return;}
 if(d.codeCopy){const x=(await suiteGet('snippets')).find(x=>x.id===d.codeCopy);if(x){try{await navigator.clipboard.writeText(x.body);alert('Snippet copied.')}catch{prompt('Copy this snippet:',x.body)}}return;}
});
const quotes=['Small steps, repeated daily, become remarkable progress.','Start before you feel ready.','Focus on the next useful action, not the whole mountain.','Consistency beats intensity when repeated over time.','Your future self benefits from the work you do today.'];
$('suiteQuoteNext').addEventListener('click',()=>{$('suiteQuote').textContent=quotes[Math.floor(Math.random()*quotes.length)];});
$('suiteCalcGo').addEventListener('click',()=>{const s=$('suiteCalcInput').value.trim();if(!s||!/^[0-9+\-*/().%\s]+$/.test(s)||/[a-z]/i.test(s)){ $('suiteCalcResult').textContent='Use numbers and + − × ÷ ( ) % only';return;}try{const v=Function('"use strict";return ('+s+')')();$('suiteCalcResult').textContent=Number.isFinite(v)?String(v):'Invalid expression';}catch{$('suiteCalcResult').textContent='Invalid expression';}});
function playSuiteTone(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)throw Error();const ctx=new C();const mode=$('suiteSound').value;[0,...(mode==='double'?[0.16]:[])].forEach((delay,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type=mode==='wood'?'triangle':'sine';o.frequency.value=mode==='wood'?740:(i?1046:880);g.gain.setValueAtTime(.0001,ctx.currentTime+delay);g.gain.exponentialRampToValueAtTime(.16,ctx.currentTime+delay+.02);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+delay+.45);o.connect(g);g.connect(ctx.destination);o.start(ctx.currentTime+delay);o.stop(ctx.currentTime+delay+.48);});setTimeout(()=>ctx.close(),1000);}catch{alert('Audio is unavailable in this browser context. Click the page once and try again.');}}
$('suiteSoundTest').addEventListener('click',playSuiteTone);$('suiteSoundEnabled').addEventListener('change',async()=>{const a=await chrome.storage.local.get('arunSuiteSound');await chrome.storage.local.set({arunSuiteSound:{...(a.arunSuiteSound||{}),enabled:$('suiteSoundEnabled').checked}})});
$('suiteStyleSave').addEventListener('click',async()=>{const style={accent:$('suiteAccent').value,mood:$('suiteMood').value};await chrome.storage.local.set({arunSuiteStyle:style});document.documentElement.style.setProperty('--accent',style.accent);document.body.dataset.mood=style.mood;alert('Style applied and saved.');});
$('suiteExport').addEventListener('click',async()=>{const data={};for(const k of Object.keys(suiteKeys)){data[suiteKeys[k]]=(await chrome.storage.local.get(suiteKeys[k]))[suiteKeys[k]]??[];}downloadJson(`arun-pro-suite-${dayKey()}.json`,{app:'ARUN PRO Suite',version:4,exportedAt:new Date().toISOString(),data});});
function analyticsDate(value){
 if(value===undefined||value===null||value==='')return null;
 let d;
 if(typeof value==='number'&&Number.isFinite(value)) d=new Date(Math.abs(value)<1e12?value*1000:value);
 else if(typeof value==='string'&&/^\d{10,13}$/.test(value.trim())){const n=Number(value);d=new Date(value.trim().length<=10?n*1000:n);}
 else if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)) d=new Date(value+'T00:00:00');
 else d=new Date(value);
 return !d||Number.isNaN(d.getTime())?null:d;
}
function analyticsRecordDate(x){
 if(!x||typeof x!=='object')return null;
 for(const value of [x.at,x.startedAt,x.startTime,x.timestamp,x.date,x.day]){if(value===undefined||value===null||value==='')continue;const d=analyticsDate(value);if(d)return d;}
 return null;
}
async function renderDeepAnalytics(){
 const keys=['tasks','habits','studyHistory','assignments','arunUsageLog','arunExams','arunVault','arunFlashcards','arunSuitePlans','arunSuiteGoals','timeData','siteCategories','pomoHistory','subjectTime','subjects','pomoStudySeconds'];
 const r=await chrome.storage.local.get([...keys,'arunAnalyticsPeriod','arunAnalyticsMonth','arunAnalyticsYear']);
 const tasks=Array.isArray(r.tasks)?r.tasks:[],habits=Array.isArray(r.habits)?r.habits:[],legacySessions=Array.isArray(r.studyHistory)?r.studyHistory:[],allManualUsage=Array.isArray(r.arunUsageLog)?r.arunUsageLog:[];
 const timeData=r.timeData&&typeof r.timeData==='object'?r.timeData:{},siteCategories=r.siteCategories&&typeof r.siteCategories==='object'?r.siteCategories:{};
 const pomoHistory=r.pomoHistory&&typeof r.pomoHistory==='object'?r.pomoHistory:{};
 const pomoStudySeconds=r.pomoStudySeconds&&typeof r.pomoStudySeconds==='object'?r.pomoStudySeconds:{};
 const subjectTime=r.subjectTime&&typeof r.subjectTime==='object'?r.subjectTime:{};
 const subjects=Array.isArray(r.subjects)?r.subjects:[];
 const periodControl=$('analyticsPeriod'),now=new Date(),today=dayKey(now);
 if(periodControl&&['daily','weekly','monthly','yearly','alltime'].includes(r.arunAnalyticsPeriod))periodControl.value=r.arunAnalyticsPeriod;
 const period=periodControl?.value||'weekly';
 // Month/year selectors are backed by real stored dates; no historical records are generated.
 const discoverDates=[...Object.keys(timeData),...Object.keys(pomoHistory),...Object.keys(pomoStudySeconds),...Object.keys(subjectTime),
   ...allManualUsage.map(x=>{const d=analyticsRecordDate(x);return d?dayKey(d):''}),
   ...legacySessions.map(x=>{const d=analyticsRecordDate(x);return d?dayKey(d):''})]
   .filter(k=>isValidDateKey(k,today)).sort();
 const earliestStored=discoverDates[0]||today;
 const monthControl=$('analyticsMonth'),yearControl=$('analyticsYear');
 const currentMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
 if(monthControl){monthControl.max=currentMonth;monthControl.value=(/^\d{4}-\d{2}$/.test(r.arunAnalyticsMonth||'')&&r.arunAnalyticsMonth<=currentMonth)?r.arunAnalyticsMonth:(monthControl.value||currentMonth);monthControl.removeAttribute('min');}
 const years=[...new Set([...discoverDates.map(k=>Number(k.slice(0,4))),now.getFullYear()])].filter(Number.isFinite).sort((a,b)=>b-a);
 if(yearControl){const prior=r.arunAnalyticsYear||yearControl.value||String(now.getFullYear());yearControl.innerHTML=years.map(y=>`<option value="${y}">${y}</option>`).join('');yearControl.value=years.includes(Number(prior))?String(prior):String(now.getFullYear());}
 const monthLabel=$('analyticsMonthLabel'),yearLabel=$('analyticsYearLabel');
 if(monthLabel)monthLabel.hidden=period!=='monthly';if(monthControl)monthControl.hidden=period!=='monthly';
 if(yearLabel)yearLabel.hidden=period!=='yearly';if(yearControl)yearControl.hidden=period!=='yearly';
 let startDate=new Date(now.getFullYear(),now.getMonth(),now.getDate()),endDate=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 if(period==='weekly'){startDate.setDate(startDate.getDate()-6);}
 else if(period==='monthly'){const v=(monthControl&&monthControl.value)||currentMonth;const [y,m]=v.split('-').map(Number);startDate=new Date(y,m-1,1);endDate=new Date(y,m,0);if(endDate>now)endDate=new Date(now.getFullYear(),now.getMonth(),now.getDate());}
 else if(period==='yearly'){const y=Number(yearControl&&yearControl.value)||now.getFullYear();startDate=new Date(y,0,1);endDate=new Date(y,11,31);if(endDate>now)endDate=new Date(now.getFullYear(),now.getMonth(),now.getDate());}
 else if(period==='alltime'){startDate=new Date(`${earliestStored}T00:00:00`);endDate=new Date(now.getFullYear(),now.getMonth(),now.getDate());}
 const start=new Date(startDate.getFullYear(),startDate.getMonth(),startDate.getDate());
 const end=endDate.getFullYear()===now.getFullYear()&&endDate.getMonth()===now.getMonth()&&endDate.getDate()===now.getDate()?now:new Date(endDate.getFullYear(),endDate.getMonth(),endDate.getDate(),23,59,59,999);
 const dayKeys=[];for(let d=new Date(startDate);d<=endDate;d.setDate(d.getDate()+1))dayKeys.push(dayKey(d));if(!dayKeys.length)dayKeys.push(dayKey(startDate));
 const fullDate=k=>{const d=new Date(k+'T12:00:00');return Number.isNaN(d.getTime())?String(k):d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});};
 const rangeText=period==='daily'?`Today · ${fullDate(today)}`:period==='weekly'?`${fullDate(dayKeys[0])} – ${fullDate(dayKeys[dayKeys.length-1])}`:period==='monthly'?new Date(startDate.getFullYear(),startDate.getMonth(),1).toLocaleDateString(undefined,{month:'long',year:'numeric'}):period==='yearly'?String(startDate.getFullYear()):`All time · ${fullDate(dayKeys[0])} – ${fullDate(dayKeys[dayKeys.length-1])}`;
 let live=null;try{live=await chrome.runtime.sendMessage({type:'GET_LIVE_STATUS'});}catch{}
 const dayStats=(key,includeLive=false)=>{
   const entries={...(timeData[key]||{})};
   if(includeLive&&key===today&&live&&live.domain&&Number(live.elapsedSeconds)>0)entries[live.domain]=(Number(entries[live.domain])||0)+Number(live.elapsedSeconds);
   let studySec=0,wasteSec=0,siteCount=0;
   Object.entries(entries).forEach(([domain,raw])=>{const sec=Number(raw);if(!Number.isFinite(sec)||sec<=0)return;siteCount++;if((siteCategories[domain]||'waste')==='study')studySec+=sec;else wasteSec+=sec;});
   return {key,entries,studySec,wasteSec,siteCount};
 };
 const buckets=dayKeys.map(k=>dayStats(k,k===today));
 const aggregateMonths=items=>{const m=new Map();items.forEach(x=>{const key=x.key.slice(0,7);if(!m.has(key))m.set(key,{key,studySec:0,wasteSec:0,siteCount:0});const a=m.get(key);a.studySec+=x.studySec;a.wasteSec+=x.wasteSec;a.siteCount+=x.siteCount;});return [...m.values()];};
 // Daily/weekly/monthly views show dates; yearly and all-time use monthly buckets to avoid 365+ unreadable columns.
 const chartBuckets=(period==='alltime'||period==='yearly')?aggregateMonths(buckets):buckets;
 const studySec=buckets.reduce((n,x)=>n+x.studySec,0),wasteSec=buckets.reduce((n,x)=>n+x.wasteSec,0);
 const trackedSiteEntries=buckets.reduce((n,x)=>n+x.siteCount,0),uniqueSites=new Set(buckets.flatMap(x=>Object.entries(x.entries).filter(([,v])=>Number(v)>0).map(([site])=>site))).size;
 const manualUsage=allManualUsage.filter(x=>{const d=analyticsRecordDate(x);return d&&d>=start&&d<=end;});
 const pomoEvents=dayKeys.flatMap(k=>(Array.isArray(pomoHistory[k])?pomoHistory[k]:[]).map(event=>({date:k,...event})));
 const studyCycles=pomoEvents.filter(x=>x.phase==='study'),breakCycles=pomoEvents.filter(x=>x.phase==='break');
 const pomoSecs=dayKeys.reduce((n,k)=>n+Math.max(0,Number(pomoStudySeconds[k])||0),0);
 const tasksDone=tasks.filter(x=>x.done).length,upcoming=(Array.isArray(r.assignments)?r.assignments:[]).filter(x=>!x.done&&Number(x.due)>Date.now()).length;
 const trackedDays=buckets.filter(x=>x.siteCount>0).length;
 const fmtSecs=n=>{n=Math.max(0,Math.round(Number(n)||0));const h=Math.floor(n/3600),m=Math.floor(n%3600/60),sec=n%60;return h?`${h}h ${m}m`:m?`${m}m ${sec}s`:`${sec}s`;};
 const fmtMins=n=>{n=Math.max(0,Math.round(Number(n)||0));return n>=60?`${Math.floor(n/60)}h ${n%60}m`:`${n}m`;};
 const fmtCompact=n=>{n=Math.max(0,Math.round((Number(n)||0)/60));return n>=60?`${Math.floor(n/60)}h${String(n%60).padStart(2,'0')}`:`${n}m`;};
 const escA=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const monthKey=k=>/^\d{4}-\d{2}$/.test(k);
 const bucketLabel=k=>{
   if(monthKey(k)){const d=new Date(`${k}-01T12:00:00`);return `<span>${escA(d.toLocaleDateString(undefined,{month:'short'}))}</span><span>${d.getFullYear()}</span>`;}
   const d=new Date(`${k}T12:00:00`);if(Number.isNaN(d.getTime()))return `<span>${escA(k)}</span>`;
   return `<span>${escA(d.toLocaleDateString(undefined,{weekday:'short'}))}</span><span>${escA(d.toLocaleDateString(undefined,{day:'2-digit',month:'short'}))}</span>`;
 };
 const bucketTitle=x=>monthKey(x.key)?new Date(`${x.key}-01T12:00:00`).toLocaleDateString(undefined,{month:'long',year:'numeric'}):fullDate(x.key)+(x.key===today?' (Today)':'');
 const renderUsageChart=(items, emptyText)=>{
   if(!items.some(x=>x.siteCount>0))return `<div class="analytics-no-data">${escA(emptyText)}</div>`;
   const maxSec=Math.max(1,...items.map(x=>Math.max(x.studySec,x.wasteSec)));
   const itemWidth=items.length<=7?36:items.length<=12?34:36;
   const chartWidth=items.length*itemWidth+Math.max(0,items.length-1)*5;
   const columns=items.map(x=>{
     const has=x.siteCount>0;
     const studyH=has&&x.studySec>0?Math.max(2,x.studySec/maxSec*100):0;
     const wasteH=has&&x.wasteSec>0?Math.max(2,x.wasteSec/maxSec*100):0;
     const title=`${bucketTitle(x)} · Study time ${fmtSecs(x.studySec)} · Waste time ${fmtSecs(x.wasteSec)} · ${x.siteCount} recorded website entries`;
     return `<div class="analytics-bar-col" style="--bar-width:${itemWidth}px" title="${escA(title)}" aria-label="${escA(title)}">
       <div class="analytics-bar-pair ${has?'has-records':'no-records'}" aria-hidden="true">
         <span class="analytics-bar-study" style="height:${studyH}%"></span><span class="analytics-bar-waste" style="height:${wasteH}%"></span>
       </div>
       <div class="analytics-bar-date">${bucketLabel(x.key)}</div>
       <div class="analytics-bar-values"><span class="study-value">${has?fmtCompact(x.studySec):'—'}</span><span class="waste-value">${has?fmtCompact(x.wasteSec):'—'}</span></div>
     </div>`;
   }).join('');
   return `<div class="analytics-chart-legend"><span><i class="legend-study"></i>Study time</span><span><i class="legend-waste"></i>Waste time</span><small>Values: hours/minutes · hover a column for exact seconds and date</small></div><div class="analytics-chart-scroll" tabindex="0" role="region" aria-label="Scrollable study and waste chart"><div class="analytics-bars" style="min-width:${chartWidth}px">${columns}</div></div>`;
 };
 $('deepAnalyticsCards').innerHTML=[
   ['Website study time',trackedSiteEntries?fmtSecs(studySec):'No records'],['Website waste time',trackedSiteEntries?fmtSecs(wasteSec):'No records'],['Tracked websites',String(uniqueSites)],['Pomodoro study time',pomoSecs>0?fmtSecs(pomoSecs):(studyCycles.length?'Duration not recorded':'No records')],['Pomodoro study cycles',String(studyCycles.length)],['Current tasks done',tasks.length?`${tasksDone}/${tasks.length}`:'No tasks']
 ].map(x=>`<div class="deep-kpi"><small>${safeText(x[0])}</small><strong>${safeText(x[1])}</strong></div>`).join('');
 const comparisonNote=$('deepDayComparison')?.parentElement?.querySelector('.analytics-explain');
 if(comparisonNote)comparisonNote.textContent=(period==='yearly'||period==='alltime')?'Each column is one month; compare the saved website Study and Waste totals. Months without records are marked separately.':period==='monthly'?'Each column is a calendar day for the selected month. Scroll horizontally to inspect all dates; days without logs are not treated as zero activity.':period==='weekly'?'Each column is a weekday with its calendar date. Study and Waste have separate bars and values.':'Today’s recorded website Study and Waste totals; no browser history is scanned.';
 $('deepTrendTitle').textContent=period==='daily'?`${rangeText} · website tracking`:period==='monthly'?`${rangeText} · daily study / waste trend`:period==='yearly'?`${rangeText} · monthly study / waste trend`:period==='alltime'?'All-time monthly study / waste trend':'7-day study / waste trend';
 $('deepStudyTrend').innerHTML=renderUsageChart(chartBuckets,'No website-tracking records are saved for this period. Start tracking or choose another report range.');
 const manualProductive=manualUsage.filter(x=>x.kind==='productive'),manualDistraction=manualUsage.filter(x=>x.kind==='distraction');
 const manualProdMins=manualProductive.reduce((n,x)=>n+Math.max(0,Number(x.minutes)||0),0),manualDistrMins=manualDistraction.reduce((n,x)=>n+Math.max(0,Number(x.minutes)||0),0);
 $('analyticsCoverage').textContent=`${rangeText} · ${trackedSiteEntries} recorded site/day entries · ${uniqueSites} unique websites · ${studyCycles.length} completed study cycles`;
 const hp=habits.length?Math.round(habits.filter(h=>h.entries&&h.entries[today]!==undefined).length/habits.length*100):null,tp=tasks.length?Math.round(tasksDone/tasks.length*100):null;
 $('deepCompletion').innerHTML=`<div class="deep-bar-row"><span>Tasks</span><div><i style="width:${tp??0}%"></i></div><b>${tp===null?'N/A':tp+'%'}</b></div><div class="deep-bar-row"><span>Habits today</span><div><i style="width:${hp??0}%"></i></div><b>${hp===null?'N/A':hp+'%'}</b></div><div class="deep-bar-row"><span>Study cycles</span><div><i style="width:${studyCycles.length?Math.min(100,studyCycles.length/8*100):0}%"></i></div><b>${studyCycles.length}</b></div><p class="analytics-explain">Task completion uses current saved task states. Habit check-ins count only explicit entries for today; unmarked habits are not assumed to be failures. Cycle bar uses 8 completions as a visual reference, not a target.</p>`;
 $('deepFocus').innerHTML=[
   suiteItem('Website tracking · Study',fmtSecs(studySec)+' from popup timeData and siteCategories'),
   suiteItem('Website tracking · Waste',fmtSecs(wasteSec)+' from the same daily website records'),
   suiteItem('Pomodoro study time',pomoSecs>0?`${fmtSecs(pomoSecs)} of explicitly saved study seconds in this period`:studyCycles.length?'Study completions exist, but no elapsed study seconds are saved for this range':'No Pomodoro study seconds recorded for this range'),
   suiteItem('Pomodoro history',`${studyCycles.length} study completion(s) · ${breakCycles.length} break completion(s) in this period`),
   suiteItem('Separately logged activities',`${manualUsage.length} manual/focus log(s) · ${Math.round(manualProdMins)} productive min · ${Math.round(manualDistrMins)} distraction min`),
   suiteItem('Live tracking',live&&live.domain?`${safeText(live.domain)} · ${fmtSecs(live.elapsedSeconds)} since latest tracking tick`:'No active tracked domain response right now')
 ].join('');
 const subjectTotals={};dayKeys.forEach(k=>{const day=subjectTime[k]||{};Object.entries(day).forEach(([id,secs])=>{const n=Number(secs);if(Number.isFinite(n)&&n>0)subjectTotals[id]=(subjectTotals[id]||0)+n;});});
 const sub=Object.entries(subjectTotals).sort((a,b)=>b[1]-a[1]).slice(0,8);
 $('deepSubjects').innerHTML=sub.map(([id,secs])=>{const subject=subjects.find(x=>String(x.id)===String(id));return suiteItem(subject?.name||`Subject ID ${id}`,`${fmtSecs(secs)} recorded in subjectTime`);}).join('')||'<p class="nt-empty">No subject-linked time is stored for this period. Add subjects and use the popup’s subject tracking to populate this report.</p>';
 const peak=buckets.filter(x=>x.studySec>0).slice().sort((a,b)=>b.studySec-a.studySec)[0];
 $('deepPeak').innerHTML=peak?suiteItem(fullDate(peak.key),`${fmtSecs(peak.studySec)} classified website study time · highest recorded day in this report`):'<p class="nt-empty">No classified study time is stored for the selected period.</p>';
 const durationBar=(label,seconds,max,color='teal')=>`<div class="analytics-vbar-row"><div class="analytics-vbar-label"><span>${escA(label)}</span><b>${escA(fmtSecs(seconds))}</b></div><div class="analytics-vbar-track"><i class="${color}" style="width:${max>0?Math.max(0,Math.min(100,seconds/max*100)):0}%"></i></div></div>`;
 $('deepUsageBreakdown').innerHTML=(studySec+wasteSec)>0?durationBar('Study-classified website time',studySec,Math.max(studySec,wasteSec,1),'teal')+durationBar('Waste / distraction-classified time',wasteSec,Math.max(studySec,wasteSec,1),'amber')+`<div class="analytics-mini-stats"><span><b>${uniqueSites}</b> unique websites</span><span><b>${trackedSiteEntries}</b> site/day entries</span><span><b>${manualUsage.length}</b> separate manual logs</span></div>`:'<div class="analytics-no-data">No website time values are recorded in this period yet. This does not mean usage was zero outside the recorded days.</div>';
 $('deepUsageExplain').textContent=`Popup tracking totals are read from timeData and classified with siteCategories. Unclassified sites follow the extension's popup rule and count as waste. Separately logged manual activities are shown separately, not added to website time. ${manualUsage.length?`Manual logs in this period: ${manualProductive.length} productive (${Math.round(manualProdMins)} min) and ${manualDistraction.length} distraction (${Math.round(manualDistrMins)} min).`:'No separate manual activity logs match this period.'}`;
 const comparisonBuckets=chartBuckets,activeDays=comparisonBuckets.filter(x=>x.siteCount>0),bestDay=activeDays.filter(x=>x.studySec>0).slice().sort((a,b)=>b.studySec-a.studySec)[0],avg=activeDays.length?Math.round(activeDays.reduce((n,x)=>n+x.studySec,0)/activeDays.length):null;
 $('deepDayComparison').innerHTML=activeDays.length?`<div class="analytics-vbar-row"><div class="analytics-vbar-label"><span>Website study time total</span><b>${escA(fmtSecs(studySec))}</b></div></div>${renderUsageChart(comparisonBuckets,'No website-tracking records are saved for this report window.')}`:'<div class="analytics-no-data">No website records are saved in this report window. Other metrics remain separate where records exist.</div>';
 const unit=(period==='alltime'||period==='yearly')?'month(s)':period==='monthly'?'day(s)':period==='weekly'?'day(s)':'day';
 const bestLabel=bestDay?bucketTitle(bestDay):'';
 $('deepDayExplain').textContent=activeDays.length?`${activeDays.length} of ${comparisonBuckets.length} ${unit} contain recorded website entries. ${bestDay?`Highest study-classified bucket: ${bestLabel} (${fmtSecs(bestDay.studySec)}).`:'No study-classified website time is recorded in active buckets.'} Average study time across active buckets: ${fmtSecs(avg)}. Empty buckets are not treated as proof of inactivity. Selected range: ${rangeText}.`:'No comparison is possible until website-tracking data has been saved for this range.';
 const validLegacySessions=legacySessions.map(x=>({x,d:analyticsRecordDate(x),seconds:Number(x.duration)||Number(x.seconds)||0})).filter(y=>y.d&&y.d>=start&&y.d<=end&&Number.isFinite(y.seconds)&&y.seconds>0);
 const manualFocus=manualUsage.filter(x=>String(x.site||'').toLowerCase()==='focus session'&&Number(x.minutes)>0).map(x=>Number(x.minutes));
 const durations=[...validLegacySessions.map(x=>Math.round(x.seconds/60)),...manualFocus].filter(n=>n>0),bands=[['Under 15 min',n=>n<15],['15–29 min',n=>n>=15&&n<30],['30–59 min',n=>n>=30&&n<60],['60+ min',n=>n>=60]].map(([label,test])=>({label,count:durations.filter(test).length})),maxBand=Math.max(1,...bands.map(x=>x.count));
 $('deepSessionProfile').innerHTML=durations.length?bands.map(x=>`<div class="analytics-vbar-row"><div class="analytics-vbar-label"><span>${x.label}</span><b>${x.count} sessions</b></div><div class="analytics-vbar-track"><i class="blue" style="width:${x.count/maxBand*100}%"></i></div></div>`).join(''):'<div class="analytics-no-data">No saved focus-session durations are available for this period. Pomodoro history records its completed phase/time but not each session duration, so duration is not inferred.</div>';
 $('deepSessionExplain').textContent=durations.length?`${durations.length} saved timed record(s): ${validLegacySessions.length} legacy study session(s) and ${manualFocus.length} explicit focus timer log(s). Only stored positive duration values are classified.`:'Duration profile is unavailable; Pomodoro cycle counts remain available from pomoHistory without assuming a default length.';
 $('deepSubjectChart').innerHTML=sub.length?sub.slice(0,6).map(([id,secs])=>{const subject=subjects.find(x=>String(x.id)===String(id));return durationBar(subject?.name||`Subject ID ${id}`,secs,Math.max(1,...sub.map(x=>x[1])),'purple');}).join(''):'<div class="analytics-no-data">No subject-linked time in subjectTime for this period.</div>';
 $('deepSubjectExplain').textContent=sub.length?`${Object.keys(subjectTotals).length} subject IDs contain saved seconds. These are the extension's subjectTime records and are not added to website totals, because the sources may overlap.`:'Use the extension popup’s subjects and tracking links to create subjectTime records.';
 const allSiteDays=Object.keys(timeData).filter(k=>isValidDateKey(k,today)),allSiteDomainCount=new Set(Object.values(timeData).flatMap(d=>d&&typeof d==='object'?Object.entries(d).filter(([,v])=>Number(v)>0).map(([site])=>site):[])).size;
 const totalPomo=Object.values(pomoHistory).reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0),totalSubjectEntries=Object.values(subjectTime).reduce((n,d)=>n+(d&&typeof d==='object'?Object.values(d).filter(v=>Number(v)>0).length:0),0);
 const health=[['Website tracking days stored',allSiteDays.length],['Unique websites ever tracked',allSiteDomainCount],['Site/day entries in selected report',trackedSiteEntries],['Pomodoro events stored',totalPomo],['Pomodoro study seconds stored',Math.round(Object.values(pomoStudySeconds).reduce((n,v)=>n+Math.max(0,Number(v)||0),0))],['Subject-time entries stored',totalSubjectEntries],['Current task records',tasks.length],['Saved habits',habits.length],['Legacy studyHistory records',legacySessions.length],['Manual usage logs',allManualUsage.length]];
 $('deepHealth').innerHTML=health.map(([k,v])=>`<div class="analytics-audit-row"><span>${escA(k)}</span><b>${v}</b></div>`).join('')+`<p class="analytics-explain">Source of truth: popup timeData + siteCategories for website Study/Waste, pomoHistory for completed Pomodoro cycles, pomoStudySeconds for elapsed Pomodoro study time, subjectTime + subjects for subject-linked time, and shared tasks/habits/assignments keys for planner metrics. Blank or missing records stay unavailable; no browser history is scanned and no values are invented.</p>`;
 const rate=tasks.length?Math.round(tasksDone/tasks.length*100):null;
 const narratives=[];
 narratives.push(`<div class="analytics-narrative-item"><b>${studySec>0?`${fmtSecs(studySec)} study-classified website time`:trackedSiteEntries?'No study-classified website time recorded':'No website time records in this period'}</b><span>${trackedSiteEntries?`${trackedSiteEntries} stored site/day entries across ${uniqueSites} unique website(s). Study/Waste labels match the extension popup's classification.`:'The selected period has no matching saved timeData entries. Historical records outside this period are not included.'}</span></div>`);
 narratives.push(`<div class="analytics-narrative-item"><b>${wasteSec?`${fmtSecs(wasteSec)} waste / distraction time`:'No waste-classified time recorded'}</b><span>This is time assigned to the extension's Waste category, including websites with no explicit Study classification. It is not a judgement about what you were doing.</span></div>`);
 narratives.push(`<div class="analytics-narrative-item"><b>${studyCycles.length} Pomodoro study completion(s)</b><span>${breakCycles.length} break completion(s) saved for this period. The extension stores the completed phase and clock time; it does not store a reliable duration per historical event.</span></div>`);
 narratives.push(`<div class="analytics-narrative-item"><b>${rate===null?'Task completion N/A':`Task completion: ${rate}%`}</b><span>${tasks.length?`${tasksDone} completed out of ${tasks.length} currently saved tasks. This is the current task state, not a historical completion rate for the selected period.`:'No task records are saved under the extension tasks key.'}</span></div>`);
 narratives.push(`<div class="analytics-narrative-item"><b>${habits.length?`${habits.length} saved habits`:'Habit metrics unavailable'}</b><span>${habits.length?`${habits.filter(h=>h.entries&&h.entries[today]!==undefined).length} habit(s) have an explicit check-in today. Missing check-ins are not assumed to be failures.`:'No habit records are saved under the extension habits key.'}</span></div>`);
 $('deepNarrative').innerHTML=narratives.join('');

}
// Additional local analytics: hourly records are only available from the v4.5 update onward.
function formatInsightDuration(raw) {
  const n = Math.max(0, Math.round(Number(raw) || 0));
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m${s ? ` ${s}s` : ''}`;
  return `${s}s`;
}
function insightDateLabel(key, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const d = new Date(`${key}T12:00:00`);
  return Number.isNaN(d.getTime()) ? key : d.toLocaleDateString(undefined, opts);
}
function websiteDayTotals(timeData, siteCategories, key) {
  let study = 0, waste = 0, siteEntries = 0;
  const entries = timeData && timeData[key] && typeof timeData[key] === 'object' ? timeData[key] : {};
  for (const [domain, raw] of Object.entries(entries)) {
    const secs = Number(raw);
    if (!Number.isFinite(secs) || secs <= 0) continue;
    siteEntries++;
    if ((siteCategories[domain] || 'waste') === 'study') study += secs; else waste += secs;
  }
  return { study, waste, total: study + waste, siteEntries };
}
async function renderStudyInsights() {
  const el = $('bestStudyHours');
  const comparison = $('weekCompare');
  if (!el || !comparison) return;
  const r = await chrome.storage.local.get(['hourlyTimeData', 'timeData', 'siteCategories']);
  const hourly = r.hourlyTimeData && typeof r.hourlyTimeData === 'object' ? r.hourlyTimeData : {};
  const timeData = r.timeData && typeof r.timeData === 'object' ? r.timeData : {};
  const cats = r.siteCategories && typeof r.siteCategories === 'object' ? r.siteCategories : {};
  const today = new Date(); today.setHours(0,0,0,0);
  const from = new Date(today); from.setDate(from.getDate() - 29);
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, study: 0, waste: 0, days: 0 }));
  let hourlyRecords = 0;
  for (let d = new Date(from); d <= today; d.setDate(d.getDate() + 1)) {
    const key = dayKey(d), day = hourly[key];
    if (!day || typeof day !== 'object') continue;
    let any = false; const activeHours = new Set();
    for (const [hourRaw, sites] of Object.entries(day)) {
      const hr = Number(hourRaw); if (!Number.isInteger(hr) || hr < 0 || hr > 23 || !sites || typeof sites !== 'object') continue;
      for (const [domain, raw] of Object.entries(sites)) {
        const secs = Number(raw); if (!Number.isFinite(secs) || secs <= 0) continue;
        any = true; activeHours.add(hr);
        if ((cats[domain] || 'waste') === 'study') hours[hr].study += secs; else hours[hr].waste += secs;
      }
    }
    if (any) { hourlyRecords++; for (const hr of activeHours) hours[hr].days++; }
  }
  const ranked = hours.filter(x => x.study > 0).sort((a,b) => b.study - a.study).slice(0,6);
  if (!hourlyRecords || !ranked.length) {
    el.innerHTML = '<div class="analytics-no-data">Hourly detail starts recording with this update. Existing daily totals cannot reveal which hours you studied, so no past hour is estimated.</div>';
  } else {
    const max = Math.max(1, ...ranked.map(x => x.study + x.waste));
    const timeLabel = hr => `${String(hr).padStart(2,'0')}:00–${String((hr+1)%24).padStart(2,'0')}:00`;
    el.innerHTML = `<p class="insight-meta">Last 30 days · ${hourlyRecords} day(s) with hourly entries</p>` + ranked.map(x => `<div class="insight-hour-row"><div class="insight-hour-label"><b>${timeLabel(x.hour)}</b><span>Study ${formatInsightDuration(x.study)} · Waste ${formatInsightDuration(x.waste)} · ${x.days} active day(s)</span></div><div class="insight-dual-track"><i class="insight-study-fill" style="width:${x.study/max*100}%"></i><i class="insight-waste-fill" style="width:${x.waste/max*100}%"></i></div></div>`).join('');
  }

  const sums = (offsetDays) => {
    let study = 0, waste = 0, days = 0;
    const start = new Date(today); start.setDate(start.getDate() - offsetDays - 6);
    const end = new Date(today); end.setDate(end.getDate() - offsetDays);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const t = websiteDayTotals(timeData, cats, dayKey(d));
      study += t.study; waste += t.waste; if (t.total > 0) days++;
    }
    return { study, waste, days, start, end };
  };
  const curr = sums(0), prev = sums(7);
  const dateRange = x => `${insightDateLabel(dayKey(x.start))} – ${insightDateLabel(dayKey(x.end))}`;
  if (!curr.days && !prev.days) {
    comparison.innerHTML = '<div class="analytics-no-data">No saved website tracking in either seven-day window. The comparison will populate as real tracking records are stored.</div>';
  } else {
    const deltaLabel = (now, before) => {
      const delta = now - before, sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
      const pct = before > 0 ? ` (${delta > 0 ? '+' : ''}${Math.round(delta / before * 100)}%)` : (now > 0 ? ' (previous period had no recorded time)' : ' (no change recorded)');
      return `${sign}${formatInsightDuration(Math.abs(delta))}${pct}`;
    };
    const row = (label, now, before, cls) => `<div class="week-compare-row"><div><b>${label}</b><small>Last 7 days: ${formatInsightDuration(now)} · Previous 7 days: ${formatInsightDuration(before)}</small></div><strong class="${cls}">${deltaLabel(now,before)}</strong></div>`;
    comparison.innerHTML = `<p class="insight-meta">Current: ${dateRange(curr)} · Previous: ${dateRange(prev)} · Recorded days: ${curr.days}/7 vs ${prev.days}/7</p>${row('Study time',curr.study,prev.study,'study-value')}${row('Waste time',curr.waste,prev.waste,'waste-value')}`;
  }
}

let selectedMonthCalDay = null;
async function renderMonthlyCalendar() {
  const grid = $('monthCalGrid'), input = $('monthCalMonth');
  if (!grid || !input) return;
  const r = await chrome.storage.local.get(['timeData','siteCategories','arunMonthlyCalendarMonth']);
  const timeData = r.timeData && typeof r.timeData === 'object' ? r.timeData : {};
  const cats = r.siteCategories && typeof r.siteCategories === 'object' ? r.siteCategories : {};
  const now = new Date(); now.setHours(0,0,0,0);
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const storedMonth = /^\d{4}-\d{2}$/.test(r.arunMonthlyCalendarMonth || '') && r.arunMonthlyCalendarMonth <= currentMonth ? r.arunMonthlyCalendarMonth : currentMonth;
  input.max = currentMonth;
  if (!input.value || !/^\d{4}-\d{2}$/.test(input.value)) input.value = storedMonth;
  if (input.value > currentMonth) input.value = currentMonth;
  const [year, month] = input.value.split('-').map(Number);
  const first = new Date(year, month-1, 1), lastOfMonth = new Date(year, month, 0);
  const last = lastOfMonth > now ? now : lastOfMonth;
  const daysInShownMonth = last.getDate();
  const startOffset = first.getDay();
  const dayStats = [];
  let sumStudy=0, sumWaste=0, activeDays=0;
  for (let n=1; n<=daysInShownMonth; n++) {
    const d = new Date(year,month-1,n), key=dayKey(d), stats=websiteDayTotals(timeData,cats,key);
    dayStats.push({...stats,key,n}); sumStudy+=stats.study;sumWaste+=stats.waste;if(stats.total>0)activeDays++;
  }
  const allMax = Math.max(1,...dayStats.map(x=>x.total));
  const monthText = first.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  if ($('monthCalSummary')) $('monthCalSummary').textContent = `${monthText} · Study ${formatInsightDuration(sumStudy)} · Waste ${formatInsightDuration(sumWaste)} · ${activeDays} date(s) with recorded website time`;
  const blanks = Array.from({length:startOffset},()=>'<span class="month-cal-blank" aria-hidden="true"></span>').join('');
  grid.innerHTML = blanks + dayStats.map(d => {
    const has = d.total > 0, studyShare = has ? Math.round(d.study/d.total*100) : 0;
    const barLen = has ? Math.max(8,Math.round(d.total/allMax*100)) : 0;
    const title = `${insightDateLabel(d.key,{weekday:'long',month:'long',day:'numeric',year:'numeric'})} · Study ${formatInsightDuration(d.study)} · Waste ${formatInsightDuration(d.waste)}${has?` · Study share ${studyShare}% · Waste share ${100-studyShare}%`:' · No positive tracked time record'}`;
    return `<button type="button" class="month-cal-day ${has?'has-record':'no-record'} ${selectedMonthCalDay===d.key?'selected':''}" data-cal-date="${d.key}" title="${esc(title)}" aria-label="${esc(title)}"><span class="month-cal-day-number">${d.n}</span><span class="month-cal-day-total">${has?formatInsightDuration(d.total):'—'}</span><span class="month-cal-split" style="width:${barLen}%;background:linear-gradient(90deg,#42d7a7 0 ${studyShare}%,#e96b78 ${studyShare}% 100%)"></span></button>`;
  }).join('');
  const selectedIsThisMonth = selectedMonthCalDay && selectedMonthCalDay.slice(0,7)===input.value;
  if (!selectedIsThisMonth) selectedMonthCalDay = null;
  const detail = $('monthCalDetail');
  const showDay = (key) => {
    const d=dayStats.find(x=>x.key===key); if(!d||!detail)return;
    selectedMonthCalDay=key;
    grid.querySelectorAll('[data-cal-date]').forEach(btn=>btn.classList.toggle('selected',btn.dataset.calDate===key));
    if (!d.total) { detail.innerHTML=`<b>${esc(insightDateLabel(key,{weekday:'long',month:'long',day:'numeric',year:'numeric'}))}</b><span>No positive Study/Waste time was saved for this date. That is missing/zero tracked time, not proof that no study occurred.</span>`; return; }
    const sp=Math.round(d.study/d.total*100),wp=100-sp,ratio=d.waste>0?(d.study/d.waste).toFixed(2)+' : 1':'No Waste time recorded';
    detail.innerHTML=`<b>${esc(insightDateLabel(key,{weekday:'long',month:'long',day:'numeric',year:'numeric'}))}</b><span>Study: ${esc(formatInsightDuration(d.study))} (${sp}%) · Waste: ${esc(formatInsightDuration(d.waste))} (${wp}%) · Study/Waste ratio: ${esc(ratio)} · ${d.siteEntries} positive site record(s).</span>`;
  };
  grid.querySelectorAll('[data-cal-date]').forEach(btn=>btn.addEventListener('click',()=>showDay(btn.dataset.calDate)));
  if (selectedMonthCalDay && selectedMonthCalDay.slice(0,7)===input.value) showDay(selectedMonthCalDay);
  else if (detail) detail.textContent='Select a date to inspect its exact recorded Study/Waste times and ratio.';
  const prevButton=$('monthCalPrev'),nextButton=$('monthCalNext');
  if(prevButton)prevButton.disabled=input.value<='2000-01';
  if(nextButton)nextButton.disabled=input.value>=currentMonth;
}
$('monthCalMonth')?.addEventListener('change',async()=>{if($('monthCalMonth').value)await chrome.storage.local.set({arunMonthlyCalendarMonth:$('monthCalMonth').value});selectedMonthCalDay=null;await renderMonthlyCalendar();});
$('monthCalPrev')?.addEventListener('click',async()=>{const i=$('monthCalMonth');const [y,m]=i.value.split('-').map(Number);const d=new Date(y,m-2,1);i.value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;await chrome.storage.local.set({arunMonthlyCalendarMonth:i.value});selectedMonthCalDay=null;await renderMonthlyCalendar();});
$('monthCalNext')?.addEventListener('click',async()=>{const i=$('monthCalMonth');const [y,m]=i.value.split('-').map(Number);const d=new Date(y,m,1),now=new Date();if(d>new Date(now.getFullYear(),now.getMonth(),1))return;i.value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;await chrome.storage.local.set({arunMonthlyCalendarMonth:i.value});selectedMonthCalDay=null;await renderMonthlyCalendar();});

// User-managed background presets are stored separately from the active style and popup skin.
const WEB_STYLE_PRESETS_KEY='arunWebpageStylePresets';
async function loadWebStylePresets(selectValue='') {
  const select=$('webPresetSelect'); if(!select)return;
  const stored=(await chrome.storage.local.get(WEB_STYLE_PRESETS_KEY))[WEB_STYLE_PRESETS_KEY];
  const presets=Array.isArray(stored)?stored:[];
  select.innerHTML='<option value="">Choose saved preset…</option>'+presets.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
  if(selectValue && presets.some(x=>String(x.id)===String(selectValue))) select.value=String(selectValue);
  else select.value='';
}
async function applyWebStylePresetById(id) {
  const presets=(await chrome.storage.local.get(WEB_STYLE_PRESETS_KEY))[WEB_STYLE_PRESETS_KEY]||[];
  const preset=presets.find(x=>String(x.id)===String(id)); if(!preset)throw new Error('Choose a saved preset first.');
  const s={...WEB_STYLE_DEFAULTS,...preset.style};
  await chrome.storage.local.set({[WEB_STYLE_KEY]:s}); await loadWebpageStyle();
  if($('webPresetName'))$('webPresetName').value=preset.name;
  if($('webPresetStatus'))$('webPresetStatus').textContent=`Applied “${preset.name}”.`;
}
$('webPresetSave')?.addEventListener('click',async()=>{
  const name=$('webPresetName')?.value.trim(); if(!name){$('webPresetStatus').textContent='Enter a preset name first.';return;}
  try{
    const current=(await chrome.storage.local.get(WEB_STYLE_KEY))[WEB_STYLE_KEY]||WEB_STYLE_DEFAULTS;
    let presets=(await chrome.storage.local.get(WEB_STYLE_PRESETS_KEY))[WEB_STYLE_PRESETS_KEY];presets=Array.isArray(presets)?presets:[];
    const existing=presets.find(x=>x.name.toLowerCase()===name.toLowerCase());
    const preset={id:existing?existing.id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,name:name.slice(0,40),savedAt:Date.now(),style:{...WEB_STYLE_DEFAULTS,...current}};
    if(existing)presets=presets.map(x=>x.id===existing.id?preset:x);else if(presets.length<10)presets.push(preset);else{$('webPresetStatus').textContent='Maximum 10 presets reached. Delete one before adding another.';return;}
    await chrome.storage.local.set({[WEB_STYLE_PRESETS_KEY]:presets});await loadWebStylePresets(preset.id);$('webPresetStatus').textContent=`Saved “${preset.name}”. Presets include the current wallpaper and webpage style.`;
  }catch(err){$('webPresetStatus').textContent=err.message||'Could not save preset.';}
});
$('webPresetApply')?.addEventListener('click',async()=>{try{await applyWebStylePresetById($('webPresetSelect').value);}catch(err){$('webPresetStatus').textContent=err.message;}});
$('webPresetDelete')?.addEventListener('click',async()=>{
  const id=$('webPresetSelect')?.value;if(!id){$('webPresetStatus').textContent='Choose a saved preset to delete.';return;}
  const presets=(await chrome.storage.local.get(WEB_STYLE_PRESETS_KEY))[WEB_STYLE_PRESETS_KEY]||[];
  const removed=presets.find(x=>String(x.id)===String(id));await chrome.storage.local.set({[WEB_STYLE_PRESETS_KEY]:presets.filter(x=>String(x.id)!==String(id))});
  await loadWebStylePresets();$('webPresetStatus').textContent=removed?`Deleted “${removed.name}”. The active webpage style is unchanged.`:'Preset not found.';
});
loadWebStylePresets().catch(err=>console.warn('Could not load background presets',err));

// Save and schedule a user-defined daily desktop notification through the service worker.
async function loadCustomReminder() {
  const r=await chrome.storage.local.get('arunCustomReminder'),v=r.arunCustomReminder||{};
  if($('customReminderEnabled'))$('customReminderEnabled').checked=!!v.enabled;
  if($('customReminderTime'))$('customReminderTime').value=/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time||'')?v.time:'19:00';
  if($('customReminderMessage'))$('customReminderMessage').value=String(v.message||'Time for your planned study check-in.');
  if($('customReminderStatus'))$('customReminderStatus').textContent=v.enabled?`Daily reminder enabled for ${v.time}.`:'No daily reminder enabled.';
}
$('customReminderSave')?.addEventListener('click',async()=>{
  const reminder={enabled:$('customReminderEnabled').checked,time:$('customReminderTime').value||'19:00',message:$('customReminderMessage').value.trim().slice(0,220)||'Time for your planned study check-in.'};
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminder.time)){$('customReminderStatus').textContent='Choose a valid time.';return;}
  $('customReminderStatus').textContent='Saving reminder…';
  try{
    const response=await chrome.runtime.sendMessage({type:'SET_CUSTOM_REMINDER',reminder});
    if(!response||!response.ok)throw new Error(response?.error||'The reminder could not be scheduled.');
    $('customReminderStatus').textContent=reminder.enabled?`Daily reminder scheduled for ${reminder.time}. Allow Chrome notifications in system settings.`:'Daily reminder disabled.';
  }catch(err){$('customReminderStatus').textContent=`Could not schedule: ${err.message||err}`;}
});
loadCustomReminder().catch(err=>console.warn('Could not load custom reminder settings',err));

$('analyticsPeriod')?.addEventListener('change',async()=>{await chrome.storage.local.set({arunAnalyticsPeriod:$('analyticsPeriod').value});await renderDeepAnalytics();});
$('analyticsMonth')?.addEventListener('change',async()=>{await chrome.storage.local.set({arunAnalyticsMonth:$('analyticsMonth').value});if($('analyticsPeriod').value==='monthly')await renderDeepAnalytics();});
$('analyticsYear')?.addEventListener('change',async()=>{await chrome.storage.local.set({arunAnalyticsYear:$('analyticsYear').value});if($('analyticsPeriod').value==='yearly')await renderDeepAnalytics();});
$('deepRefresh').addEventListener('click',renderDeepAnalytics);
$('deepExportCsv').addEventListener('click',async()=>{
 const r=await chrome.storage.local.get(['timeData','siteCategories','subjectTime','subjects','pomoHistory','pomoStudySeconds','tasks','habits','assignments','arunUsageLog','studyHistory']);
 const rows=[['type','date','label','minutes','seconds','status_or_details']];
 const cats=r.siteCategories||{};
 Object.entries(r.timeData||{}).sort(([a],[b])=>a.localeCompare(b)).forEach(([date,sites])=>Object.entries(sites||{}).forEach(([site,seconds])=>{const n=Number(seconds)||0;rows.push(['website_time',date,site,Math.round(n/60),Math.round(n),(cats[site]||'waste')]);}));
 const subjectList=Array.isArray(r.subjects)?r.subjects:[];
 Object.entries(r.subjectTime||{}).forEach(([date,subjects])=>Object.entries(subjects||{}).forEach(([id,seconds])=>{const n=Number(seconds)||0;rows.push(['subject_time',date,subjectList.find(s=>String(s.id)===String(id))?.name||`Subject ID ${id}`,Math.round(n/60),Math.round(n),'subjectTime source; not added to website totals']);}));
 Object.entries(r.pomoHistory||{}).forEach(([date,events])=>(Array.isArray(events)?events:[]).forEach(event=>rows.push(['pomodoro',date,event.phase||'', '', '',event.time||'completion time only; duration not stored'])));
 Object.entries(r.pomoStudySeconds||{}).forEach(([date,seconds])=>{const n=Math.max(0,Number(seconds)||0);if(n>0)rows.push(['pomodoro_study_time',date,'Saved Pomodoro study seconds',Math.round(n/60),Math.round(n),'']);});
 (r.studyHistory||[]).forEach(x=>rows.push(['legacy_study_session',x.date||x.day||'',x.subject||x.course||x.topic||'',Math.round((Number(x.duration)||Number(x.seconds)||0)/60),Number(x.duration)||Number(x.seconds)||0,x.phase||'']));
 (r.arunUsageLog||[]).forEach(x=>{const d=analyticsRecordDate(x);rows.push(['manual_activity',d?d.toISOString():'',x.site||'',Number(x.minutes)||0,(Number(x.minutes)||0)*60,x.kind||'']);});
 (r.tasks||[]).forEach(x=>rows.push(['task','',x.text||'',0,0,x.done?'done':'pending']));
 (r.habits||[]).forEach(x=>Object.entries(x.entries||{}).forEach(([date,value])=>rows.push(['habit_checkin',date,x.name||'',0,0,String(value)])));
 (r.assignments||[]).forEach(x=>rows.push(['assignment',x.due?new Date(x.due).toISOString():'',x.name||'',0,0,x.done?'done':'pending']));
 const csv=rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`arun-pro-analytics-all-stored-data-${dayKey()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
});
const oldActivateFeature=activateFeature;activateFeature=function(name){oldActivateFeature(name);if(name==='suite')suiteRender();if(name==='analytics')renderDeepAnalytics();};
(async()=>{const r=await chrome.storage.local.get(['arunSuiteStyle','arunSuiteSound']);if(r.arunSuiteStyle){$('suiteAccent').value=r.arunSuiteStyle.accent||'#8da7ff';$('suiteMood').value=r.arunSuiteStyle.mood||'aurora';document.documentElement.style.setProperty('--accent',r.arunSuiteStyle.accent||'#8da7ff');document.body.dataset.mood=r.arunSuiteStyle.mood||'aurora';}if(r.arunSuiteSound)$('suiteSoundEnabled').checked=r.arunSuiteSound.enabled!==false;await suiteRender();})();

// Independent webpage-only customization; never overwrites popup or per-site skin settings.
const WEB_STYLE_KEY='arunWebpageStyle';
const WEB_STYLE_DEFAULTS={theme:'dark',density:'compact',accent:'#70d7c4',mood:'midnight',font:'system',fontSize:'13px',background:'#0b1220',cards:'soft',reduceMotion:false,wide:true,backgroundImage:'',backgroundFit:'cover',backgroundOpacity:35};
function webStyleSetControl(id,value){const e=$(id);if(!e||value===undefined)return;if(e.type==='checkbox')e.checked=!!value;else if(e.type!=='file')e.value=value;}
function updateWebBgPreview(data){const img=$('webBgPreview');if(!img)return;if(data){img.src=data;img.hidden=false;}else{img.removeAttribute('src');img.hidden=true;}const clear=$('webBgClearSetting');if(clear)clear.disabled=!data;}
async function loadWebpageStyle(){
 const stored=(await chrome.storage.local.get(WEB_STYLE_KEY))[WEB_STYLE_KEY]||{};const s={...WEB_STYLE_DEFAULTS,...stored};
 webStyleSetControl('webThemeSetting',s.theme);webStyleSetControl('webDensitySetting',s.density);webStyleSetControl('webAccentSetting',s.accent);webStyleSetControl('webMoodSetting',s.mood);webStyleSetControl('webFontSetting',s.font);webStyleSetControl('webFontSizeSetting',s.fontSize);webStyleSetControl('webBgSetting',s.background);webStyleSetControl('webCardSetting',s.cards);webStyleSetControl('webReduceMotionSetting',s.reduceMotion);webStyleSetControl('webWideSetting',s.wide);webStyleSetControl('webBgFitSetting',s.backgroundFit);webStyleSetControl('webBgOpacitySetting',s.backgroundOpacity);
 if($('webBgOpacityValue'))$('webBgOpacityValue').textContent=`${s.backgroundOpacity}%`;updateWebBgPreview(s.backgroundImage);applyWebpageStyle(s);
}
function hexRgb(hex){const h=String(hex||'#0b1220').replace('#','');const full=h.length===3?h.split('').map(x=>x+x).join(''):h;const n=parseInt(full,16);return Number.isFinite(n)?[(n>>16)&255,(n>>8)&255,n&255]:[11,18,32];}
function applyWebpageStyle(input){
 const s={...WEB_STYLE_DEFAULTS,...(input||{})},root=document.documentElement;root.setAttribute('data-theme',s.theme==='light'?'light':'dark');root.setAttribute('data-web-density',s.density||'compact');root.setAttribute('data-web-mood',s.mood||'midnight');root.setAttribute('data-web-cards',s.cards||'soft');root.setAttribute('data-web-reduce-motion',String(!!s.reduceMotion));root.setAttribute('data-web-bg-image',s.backgroundImage?'true':'false');
 root.style.setProperty('--accent',s.accent||'#70d7c4');root.style.setProperty('--web-bg',s.background||'#0b1220');document.body.style.fontFamily=s.font&&s.font!=='system'?s.font:'';document.body.style.fontSize=s.fontSize||'13px';
 const wrap=document.querySelector('.nt-wrap');if(wrap){wrap.style.maxWidth=s.wide===false?'1440px':'none';wrap.style.width='100%';}
 const rgb=hexRgb(s.background),overlay=Math.max(0,Math.min(0.9,1-(Number(s.backgroundOpacity)||35)/100));
 if(s.backgroundImage){
   const fit=s.backgroundFit==='contain'?'contain':s.backgroundFit==='repeat'?'auto':'cover';
   document.body.style.backgroundImage=`linear-gradient(rgba(${rgb.join(',')},${overlay}), rgba(${rgb.join(',')},${overlay})), url("${s.backgroundImage}"), radial-gradient(ellipse at 50% 0%,color-mix(in srgb,var(--accent) 9%,var(--bg)),var(--bg) 62%)`;
   document.body.style.backgroundSize=fit==='auto'?'auto,auto,cover':`${fit},${fit},cover`;
   document.body.style.backgroundRepeat=fit==='auto'?'repeat,repeat, no-repeat':'no-repeat,no-repeat,no-repeat';
   document.body.style.backgroundPosition='center,center,center top';document.body.style.backgroundAttachment='fixed,fixed,scroll';
 }else{document.body.style.backgroundImage='';document.body.style.backgroundSize='';document.body.style.backgroundRepeat='';document.body.style.backgroundPosition='';document.body.style.backgroundAttachment='';}
}
function readFileAsDataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('Could not read selected image.'));reader.readAsDataURL(blob);});}
async function shrinkWebBackground(file){
 if(!file||!file.type.startsWith('image/'))throw new Error('Choose a valid image file.');
 let bitmap;try{bitmap=await createImageBitmap(file);}catch{throw new Error('This image could not be opened. Try a JPG, PNG or WebP.');}
 const scale=Math.min(1,2400/bitmap.width,1600/bitmap.height),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image resizing is not supported in this browser.');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
 let blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.84));if(!blob||blob.size>2_400_000)blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.76));if(!blob||blob.size>2_800_000)throw new Error('Image is still too large after resizing. Choose a smaller image.');return await readFileAsDataUrl(blob);
}
$('webBgImageSetting')?.addEventListener('change',async()=>{
 const file=$('webBgImageSetting').files?.[0];if(!file)return;const status=$('webStyleStatus');if(status)status.textContent='Preparing background image locally…';
 try{const image=await shrinkWebBackground(file);const stored=(await chrome.storage.local.get(WEB_STYLE_KEY))[WEB_STYLE_KEY]||{};const s={...WEB_STYLE_DEFAULTS,...stored,backgroundImage:image};await chrome.storage.local.set({[WEB_STYLE_KEY]:s});updateWebBgPreview(image);applyWebpageStyle(s);if(status)status.textContent='Background image saved locally and applied. Click Apply to save any other changes.';}
 catch(err){if(status)status.textContent=err.message||'Could not apply background image.';}
 finally{$('webBgImageSetting').value='';}
});
$('webBgOpacitySetting')?.addEventListener('input',async()=>{const opacity=Number($('webBgOpacitySetting').value);if($('webBgOpacityValue'))$('webBgOpacityValue').textContent=`${opacity}%`;const r=await chrome.storage.local.get(WEB_STYLE_KEY);applyWebpageStyle({...WEB_STYLE_DEFAULTS,...(r[WEB_STYLE_KEY]||{}),backgroundOpacity:opacity});});
$('webBgClearSetting')?.addEventListener('click',async()=>{const stored=(await chrome.storage.local.get(WEB_STYLE_KEY))[WEB_STYLE_KEY]||{};const s={...WEB_STYLE_DEFAULTS,...stored,backgroundImage:''};await chrome.storage.local.set({[WEB_STYLE_KEY]:s});updateWebBgPreview('');applyWebpageStyle(s);if($('webStyleStatus'))$('webStyleStatus').textContent='Background image removed. Other webpage settings remain unchanged.';});
$('webStyleApply')?.addEventListener('click',async()=>{
 const prior=(await chrome.storage.local.get(WEB_STYLE_KEY))[WEB_STYLE_KEY]||{};const s={...WEB_STYLE_DEFAULTS,...prior,theme:$('webThemeSetting').value,density:$('webDensitySetting').value,accent:$('webAccentSetting').value,mood:$('webMoodSetting').value,font:$('webFontSetting').value,fontSize:$('webFontSizeSetting').value,background:$('webBgSetting').value,cards:$('webCardSetting').value,reduceMotion:$('webReduceMotionSetting').checked,wide:$('webWideSetting').checked,backgroundFit:$('webBgFitSetting').value,backgroundOpacity:Number($('webBgOpacitySetting').value)};
 await chrome.storage.local.set({[WEB_STYLE_KEY]:s});applyWebpageStyle(s);updateWebBgPreview(s.backgroundImage);$('webStyleStatus').textContent='Webpage settings applied and saved independently.';
});
$('webStyleReset')?.addEventListener('click',async()=>{await chrome.storage.local.set({[WEB_STYLE_KEY]:{...WEB_STYLE_DEFAULTS}});await loadWebpageStyle();$('webStyleStatus').textContent='Webpage style reset. Popup settings were not changed.';});
loadWebpageStyle();

// Keep homepage analytics aligned with the popup while records change in another extension view.
let analyticsRefreshTimer=null,analyticsLastRefreshAt=0,analyticsPendingChanges={};
chrome.storage.onChanged.addListener((changes,area)=>{
 if(area!=='local')return;
 const keys=['timeData','hourlyTimeData','siteCategories','pomoHistory','pomoStudySeconds','subjectTime','subjects','tasks','habits','assignments','arunUsageLog','studyHistory'];
 if(!keys.some(key=>changes[key]))return;
 Object.assign(analyticsPendingChanges,changes);
 if(changes.timeData||changes.siteCategories||changes.pomoStudySeconds||changes.habits)renderHeatmap().catch(err=>console.warn('ARUN PRO study heatmap refresh failed',err));
 if(analyticsRefreshTimer)return;
 const wait=Math.max(0,2500-(Date.now()-analyticsLastRefreshAt));
 analyticsRefreshTimer=setTimeout(()=>{
   analyticsRefreshTimer=null;analyticsLastRefreshAt=Date.now();const changed=analyticsPendingChanges;analyticsPendingChanges={};
   renderDeepAnalytics().catch(err=>console.warn('ARUN PRO analytics refresh failed',err));
   if(changed.hourlyTimeData||changed.timeData||changed.siteCategories)renderStudyInsights().catch(err=>console.warn('ARUN PRO insight refresh failed',err));
   if(changed.timeData||changed.siteCategories)renderMonthlyCalendar().catch(err=>console.warn('ARUN PRO month calendar refresh failed',err));
 },wait);
});
