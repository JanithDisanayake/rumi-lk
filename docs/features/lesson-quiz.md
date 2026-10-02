# 📝 Lesson Quiz — a quiz from the lesson

> A teacher has no time to write homework and no time to mark forty copies of it. The lesson quiz does both
> jobs. It writes a quiz on the lesson just taught (from the coaching recording) or just planned (from a
> Rumi lesson plan), plus a one-page PDF that explains every question to the teacher. The teacher forwards one
> message to the class, each child answers in their own chat and gets a reason after every answer, and the
> next morning the teacher gets a class report saying what to reteach.

## What it is

A few minutes after a coaching report arrives, Rumi asks once: *"Want a quiz on the lesson you just taught?"*.
The teacher says yes and, where the deployment offers more than one quiz language, picks the quiz language.
About a minute later they receive two things:

1. **A PDF for the teacher only.** It lists the lesson objectives the quiz checks, then every question
   with why it was asked and what each wrong answer reveals.
2. **One forwardable message** for the class group. Its join line follows the teacher's channel: a `wa.me`
   link on WhatsApp, a `matrix.to` link to the bot plus a join code on Matrix, and the code alone elsewhere.
   On any channel a child can also type `join <CODE>` or `QUIZ-<CODE>`.

Each child joins, gives their name and class, and answers the questions one at a time. They get an
immediate reason after each answer and a score card with their name at the end. If fewer than five children
have started after six hours, the teacher gets one nudge (never during the school's quiet hours, and never
twice). The next morning, or earlier once the class has finished, the teacher gets a **class report PDF**
showing who got what, which question most children missed, and a *For tomorrow* reteach box.

`/quiz` is the lesson-quiz menu: every recent lesson and lesson plan with its quiz state (*no quiz yet*,
*being made*, *sent · N started*, *report sent*), *Quiz on any topic*, *Video quizzes*, and the classic
*Quiz to parents' phones*. On channels without native lists the menu is a numbered list.

## How it works

| Step | Code |
|---|---|
| Coaching report delivered → offer queued (+4 min). This suppresses the classic Trigger-3 quiz offer. | `services/coaching/report-generator.service.js` `scheduleTranscriptQuiz` → `quiz/transcript-quiz-offer.service.js` |
| `/quiz`, bare `quiz`, `/quiz <topic>` | `handlers/text-message.handler.js` → `quiz/quiz-menu-entry.service.js`, `quiz/transcript-quiz-list.service.js`, `quiz/providers/{lp-generated,topic}.provider.js` |
| Lesson source: coaching transcript, Rumi lesson plan, or a topic | `quiz/quiz-sources.js`, `quiz/transcript-quiz-generate.service.js` `resolveLessonSource` |
| Digest → author → validate → blind key check → rows → figures → PDF | `quiz/transcript-quiz-{digest,author,validator,key-verify,rows,figure}*.js`, `quiz/plan-quiz-digest.service.js`, `templates/transcript-quiz-teacher.template.js` |
| Hand-off: PDF + forwardable message + report promise; nudge scheduled | `quiz/transcript-quiz-handoff.service.js`, `quiz/transcript-quiz-nudge.service.js` |
| Child joins by link or code; typed answers (`B`, `b.`, `A C` for select-all, `STOP`) | `quiz/video-quiz-share.service.js` (`joinInvite`, `parseShareCode`), `quiz/video-quiz.service.js` (`answerTypedLetter`, `stopTyped`) |
| Class report next morning (school time), guidance box from the model | `quiz/video-quiz-report.service.js`, `templates/video-quiz-report.template.js` |
| Jobs | `workers/sqs-worker.js`: `quiz_offer`, `quiz_generate`, `quiz_nudge_teacher`, `quiz_child_videos_offer` |

Lesson plans: when Rumi delivers a lesson-plan PDF, the worker extracts its text into
`lesson_plans.content.plan_text`, so a plan quiz is written from what was actually planned. A plan quiz's PDF
says *What you planned* and a topic quiz says what topic it covers. Neither ever says *what you taught*.

Answer keys are checked by a second model that solves each question blind. If that model is unreachable, the
quiz still goes out and the row records it as unverified (`meta.key_verify`).

## Children on Matrix

On a Matrix deployment every child needs an account on the school's homeserver. **The school's admin creates
these accounts**, as the Rumi Messenger guides describe. Children are not expected to self-register. The child
opens the `matrix.to` link (or starts a chat with the bot) and sends the code from the teacher's message.

## Enable it

```bash
TRANSCRIPT_QUIZ_ENABLED=true          # the lesson quiz, its offer and the /quiz menu
SCHOOL_TIMEZONE=Africa/Nairobi        # IANA zone: report time, quiet hours, "today" for the daily cap
QUIZ_LANGUAGES=en                     # e.g. en,ur — more than one makes Rumi ask the quiz language
```

With only `OPENROUTER_API_KEY` set, the default models run on OpenRouter: `TRANSCRIPT_QUIZ_MODEL` (author),
`TRANSCRIPT_QUIZ_VERIFY_MODEL` (blind key check) and `QUIZ_REPORT_MODEL` (the reteach box). To build share
links, set `WHATSAPP_BOT_NUMBER` on WhatsApp and `MATRIX_USER_ID` on Matrix. Without either, the message carries
the join code and the bot's name. Every variable, with its default, is in the *Lesson quiz* block of
[`.env.template`](../../.env.template).

With `TRANSCRIPT_QUIZ_ENABLED` unset, `/quiz` is the classic quiz exactly as before, and video quizzes are
unchanged.

**Languages.** English copy ships for every deployment. An `ur` pack (copy, Nastaliq PDFs, Urdu validator
rules) is included. A quiz language with no catalogue falls back to English copy, and the model still writes the
questions in the chosen language.

## Data

`quizzes` gains `coaching_session_id`, `language` and `meta jsonb`, the statuses `offered | declined |
skipped`, and one-quiz-per-lesson unique indexes for transcript and lesson-plan quizzes. The schema is in
`infrastructure/supabase/00_complete-schema.sql` and the upgrade is
`infrastructure/supabase/migrations/V2.9.0__lesson_quiz.sql` (additive). Children's answers use the same tables
as video quizzes: `quiz_share_codes` (one code per class link), `quiz_sessions` (one per child) and `quiz_answers`.

## Not in this release

The afternoon "quiz on today's lesson plan" offer (it needs a nudges sweeper), Meta Flow front-ends for the
menu and the multi-select picker (every surface works without them), an intro film on the offer, and
training quizzes.
