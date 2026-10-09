ARUN PRO — v4.6 RELIABILITY + REQUESTED ANALYTICS FEATURES

FIXES / FEATURES IN v4.6
- Fixed task rendering: the New-tab preference initializer had been accidentally nested into the task list renderer; task add now saves, then renders through the normal list flow. A focused add → save → render test passed.
- Best Study Hours uses newly recorded per-hour website tracking. Historical daily totals are not guessed into hours.
- Added last-seven-days vs previous-seven-days Study/Waste comparison and a clickable month/year calendar with exact date totals.
- Study-vs-Waste heatmap compares the saved category split; Pomodoro heatmap remains a separate data source.
- Added save/apply/delete webpage background presets and a configurable daily notification via Chrome alarms.
- Tracking intervals that cross midnight are split into local-date/hour buckets. Active tracking recovery marker is refreshed as tracking proceeds.
- Backup/export now includes hourly tracking, webpage presets, reminder preferences, and heatmap/calendar selections. Reminder time validation and monthly calendar navigation were corrected.
- Validation: JavaScript syntax, manifest permissions/resources, unique static HTML IDs, task add/render smoke test, and midnight-split tracking test passed. Live Chrome UI/notification presentation still requires checking in the installed browser.

ARUN PRO IITM — People & Interaction Diary v4.4

Change in v4.4: the People & Interaction Journal is now placed at the top of the unlocked diary, before the free-writing diary editor, so it is much easier to find. Each interaction remains stored in the existing separate local storage key. Existing diary entries and records are not cleared or renamed.

ARUN PRO — Advanced Safe Update 3.59 + Study Workspace 4.2

INSTALL / MANIFEST FIX
1. Extract this ZIP first.
2. Open chrome://extensions and enable Developer mode.
3. Click Load unpacked and select the extracted folder that directly contains manifest.json. Do not select the ZIP or a parent folder.
4. Before switching from the old extension, export a backup. Keep the old extension until the new one is verified.

FEATURES ADDED (AI Study Planner intentionally omitted per request)
- Exam countdown and syllabus topic checklist
- Knowledge Vault for notes, links, code snippets and ideas; edit/delete; export; quick-capture active page title and URL
- Flashcards with answer reveal, known/revise status and deck labels
- Focus session timer and manual productive/distraction activity log (local-only)
- Study-vs-Waste calendar heatmap with recent 52 weeks, selected month/year and all-time views; relative-share colours, exact-date tooltips and separate habit current/best streaks
- Daily review with task/habit/study summary and saved reflection
- Customizable compact layout, analytics visibility and focus completion notifications
- Global search across tasks, vault, flashcards and exams
- Data Safety Center: full backup, safe merge picker, storage health check, recently deleted export and restore for exams/vault/flashcards
- Existing private diary and theme controls retained

DATA SAFETY
New tools store their data under separate arun* storage keys. Existing tasks/habits/notes are not intentionally rewritten by the new feature initialization. Backup import keeps current values and only fills missing supported storage keys; it does not merge individual records within an existing same-named array. Export a backup before migration.

PRIVACY / LIMITATIONS
- All new feature data is stored locally with chrome.storage.local; no cloud sync or upload is added.
- Website usage reads locally tracked extension timeData/siteCategories; user-entered activity logs remain separate. Browser history is not scanned or uploaded.
- Diary password is a convenience UI lock, not cryptographic encryption; do not store highly sensitive information.
- The extension manifest is at the ZIP root. If Chrome still reports missing/unreadable manifest, extract the ZIP and select the folder containing manifest.json directly.
- JavaScript syntax and manifest JSON were checked. Full Chrome browser/UI and migration testing has not been performed in this environment.


ULTIMATE WORKSPACE UPDATE 4.0
- Added Pro Suite workspace: daily planner/timetable, goals, expense tracker, reminders, quiz question bank, read-it-later, code snippets, calculator, sound preview, style customization, inspiration quotes, XP rewards.
- Added Deep Analytics: seven-day study trend, task/habit completion, productive/distraction logs, subject breakdown when labels exist, peak start-hour when timestamps exist, data-health overview and CSV export.
- New modules store data under separate arunSuite* keys and do not intentionally overwrite legacy keys.
- Audio preview uses Web Audio API from a user click; Chrome background timer audio reliability may still depend on the existing offscreen/background implementation and browser lifecycle.
- Reminder entries are stored and displayed; OS notifications require a separate permission/scheduling test and are not claimed as verified in this package.
- Calculator only accepts arithmetic characters; use only trusted input.
- Diary remains a convenience lock in the original app, not cryptographic encryption. Export a full backup before updating.
- Validation performed: manifest JSON parse, ZIP integrity, JS syntax checks. Full Chrome UI/runtime testing still needs to be done in Chrome.


STUDY-FIRST BLOCK REDIRECT PATCH
- Blocked-site attempts now open the existing ARUN PRO new-tab dashboard with Deep Analytics selected, rather than the old SITE BLOCKED / Matrix Rain screen.
- The dashboard shows a dismissible, responsive notice naming the blocked domain and preserving the current block rules.
- Existing storage keys and user records are not cleared or migrated by this change. The normal new-tab off preference still applies to ordinary new tabs; blocked-site redirects are allowed through to the dashboard so they do not bounce back to a distraction site.
- The old blocked.html / blocked.js assets remain in the package for compatibility, but the background redirect no longer navigates to them.

PEOPLE & INTERACTION JOURNAL UPDATE
- Added a private, date-based people/conversation log inside the unlocked Diary.
- Per interaction fields: person name/nickname, date, context/place, who approached, what they wanted, what you wanted, discussion topics, observations, outcome/follow-up.
- Keeps multiple meeting records per person so history across dates/topics can be reviewed; includes search, edit, delete, topic frequency and monthly/unique-person analytics, plus JSON export.
- Stores records separately under `arunDiaryPeople`; does not rewrite existing `diaryEntries`, tasks, habits, or other legacy records.
- Data stays local in chrome.storage.local. Diary lock is only a convenience UI lock, not encryption.


FINAL ANALYTICS / HEATMAP POLISH
- Heatmap views: recent 52 weeks, a selected month, a selected year, or all available recorded dates. Calendar cells align to Sunday–Saturday; month labels and horizontal scrolling support long history ranges.
- Website heatmap colours describe each date's Study/Waste share (80%+ Study, 60–79% Study, balanced 40–59%, 60–79% Waste, or 80%+ Waste); exact durations, percentages, ratio and positive site-entry count are available from day tooltips. No fixed 60-minute threshold drives the website heatmap.
- Pomodoro heatmap is kept as a separate source and colours are relative to other saved positive Pomodoro days in the selected range. Pomodoro values are never added to website Study time, since tracking sources can overlap.
- Heatmap source and range selections persist in separate arunStudyHeatmap* keys. Deep Analytics daily/weekly/monthly/yearly/all-time selections persist separately. Existing saved records are read only for reporting; empty days remain unrecorded rather than being invented.
- Real calendar-date validation excludes malformed/future date keys from historical range discovery and habit streak counts. Habit streaks count only explicit positive check-ins.
- Safe backup merge fills only supported keys that do not already exist in storage; unsupported incoming keys are not blindly written. Export a backup before migration.
- Validation performed: JavaScript syntax, manifest JSON, ZIP integrity, HTML identifier/label checks, CSS structural checks and isolated heatmap range/data-rendering tests. Live Chrome UI rendering and migration testing still need to be performed in Chrome.
