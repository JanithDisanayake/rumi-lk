# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.0] - 2026-10-02

**A register the school can file.** After every mark, Rumi sends back the month's attendance register — one
row per person, one column per day, weekends greyed, running totals, and approved **Leave** as its own status —
regenerated whole, so the newest file always holds the whole month. A teacher's "attendance" is their class; a
head teacher's is the school's staff. A past day can be named and corrected, and the correction rebuilds the
month. Plus **teacher nudges**: one friendly check-in for a teacher who has gone quiet, never twice for the
same silence.

### Added

- **Leave on every marking surface** — the native WhatsApp Flow gains an *On leave* checkbox group
  (re-publish `docs/flows/attendance-marking-flow.json`); the text stand-in (Baileys, Matrix) takes one reply,
  `2, 5 leave 3`; the Slack and Discord tap-to-mark modals gain a leave picker; voice roll call records
  "on leave" as leave. Someone named in both lists counts once, as leave.
- **Staff attendance and the staff register** — a head teacher (`users.role = 'head_teacher'`; `principal`
  and `school_leader` are read as the same role, never written) marks the school's staff by voice, by tapping, or "everyone present", and
  gets the month's staff register back. Staff are everyone linked to the school except the person marking;
  colleagues who never use the bot can be added by name. "class attendance" still reaches a class they teach.
- **`bot/scripts/attendance/link-school.js`** — links a school (optional external id: `--ext-id`, stored as `schools.ext_id`), its head
  teacher and its staff, naming people by `users.id`, WhatsApp number or channel identity. Idempotent.
- **Two rates, one per register** — staff: present ÷ (present + absent), approved leave excused; class:
  present ÷ every marked day, because a child on leave was not in the room.
- **Name a day** — `attendance yesterday`, `attendance 30 sep`, `attendance 2026-09-30` mark or correct that
  day; future days and days older than `ATTENDANCE_MAX_BACKDATE_DAYS` (default 62) are refused in words.
- **Teacher nudges** — `bot/shared/services/nudges/`: one `teacher_nudges` table, a sweeper with a registry
  of nudge kinds, an idempotent booking and a single-flight claim (two replicas never send twice), a kill
  switch (`TEACHER_NUDGES_ENABLED`, also `RUMI_FEATURE_TEACHER_NUDGES=off`), a per-tick cap, quiet hours and
  a timezone. One kind ships: `re_engage`, a check-in for a teacher silent for `TEACHER_NUDGES_QUIET_MINUTES`,
  once per quiet spell; on the Meta WhatsApp Cloud driver only inside the 24-hour window. The SQS worker
  sweeps every `TEACHER_NUDGES_SWEEP_MINUTES`, or run `bot/workers/teacher-nudges.worker.js` from cron.
- `docs/features/attendance.md` (rewritten), `docs/features/teacher-nudges.md`, `ATTENDANCE_*` and
  `TEACHER_NUDGES_*` blocks in `.env.template`, a `teacher_nudges` entry in `FEATURES`, SETUP.md steps.

### Changed

- **Re-marking a day replaces it** instead of stopping at "Attendance Already Recorded", and the whole month's
  register is regenerated, so the corrected file still holds every other day. The new records are written
  before the old ones are removed (and taken back out if that fails), so a correction that fails leaves the
  day on file; only the teacher whose
  class it is can mark or replace its days.
- A number after "class", "grade" or "section" is never read as a day ("attendance grade 5/6"), a month must
  be a whole word, every date in the message is considered, and a bare `d/m` outside the correction window
  opens today. The method menu always names the day being marked, today included.
- `TEACHER_NUDGES_TZ` left blank uses `ATTENDANCE_TZ`. The feature list shows teacher nudges as available only
  when `TEACHER_NUDGES_ENABLED` is on (a FEATURES entry may now name `flags`, switches that must read on).
- "Everyone present" is a numbered option (`3`) and is recorded as `everyone_present`.
- The academic year's start month is `ATTENDANCE_ACADEMIC_YEAR_START_MONTH` (default 4, the previous
  behaviour). "Today" is the school's today, in `ATTENDANCE_TZ` (default UTC).
- The text handler's attendance blocks moved to `attendance-entry.service.js` (one place a result becomes
  messages).

### Fixed

- A child on approved leave was written into the register as **A**; voice roll call filed "on leave" as absent.
- The register placed a day one column early west of UTC, and the month query dropped the month's last day
  east of UTC.
- Without R2 (or with R2 down) the register was generated and never sent; a refused send was reported as
  delivered; the file was lost to `ENOENT` where the temp folder did not exist yet.
- The sixth attendance start in five minutes got no reply at all.
- Where the marking form could not be sent, the fallback offered "1" and "3", which the session then did not
  accept.
- The Meta Flow's data endpoint read `getStudentListById`'s `{ data }` as the row.

### Database

- Migration `V2.5.0__attendance_register.sql` (additive): `schools` (the shared definition: `id`, `ext_id`,
  `name`, `district`, timestamps — the same DDL as the coach-observation migration, whichever runs first), `users.school_id`, `users.role`,
  `teacher_attendance_records`, `attendance_sessions.leave_count`. **Where the legacy CHECK on
  `attendance_records.status` exists, it is widened to accept `leave`** (every existing row stays valid);
  legacy `excused` records are read as Leave and their sessions' `leave_count` is back-filled.
- Migration `V2.5.1__teacher_nudges.sql` (additive): `teacher_nudges`, `users(last_message_at)` index,
  `user_channels.reply_identifier` (the exact identifier a teacher last wrote from, so a proactive send
  delivers back to it).

## [2.4.0] - 2026-10-02

**Make a test from the book.** A teacher picks a chapter — or a whole unit — from material the deployment
already has (a textbook loaded from the curriculum pipeline, the teacher's own lesson plans, or a chapter
they upload) and gets a printable test paper with a separate answer key in the chat, in about a minute. It
works in any language the model writes, right-to-left papers included; every edit makes a new version, and
"my papers" re-sends any of them. A paper is only ever built from real material: with nothing to build it
from, the teacher is told so instead of getting an invented one.

### Added

- **`/testpaper`** (alias **`/paper`**, optionally with a subject and grade: `/testpaper science 8`) and **`/mypapers`** —
  source → chapter(s) (one, several, a range or all) → size (quick 10 / standard 20 / full 30, or a typed mix
  such as "5 MCQs, 3 true/false, 2 short") → paper language → paper + answer key PDFs → Edit / New paper / My
  papers. Every pick is an interactive list or reply buttons through the messaging facade: native on
  WhatsApp, a numbered menu on Baileys, Matrix, Slack and Discord. No WhatsApp Flow needed. Past six loaded
  books, a "Textbooks (N)" row opens a numbered list of every book.
- **`bot/shared/services/testpaper/`** — the conversation, sources, store, session, generation (one model call
  with a neutral prompt pack; marks budget, MCQ answers and image keys made true after the call), the
  question-type catalogue by subject family, the paper/answer-key renderer (right to left in Nastaliq or Naskh
  for Perso-Arabic-script languages), and delivery through the repo's html-to-pdf. Ported from a fork's
  assessment generator, generalised: no country-bound catalogue, prompts or subject packs.
- **`bot/workers/testpaper.worker.js`** — the `testpaper_generate` and `testpaper_revise` jobs.
- **`bot/scripts/testpaper/import-curriculum-corpus.js`** — loads the curriculum pipeline's page-truth output
  into `textbooks` / `textbook_toc` / `textbook_pages` (idempotent, `--dry-run`; books of different
  `--curriculum` keys are kept apart).
- **`bot/shared/config/model-registry.js`** — a slim per-job model registry (`resolveModelForJob`); test papers
  default to `google/gemini-2.5-pro` via OpenRouter, override with `TESTPAPER_MODEL`.
- **Schema:** `test_paper_requests` and `test_papers` (versions via `edited_from`), RLS, and migration
  `V2.4.0__test_papers.sql` (additive).
- `docs/features/test-papers.md`, README and feature-library rows, a SETUP section, a `.env.template` block
  (`TESTPAPER_MODEL`, `TESTPAPER_CURRICULUM`, `RUMI_FEATURE_TEST_PAPER`), and a `test_paper` entry in
  `FEATURES` (on with the LLM key; `RUMI_FEATURE_TEST_PAPER=off` switches every entry point off, including
  buttons from earlier papers and jobs already queued).
- Lesson plans made by Rumi are read through the shared `content.plan_text` reader
  (`bot/shared/services/coaching/fidelity/lesson-plan-text.js`, from the lesson-plan fidelity release).

### Changed

- **The bot's Meta webhook acknowledges a handled test-paper pick** before returning, so Meta does not
  re-send it.
- **The SQS worker loads the operator's `RUMI_FEATURE_*` switches at startup**, as the bot does, so a job for
  a feature switched off after it was queued is not run (test papers check this).

## [2.3.0] - 2026-10-02

**Did the lesson follow the plan?** A teacher sends a lesson recording and links the plan they meant to teach — one
Rumi made for them, a document, or pasted text. Rumi turns the plan into about a dozen observable moves, checks each
one against the timestamped recording, and the coaching report shows, move by move, what happened, with the moment
in the recording as proof. A different activity that serves the same purpose gets full credit; a recording Rumi
cannot judge is "not assessed", never 0%. Off by default (`LP_FIDELITY_ENABLED=true`).

### Added

- **The fidelity engine** (`bot/shared/services/coaching/fidelity/`): a plan → moves extractor, a per-move grader
  (`executed`, `substituted_equivalent`, `substituted_better`, `partial`, `not_done`, `not_adjudicable`, each asked
  to quote a `[MM:SS]` line), and a deterministic scorer (credit ÷ moves counted, band ≥80 / 50-79 / <50, configurable).
  Results are stored as `coaching_sessions.analysis_data.lp_fidelity`, framework-neutral, with an optional
  `applyLpFidelity` framework hook (FICO maps it onto indicator 1.2). Default grader `google/gemini-3.8-flash` via
  OpenRouter (`LP_FIDELITY_MODEL`, `LP_FIDELITY_EXTRACT_MODEL`, caps `LP_FIDELITY_MAX_TOKENS` / `LP_FIDELITY_EXTRACT_MAX_TOKENS`).
  A credited verdict that quotes no moment is flagged (`unquoted_credit`) and shown as such in the report.
- **The timestamp input contract:** a transcript without `[MM:SS]` timings is "not assessed" in code before any model
  call. Every outcome has its own words for the teacher — measured, a different lesson, no timings, an unclear
  recording, no plan, an unreadable plan, a failed check.
- **In the report:** a "Did the lesson follow the plan?" block in the coaching PDF with a per-move table (planned
  move · what the recording shows · verdict); one chat line after the report; the voice note speaks the band in
  words, never a percentage.
- **Plans Rumi made keep their text** (`content.plan_text` on `lesson_plans`), so a teacher can pick one from a short
  list after sending a recording (`LP_FIDELITY_LIST_LIMIT`), and its move list is extracted once and kept on the plan
  (`content.fidelity_moves`) so every lesson taught from it is graded against the same moves. Plans can also be
  uploaded or pasted as a message.
- **Diarization health:** every classroom transcription records whether it came back with speaker timings;
  `rumi doctor` shows the 7-day rate under the feature and flags it below 80%.
- `bot/scripts/fidelity-calibration.js` and a fictional fixture set (`tests/fixtures/fidelity/`) to re-check the
  calibration after any prompt or model change; `docs/features/lesson-plan-fidelity.md`; an `LP_FIDELITY_*` block in
  `.env.template`; a `Lesson-plan fidelity` row in `rumi doctor` and the console (switch: `RUMI_FEATURE_LP_FIDELITY`).
- `COACHING_MIN_AUDIO_SECONDS` (default 900): how long audio must be to start classroom coaching.

- **Operator console** (#97, on `main` since 2.2.0, recorded here) — `rumi start` opens a web page that shows what
  is connected and switched on, each pipeline layer, feature switches that pause a feature without deleting its key
  (`RUMI_FEATURE_<ID>`), and a live activity feed. `rumi console` serves it when the bot won't start. See
  `docs/console.md`.
- **Opt-in usage stats** (#95, on `main` since 2.2.0, recorded here) — `rumi setup` asks once. With
  `RUMI_TELEMETRY=on` and both keys present, a deployment shares anonymous counts; with it off or blank, nothing is sent.

### Fixed

- The classroom-photo question's buttons (Yes / No / Add another / Done) had no handler, so a recording stalled after
  transcription; "No" and "Done" now move to the lesson-plan step, which was never asked before.
- Classroom coaching on Matrix, Slack and Discord: those channels report no audio duration, so a lesson recording was
  always read as 0 seconds and never started coaching. The recording is now measured.
- Classroom coaching without object storage: the transcription job failed building an S3 client; without R2 the
  audio is no longer archived and the voice note is sent from memory.
- The lesson-plan extraction worker stored only a 500-character excerpt of an uploaded plan; it now stores the full
  text.

## [2.2.0] - 2026-09-04

**The Morning Brief.** Every morning, your team wakes up to one thread that says how the programme is
doing — who is on the platform and who actually used it, are teachers teaching with the lesson plans, is
the teaching improving, are the coaches showing up against their target, where should attention go next —
with a number behind every question and the same charts every day so drift is visible at a glance. On
Fridays the same thread rolls the week up.

### Added

- **`brief/`** — the Python package: a code-level calendar (a morning brief covers the previous working
  day; Monday's is about Friday), live-schema detection (panels switch themselves on from
  `information_schema`, so a fork that records classroom observations gets that panel for free), the
  metric definitions as tagged SQL with their prose twin in `brief/README.md`, matplotlib panels that follow
  one binding grammar (a delta chip on every headline, one organising unit breaking down every panel, every
  school listed worst-first, PCHIP-smoothed lines with the real points marked), plain-language captions, and
  a `manifest.json` contract. `python3 brief/cli.py check` says what your database can draw;
  `python3 brief/cli.py sample` renders a synthetic brief with no database at all.
- **Delivery through the bot's own channel drivers** — `bot/scripts/brief/send-brief.js` posts the cover,
  the panels and the closer to every target in `BRIEF_RECIPIENTS`, idempotently. New team targets in the
  drivers: `slack:channel:C…`, `discord:channel:…`, and `…@g.us` WhatsApp groups.
- **`rumi brief`** (`--send`, `--weekly`, `--dry-run`) and **`bot/workers/brief.worker.js`**, a one-shot
  for any daily cron that decides daily / weekly / off-day itself in `BRIEF_TZ`.
- **A live page** in the dashboard — `/observability/brief` (latest daily and weekly) and
  `/observability/brief/screen?p=N`, a self-refreshing single panel for an office wall
  (`BRIEF_SCREEN_TOKEN` lets a display in without a login).
- The `morning-brief` agent skill, `docs/features/morning-brief.md`, a `BRIEF_*` block in `.env.template`,
  a `Morning Brief` row in `rumi status`, and a CI job that runs the Python suites.

## [2.1.0] - 2026-08-30

**The curriculum builder and its knowledge graph** — `curriculum/`: textbooks in, a faithful, gate-checked
lesson-plan corpus out (page-truth → segment → enrich → slide-script → render → voicenote → deliver), with an
SLO registry so every lesson carries a validated learning-outcome code, and `curriculum/graph/`, which turns
the corpus into a knowledge graph (lessons ↔ outcomes, outcomes ordered per strand) with a self-contained
viewer. A 105-second walkthrough film is attached to the release.

## [2.0.0] - 2026-08-07

**Rumi no longer requires a Meta WhatsApp Business account to run.** The messaging
channel is now pluggable: the default links your own WhatsApp by QR the way
WhatsApp Web does, so a clone goes from `git clone` to a working conversation in
about fifteen minutes with no Business account, no app review and no waiting.
When you're ready for a real deployment, `rumi graduate` moves you to an official
number and every teacher, conversation and past assessment carries over.

Alongside it, setup stopped being an eleven-step document and became two
commands.

### BREAKING (vs v1.2.0)

- **Node 20 is now the minimum** (was 18). The Baileys sandbox driver refuses to
  install on 18 — its own preinstall check reports "This package requires
  Node.js 20+ to run reliably" — so `npm ci` in `bot/` fails outright rather
  than degrading. Node 18 has also been end-of-life since April 2025. `engines`
  is set on both packages, `install.sh` checks for 20, and the CI matrix is now
  20 and 22.
- **`npm run setup` now launches the interactive setup wizard.** It previously
  ran the preflight (`doctor.js`). If you had it in a script or a deploy step,
  switch to **`npm run doctor`** (or `rumi doctor`) — same output, unchanged.
- **`.env` is read from the repo root, not the process working directory.**
  `bot/whatsapp-bot.js`, `bin/rumi.js` and `bot/scripts/setup/doctor.js` now
  resolve it relative to the repository. If you kept a `bot/.env`, move it to the
  repo root. Railway is unaffected — its Procfile already runs from the root.
  This fixed a real failure: `cd bot && npm start` loaded **zero** variables and
  aborted with "Missing REQUIRED env var(s)" on a fully configured deployment.
- **`REQUIRED_VARS` is now core-only** (`SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `REDIS_URL`); the channel's
  own variables come from `CHANNEL_REQUIRED_VARS[CHANNEL_DRIVER]`. **Existing Meta
  deployments need no change** — with `CHANNEL_DRIVER` unset and the four Meta
  variables present, the driver is inferred as `meta`.
- **`CHANNEL_STATE_DIR` (default `.channel-state`) resolves against the repo**,
  not the working directory. Only affects the new sandbox driver, but it is the
  reason a bot started from `bot/` registered a *second* WhatsApp device and
  re-synced endlessly until WhatsApp invalidated the first.

### Added

- **A two-layer CLI.** `./install.sh` does the mechanical bootstrap (tool check,
  dependencies, `.env`, puts `rumi` on your PATH) and offers to run the wizard;
  `rumi` does everything else: `setup`, `start`, `status`, `doctor`, `pair`,
  `graduate`.
- **`rumi setup` — a five-step guided wizard.** Asks in plain language rather
  than by variable name ("where should Rumi keep its memory", not
  `SUPABASE_URL`), checks every value against the real service as you type it
  using the same probes `rumi doctor` runs, writes each answer to `.env`
  immediately (so Ctrl+C costs nothing), and skips anything already working on a
  re-run. Creates the full database — 76 tables, RLS policies and seed data —
  inline.
- **Pluggable messaging channels** via `CHANNEL_DRIVER`. A registry
  (`bot/shared/services/messaging/channel-registry.js`) with an explicit
  production-tier allowlist; `whatsapp.service.js` is now a one-line facade over
  it, so all ~40 existing call sites are untouched. Adding a channel later is a
  new registry key plus a service file.
- **The Baileys sandbox driver** — QR pairing, text, reactions, typing
  indicators, images, audio, documents, video and stickers, plus an inbound
  adapter that normalizes a socket event into the same shape Meta's webhook
  produces, so the existing dispatch runs unchanged.
- **WhatsApp Flows, rendered as a conversation.** A Flow is only a renderer; the
  endpoint holds the logic. The new text-flow engine drives those *same*
  endpoints over chat, so `/settings`, `/video`, reading assessment and class
  setup work on a channel that has no Flows — with the field names pinned by
  tests against their real consumers.
- **`rumi graduate`** — collects the target channel's credentials, validates them
  against the live service *before* touching `.env`, retires (never deletes) the
  outgoing session, and prints the checklist for what only you can do in Meta's
  console.
- **`rumi status`** — is Rumi running, which WhatsApp number it answers as, and
  what's switched on. Reads the connection module's own lock rather than
  inventing a second source of truth.
- **Field-shape validation with specific corrections.** Catches Supabase's
  **anon** key pasted instead of `service_role` (both are `eyJ…` JWTs on the same
  page — the anon key cannot see past RLS, so the bot runs and finds no data), a
  phone *number* in Meta's `PHONE_NUMBER_ID`, another vendor's `sk-…` in
  `OPENROUTER_API_KEY`, the Supabase dashboard URL instead of the API URL, and
  Upstash's `https://` endpoint as `REDIS_URL`.
- **An optional-abilities step** that describes each extra by what a teacher
  would notice, defaults to skipping, and only stores a multi-key feature when
  every key is given.

### Fixed

Most of these were pre-existing and affected Meta deployments too. Each failed
inside a `try/catch` that made it look transient.

- **`redisService.setNX` and `setexWithCeiling` never existed.** No quiz could
  ever be delivered and every image message failed. Added, with a conformance
  guard.
- **`quiz_class_*` replies had no handler**, despite a comment claiming one.
- **Five services bypassed `llm-client.js`** and called `OPENAI_API_KEY`
  directly.
- **`quiz_sessions` was missing six columns** on any database created before
  them — `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so they
  only ever reached fresh installs. Added to the `ALTER … ADD COLUMN IF NOT
  EXISTS` reconcile block.
- **`rumi doctor` reported a green tick for an OpenRouter key with no credit** —
  the worst kind of preflight, since it sends you hunting for a bug in the bot.
  It now reports the remaining balance.
- **Feature-intro videos and reading-passage backgrounds produced relative URLs**
  when no public asset host was configured, so the bot offered "want to see how?
  🎥", the teacher accepted, and nothing arrived. Both are presence-gated now,
  and the offer is only made when there is something to send.
- **Reading assessments leaked artifacts** — every run left an `.ogg` of a
  child's voice and a report PDF on disk forever.
- **A failure message claimed "our team has been notified"** when nobody had
  been. Replaced with an honest one.
- **A failed voice note apologised three times.**
- Baileys sessions are protected by a single-instance lock, and a QR shown when
  credentials already exist is treated as terminal rather than looping forever
  (which is how this project kept tripping WhatsApp's device-linking rate limit).
- Two tests read the repo's real channel state; one renamed a live WhatsApp
  session. Both now use throwaway directories.

### Changed

- **README and SETUP.md** lead with the two-command path; the manual walkthrough
  remains as the production reference. Both now state that **you need a second
  phone number to test from** — Rumi answers *as* your number, so messaging it
  from the same account looks exactly like a broken bot.
- **The `/setup` skill** documents both front doors: the human wizard, and the
  agent-driven "set me up" flow. The agent path calls the wizard's own modules
  (validators, `.env` patcher, doctor probes, schema bootstrap) so the two cannot
  drift, and the skill is explicit that `rumi setup`, `rumi pair` and
  `rumi graduate` are interactive TTY programs an agent must not launch.
- `rumi doctor` is channel-aware: it skips the Meta probe cleanly on a sandbox
  channel and names the address when Redis does not answer.
- `.env.template` opens by pointing at `./install.sh && rumi setup`.
- **Test suite: 170 suites / 1997 tests**, up from 155/1724.

## [1.2.0] - 2026-07-29

### Added
- **Video Quizzes + the Taleemabad Content Library** — the biggest content drop
  the platform has shipped. A teacher pulls a curriculum video with `/video`
  and is offered its quiz 3 s later: 15 questions one at a time with per-answer
  feedback, picture options served as a tappable WhatsApp Flow
  (`RadioButtonsGroup`, `media-size: large`) with a numbered-grid fallback,
  phonics questions asked by voice note (labels quoted-replied to the clip they
  name), a forwardable `wa.me` class link (each child plays 1:1, is remembered
  between quizzes, and can invite a friend), and a next-morning designed PDF
  report that names what to reteach and the wrong answer the class agreed on.
  Ships with the openly-hosted library: **890 curriculum videos, 858 with a
  quiz, 10,929 QA-certified questions, 15,557 studio voice clips, 3,217
  hand-drawn illustrations** (Pakistani national curriculum, English + Urdu),
  all served from a public CDN bucket — one import script
  (`bot/scripts/setup/import-video-quiz-library.js`) and zero media hosting.
  Region-gated via `region_features.video_quizzes_enabled` (seeded ON for
  `pakistan`). New services under `bot/shared/services/quiz/video-quiz-*.js`,
  student-videos endpoint v2 (clean titles, duplicate-hiding), two new Flows
  (`video-quiz-flow.json`, `student-join-flow.json`) in the registrar, a
  boot-time Flow-ID validator, and schema: `quiz_share_codes`,
  `video_quiz_deliveries`, `v_video_quiz_popularity`, plus media/feedback/
  render-pattern columns on `quiz_questions` and identity columns on
  `quiz_sessions`/`students`.

### Fixed
- `quiz_sessions.status` CHECK now includes `in_progress` (the value the
  session service actually writes — previously every start UPDATE failed
  silently).

## [1.1.0] - 2026-04-03

**BREAKING (vs v1.0.0):** The three-tier feature system (Minimal / Recommended /
Full) is removed. Features are now **presence-gated**: a feature is ON iff its
required env var(s) are set. There is no `RUMI_TIER` env var; `feature-availability.js`
is the single source of truth. `npm run doctor` shows a per-feature ON/OFF matrix
based on the keys you've provided.

### Added
- **Multi-framework coaching system** — OECD, HOTS, TEACH, and FICO frameworks selectable per teacher
- **HOTS framework** — aligned to PESRP/PECTAA official spec (16 indicators, 48 marks, 6 areas)
- **FICO framework** — 5 domains, 21 indicators, 84-mark scale (photo-aware indicators for 3.2 and 4.4)
- **TEACH framework** — behavior observation framework with teacher-student interaction analysis
- **Framework registry + selector** — lazy-loaded framework modules, user preference persistence
- **Classroom photo analysis** — AI-powered visual evidence for photo-aware coaching indicators
- **Coaching cards** — personalized PNG action cards generated after coaching sessions
- **Prioritized action service** — surfaces single highest-leverage action from coaching analysis
- **LP-coaching linker** — connects lesson plan feedback into the coaching session context
- **Report transformers** — per-framework PDF report generation (OECD, HOTS, TEACH, FICO)
- **Coaching flow helpers** — centralized state management for multi-step coaching flows
- **Centralized scoring constants** — `getFrameworkMaxMarks()` and `getFrameworkDisplayName()` for all frameworks
- 25 new coaching test scenarios across framework registry, HOTS, FICO, OECD, TEACH, report transformers, and coaching card generation (753 total tests, up from 728)

### Fixed
- HOTS report: empty PDF when no lesson plan linked — now uses raw analysis as fallback
- HOTS evidence: was English-only; now infers subject/topic from transcript context
- HOTS framework selector: wrong DB column used when reading user preference
- Coaching photo flow: state mismatch, missing `photo_yes` button handler, 2-minute timeout

### Infrastructure
- Added `pino` and `canvas` mocks to OSS test suite so tests run without native dependencies
- `jest.config.js`: added `moduleNameMapper` entries for `pino` and `canvas`
- `scoring.constants.js`: removed unnecessary `require('dotenv').config()` for OSS compatibility

## [1.0.0] - 2026-01-28

### Added
- Initial open-source release of Rumi AI Teaching Assistant
- WhatsApp bot with AI chat (AMA), registration, coaching, reading assessment, and lesson plans
- Three-tier feature system (Minimal, Recommended, Full)
- OpenRouter as unified AI gateway (one key for 500+ LLM models)
- BullMQ-based async job queue (coaching analysis, transcription, video generation)
- Supabase database schema with 52+ tables, RLS policies, and seed data
- Observability Dashboard for monitoring bot usage and coaching sessions
- Teacher Portal for classroom management (Phase 2)
- `/setup` Claude Code skill for automated one-hour deployment
- Railway deployment configuration (Procfile for web + worker processes)
- CLI simulator for local testing without WhatsApp
- Comprehensive documentation (architecture, setup, cost guide, customization)
- Environment validation and connection testing scripts
- CI pipeline with Node.js 18/20/22 matrix testing
- Apache 2.0 license

### Security
- All credentials parameterized via environment variables
- No hardcoded API keys, tokens, phone numbers, or personal paths in source
- Row-Level Security (RLS) enforced on all user-facing database tables
- Comprehensive .gitignore covering secrets, build artifacts, and IDE files
