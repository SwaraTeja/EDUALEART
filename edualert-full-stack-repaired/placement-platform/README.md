# EduAlert — Full-Stack Placement Intelligence Platform

React + Vite + Tailwind frontend · Fastify + TypeScript API · PostgreSQL via Prisma · Claude AI assistant (server-side only).

## Quick start (local, no Docker)

```bash
# 0. Requirements: Node >= 20, PostgreSQL 14+
createdb placement

# 1. Backend
cd backend
cp .env.example .env
#   edit .env: set DATABASE_URL, and generate two DIFFERENT secrets:
#   openssl rand -hex 48   (→ JWT_SECRET)     openssl rand -hex 48   (→ JWT_REFRESH_SECRET)
npm install
npx prisma generate
npm run db:migrate          # applies prisma/migrations (safe: never resets data)
npm run db:seed             # OPTIONAL demo data; idempotent; refuses to run in production
npm run dev                 # http://localhost:4000   (health: /api/health)

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                 # http://localhost:3000   (Vite proxies /api → :4000)
```

Demo logins after seeding (development only): `officer@edualert.app / officer123`, `mentor@edualert.app / mentor123`, `student1@edualert.app / student123`.

## Docker

```bash
echo "POSTGRES_PASSWORD=<choose-one>" > .env          # next to docker-compose.yml
cp backend/.env.example backend/.env                   # set JWT_SECRET, JWT_REFRESH_SECRET (+ CLAUDE_API_KEY optional)
docker compose up -d --build                           # migrations run automatically on backend start
```
Frontend http://localhost:3000 (nginx serves the SPA and proxies `/api` to the backend), backend http://localhost:4000.

## Roles and how privileged accounts are created

| Role | How an account is created |
|---|---|
| `STUDENT` | Public sign-up (`/register`), or created by a TPC officer/admin (they receive a one-time set-password link) |
| `MENTOR`, `TPC_OFFICER`, `ADMIN` | **Never self-service.** An `ADMIN` creates them in the app (**Users** page) or via `POST /api/admin/users`. |
| first `ADMIN` | `cd backend && npm run user:create -- --email you@college.edu --first You --last Name --role ADMIN` → prints a single-use link to set the password |

Roles are enforced on the server from the database on every request (not from the token), so demoting or disabling a user takes effect immediately.

## Tests

```bash
cd backend
createdb placement_test
TEST_DATABASE_URL=postgresql://postgres:<pw>@localhost:5432/placement_test npm test
```
The test database name must contain `test` — the suite drops and re-creates its schema. See `docs/INTEGRATION_REPORT.md` for what is covered and what could not be verified.

## Layout

```
backend/
  prisma/schema.prisma · migrations/ · seed.ts
  src/app.ts            app factory (used by server + tests)     src/index.ts   server entry
  src/routes/           auth admin students companies mentors bookings courses ai analytics announcements alerts roadmaps guides tips
  src/lib/ services/ plugins/ middlewares/ utils/ config/
  scripts/create-user.ts          tests/
frontend/ src/{lib,components,routes}   nginx.conf   Dockerfile
docs/INTEGRATION_REPORT.md      full findings, API map, verification status
```

## Career content: roadmaps, preparation guides, tips & actions

Staff (`TPC_OFFICER`, `ADMIN`) manage the content in the app (**Roadmaps**, **Guides**, **Tips** pages); students read it.

| Feature | Behaviour |
|---|---|
| Roadmaps | Ordered steps per roadmap (optional category, duration, resource link). Students tick steps off; progress is stored per student (`RoadmapProgress`) and shown as a percentage. Drafts (`published: false`) are hidden from non-staff. |
| Preparation guides | Plain-text guides by category, optionally linked to a company (drive). Searchable and filterable. Drafts are hidden from non-staff. |
| Tips & actions | A tip applies to a student whose score in the tip's category is **below the tip's threshold** (`belowPct`). Categories map to stored scores: DSA→`dsaPct`, APTITUDE→`aptitudePct`, COMMUNICATION→`communicationPct`, DOMAIN→`domainPct`, **HR→`mockInterviewPct`**. Weakest area first. Each tip can carry an action label and link. |

> The original prototype for these three features was not in the uploaded archive, so the data model, the category→score mapping
> above and the UI are a new design built to the project's conventions. If your original differs, tell me what to change.

API (all under `/api`): `GET /roadmaps`, `POST /roadmaps`, `PATCH|DELETE /roadmaps/:id`, `POST /roadmaps/:id/steps`,
`PATCH|DELETE /roadmaps/steps/:stepId`, `POST|DELETE /roadmaps/steps/:stepId/complete` (student) ·
`GET /guides[?category&search]`, `GET /guides/:id`, `POST`, `PATCH|DELETE /guides/:id` ·
`GET /tips/me` (student), `GET /tips`, `POST /tips`, `PATCH|DELETE /tips/:id` (staff).
