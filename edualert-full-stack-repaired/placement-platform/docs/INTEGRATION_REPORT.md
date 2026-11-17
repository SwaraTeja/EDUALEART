# EduAlert integration report

## 0. Important: the uploaded project is not the stack described in the brief
The brief describes HTML/CSS/JS + Express + `pg` + `schema.sql`. The archive actually contains **React/Vite/Tailwind + Fastify + Prisma/TypeScript**. I fixed the code that was uploaded, kept its architecture, and did not rewrite it into Express. Consequences:
* There was no original single-file HTML prototype and no localStorage-based module code in the archive, so there was nothing to "migrate off localStorage": the only localStorage use is the auth session (tokens + cached user for the UI), which is legitimate.
* **Roadmap, Preparation Guide, Tips & Actions** have no schema, route or UI in this codebase. I did not invent them (I'd be guessing content and design). To integrate them I need the original prototype or a description. See §7.

## 1. Problems found (verified in the code)
**Blockers**
1. `schema.prisma` used a `/* */` block comment, which Prisma doesn't support → `prisma validate/generate/migrate` failed; the project could not start (verified by running `prisma validate`).
2. No migrations existed; README relied on `migrate dev`, which could not run (see 1).
3. Docker: backend `DATABASE_URL` pointed at `localhost` inside the container; no migrations on start; `VITE_API_URL` set as a *runtime* env of an nginx image (Vite bakes it at build time) and nginx had no `/api` proxy or SPA fallback.
4. `/auth/refresh` was registered at `/auth/refresh`, but the client called `/api/auth/refresh` → every token refresh 404'd.
5. API base URL: `VITE_API_URL` (an origin in docker-compose) was used as `baseURL` without `/api`; refresh and AI-stream URLs were hard-coded separately.
6. Officers/mentors/admins hit `/students/me` on the dashboard → 404 swallowed by `.catch(()=>{})` → stuck on "Loading…" forever. Self-registered users also had no Student row (signup created only a User), so they got the same dead dashboard.
7. Custom error handler was registered *after* the route plugins, so Fastify never applied it to them (and the default one echoes internal messages on 500s).
8. CORS plugin used the default methods (`GET,HEAD,POST`) → cross-origin PATCH/PUT/DELETE preflights failed.

**Security**
9. Public signup accepted `role: TPC_OFFICER | ADMIN` → anyone could make themselves an administrator.
10. `passwordHash` returned to clients: `/students/me`, `/students/:id`, `/bookings/*` (mentor's hash shown to students), `/companies/:id/applications`.
11. Refresh and password-reset tokens shared one secret and shape → a reset link was usable as a refresh token and vice-versa; reset links were reusable; refresh tokens survived disabling/demotion; no real logout.
12. AI: any user could read any chat session's messages (IDOR); JWT passed in the URL query string (logged); only the latest message was sent to the model (history ignored); `reply.raw.writeHead` dropped CORS headers; provider error text forwarded to the browser.
13. Mass assignment: `PATCH /mentors/me` (a mentor could set own `rating`/`userId`), companies and courses took `req.body as any`.
14. Students could edit their own CGPA/backlogs/branch (these drive eligibility and risk). Mentors could read any student's full record. Leaderboard exposed every peer's name and risk level to all students.
15. `javascript:` URLs accepted for LinkedIn/logo/video links; HTML e-mail built from unescaped names.
16. Server accepted the placeholder secrets from `.env.example`.

**Correctness / data integrity**
17. Students created by an officer had no password and no way to get one.
18. Booking: non-atomic check-then-update; e-mail failure after commit returned an error although the booking existed; slots could be created in the past/overlapping/with end < start.
19. Apply endpoint ignored eligibility and closed drives; invalid ids/enums produced 500s throughout.
20. Student list: risk filter applied after pagination (wrong pages). Update/delete student endpoints did not exist. Bulk import was not transactional.
21. Seed duplicated companies/courses on every run; cron job could crash the process on an unhandled rejection; one e-mail failure aborted the whole nightly scoring batch.
22. Video player reported progress on every `timeupdate` (~4×/s) → hits the rate limit and floods the activity log; quiz answers could be repeated to exceed 100%; clients could claim more watched seconds than the video length; quizzes had no way to be fetched/taken.
23. Missing backends: announcements and alerts had tables but no routes. Missing frontends for: registration, password reset, students, drives, announcements, alerts, lecture list, mentor slots, admin.

## 2. Files changed
Everything under `backend/src`, `backend/prisma` (schema, new migration, seed), `backend/scripts`, `backend/tests`, plus `backend/{package.json,tsconfig.json,Dockerfile,.env.example,vitest.config.ts}`; `frontend/src` (all routes/components/lib), `frontend/{Dockerfile,nginx.conf,.env.example,package.json}`; `docker-compose.yml`; `README.md`.
Schema changes: `User.tokenVersion`; `onDelete: Cascade` on student/user-owned relations; CHECK constraints (cgpa 0–10, backlogs ≥ 0, year 1–6, score 0–100, slot end > start) added in SQL.

## 3. API map (all under `/api`; errors are always `{ "error": "message" }`)
| Module | Endpoints (role) |
|---|---|
| Health | `GET /health` (also `/health` at root) — 503 if DB down |
| Auth | `POST /auth/signup` (public, STUDENT only) · `/login` · `/refresh` · `GET /me` · `POST /logout` · `/request-reset` · `/reset` |
| Admin | `GET/POST /admin/users`, `PATCH /admin/users/:id` (ADMIN) |
| Students | `GET /students/me` · `PATCH /students` (own phone/LinkedIn) · `POST /students/resume` · officer/admin: `GET /students` (page, limit, branch, riskLevel, search; `X-Total-Count`) · `POST /students` · `POST /students/bulk` · `PATCH/DELETE /students/:id` · `PUT /students/:id/skills` · `GET /students/:id` (officer/admin; own; mentor only for their mentees) |
| Drives (companies) | `GET /companies` (students also get `eligibility`, `myApplication`) · `GET /companies/eligible` · `POST /:id/apply` · `DELETE /:id/apply` · `GET /companies/applications/mine` · officer: `POST`, `PATCH/DELETE /:id`, `GET /:id/applications`, `PATCH /applications/:appId` |
| Mentors | `GET /mentors` · `GET/PATCH /mentors/me` (MENTOR) |
| Bookings | `GET /bookings/slots` · `POST /bookings/book` · `GET /bookings/mine` · `DELETE /bookings/:id` · mentor: `GET/POST /bookings/mentor/slots`, `DELETE /bookings/mentor/slots/:id` |
| Lectures | `GET /courses` · `/courses/:id` · `/courses/:id/progress` · `/courses/recommended/me` · `/courses/quizzes/:quizId` · `POST /lesson-progress` · `/quiz-attempt` · `/:id/certificate` · staff: `POST/PATCH/DELETE /courses…`, lessons, `POST /courses/lessons/:id/quizzes` |
| Analytics | officer/admin: `/analytics/summary`, `/risk-trends`, `/branch-breakdown`, `/engagement` · everyone: `/analytics/leaderboard` (anonymised for students) |
| Announcements | `GET` (all) · `POST/PATCH/DELETE` (officer/admin) |
| Alerts | `GET /alerts` (officer: all; student: own) · `POST /alerts`, `PATCH /alerts/:id/resolve` (officer/admin) |
| AI | `GET /ai/session` · `GET /ai/session/:id/messages` · `POST /ai/chat/:id` (SSE over fetch, Bearer header) |

## 4. Verification status — what was and was not run
**Run, and passed (this environment):**
* `prisma validate` on the corrected schema; backend `tsc` typecheck and production `tsc` build; frontend `tsc` typecheck and `vite build`.
* Baseline migration applied to a real PostgreSQL 16 (22 tables, FKs, CHECK constraints).
* **89 automated backend tests** (6 files) against real PostgreSQL through the real Fastify app: registration, login, invalid login, JWT/refresh/reset handling (type confusion, expiry, alg=none, revocation), role escalation attempts, role-based authorization for every module, student CRUD + validation + duplicates + pagination/filters + cascade delete, drives/applications, mentor slots/bookings incl. a 3-way concurrent booking race, lectures/quizzes/certificates, announcements/alerts, analytics + leaderboard privacy, AI SSE streaming/ownership/history/failure handling, CORS, rate limiting, health (up and DB-down), no-leak error handling, seed idempotency, DB CHECK constraints.
* 14 HTTP-level checks against a running server through the Vite proxy (health, login, CORS preflight, persistence confirmed with a direct SQL query, no secrets in logs).

**Could NOT be run here — please run these on your machine:**
* **Prisma's native engine.** This sandbox cannot reach `binaries.prisma.sh`, so `prisma generate` / `migrate deploy` / `npm run dev` with the normal client were not executed. Tests instead ran on Prisma's own WebAssembly engine + `pg` driver adapter (same app code, same SQL, same database; see `backend/tests/sandbox/`). Run `npx prisma generate && npm test` locally to confirm on the native engine.
* **The baseline migration SQL was generated from the schema's DMMF following Prisma's naming conventions, not by `prisma migrate`.** It applies cleanly and the tests pass on it, but please run once: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <empty db url> --exit-code` (exit 0 = identical). If you already have a database from the old schema, run `npx prisma migrate resolve --applied 20261022000000_init` only after confirming it matches, or start from an empty database.
* **No browser was available**: the React UI was type-checked and built, and every API call it makes was exercised, but I did not click through it or inspect the browser console/network tab. Please smoke-test per §6.
* Docker build/compose, S3 resume upload, SendGrid e-mail, and the real Claude API were not run (no network/credentials). Resume upload is only tested for its 503 "not configured" path; AI is tested with an injected streamer.
* `npm audit` reports 6 production-dependency advisories (fastify 4, find-my-way, nodemailer, node-cron, aws-sdk v2, uuid); each fix is a major upgrade (Fastify 5, Nodemailer 10, node-cron 4, AWS SDK v3). I did not apply them untested.

## 5. Decisions you may want to revisit
* Self-signup creates the student with **CGPA 0 / 0 backlogs**; officers enter academic data (it drives eligibility and risk). Students may edit only phone and LinkedIn.
* Mentors see a student only if that student booked them, and without contact details.
* Logout (and password reset / account disable) revokes **all** sessions of that user (token versioning).
* Access/refresh tokens live in localStorage (standard for this SPA design; XSS-exposed). Moving to httpOnly cookies would need CSRF protection.
* Public signup has no e-mail verification (existing TODO) — anyone can claim an unused roll number.
* Certificates still use a placeholder URL (`CERTIFICATE_BASE_URL`); PDF generation is an existing TODO.

## 6. Manual smoke test (after setup in README)
1. Open http://localhost:3000 → sign in as `officer@edualert.app`: dashboard shows counts, open alert, branches; post an announcement; refresh — still there.
2. **Students** → Add student → copy the set-password link shown (e-mail not configured) → open it in a private window, set a password, sign in as that student.
3. As `student1@edualert.app`: dashboard score, **Drives** (Apply; ineligible ones explain why), **Mentors** (book, then cancel), **Lectures** (play, reload: resumes), **AI Assistant** (needs `CLAUDE_API_KEY`; otherwise shows "not configured").
4. As `mentor@edualert.app`: **Mentors** page → publish a slot → see it booked.
5. Create an ADMIN with `npm run user:create`, sign in, **Users** → create an officer.
6. Stop the backend, reload `/login`: a "server unreachable" banner appears.

## 7. Remaining / blocked
* Roadmap, Preparation Guide, Tips & Actions: not present in the uploaded code — need the original prototype to integrate.
* The dependency upgrades above; email verification; real certificate PDFs; CSV import UI (API exists: `POST /api/students/bulk`).
* The quiz endpoint's old comment promised "nudges skill % up" — never implemented; left unimplemented rather than inventing the rule.


---
## 8. Addendum — second pass (career content)
**Done (code written, NOT yet executed):** Roadmaps, Preparation Guides and Tips & Actions were added end to end:
schema (5 models), migration `20261023000000_career_content` (hand-written, same caveat as §4), validators, routes
(`roadmaps.ts`, `guides.ts`, `tips.ts`), tip-matching rule (`lib/tips.ts`), seed content, React pages and nav links,
integration tests (`tests/careers.test.ts`), unit tests (`tests/unit.test.ts`), and the migration/seed tests in `tests/database.test.ts`
(table count 22 → 27, seed idempotency now includes the new tables).

**Verification status of this pass:** the sandbox had no access to the npm registry, PostgreSQL or Docker, so *nothing was compiled or run*.
Only a syntax-level parse (TypeScript 6.0.3, `--noResolve`) of the new/changed files was done and found no syntax errors.
Type errors, runtime errors, SQL errors and test failures are all still possible. Run the commands in README → Tests and the
`prisma migrate diff` check from §4, and send me any failures.

**Design decisions (mine, because the original spec was unavailable):** HR tips are measured against `mockInterviewPct`; a student with no
skills record is treated as 0 everywhere; guides are plain text (no HTML) to rule out XSS; mentors can read roadmaps/guides but not tips.
