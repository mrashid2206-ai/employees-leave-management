# Architecture & Onboarding

A bilingual (Arabic/English, RTL-first) HR / attendance / leave-management system for a
small Oman engineering company (~14 employees, 2 departments). This doc orients a new
developer or operator: what the system does, how the code is laid out, the key business
rules, how to run/deploy it, and how to troubleshoot the common issues.

## 1. Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **PostgreSQL** via the `pg` Pool — raw SQL, **no ORM** (see `src/lib/db.ts`)
- **jose** (JWT auth), **bcryptjs** (password hashing)
- **@tanstack/react-query** (client data), **zod** (input validation)
- **base-ui / shadcn + Tailwind v4**, **recharts** (charts), **xlsx** (export), **nodemailer** (email)
- Deployed on **Railway** (app service + Postgres). CI via GitHub Actions.

## 2. Two apps, one codebase

| Surface | Path | Who | Auth cookie |
| --- | --- | --- | --- |
| Admin dashboard | `src/app/(dashboard)/*` | Managers/admins | `auth-token` |
| Employee portal | `src/app/check-in` (+ `apply-leave`) | Employees (phone-first) | `emp-auth-token` |
| Login pages | `src/app/login`, `src/app/employee-login` | both | — |

Auth is verified **per API route** via `src/lib/api-auth.ts`
(`verifyAdmin` / `verifyEmployee` / `verifyAnyAuth`). Route protection + redirects live in
`src/proxy.ts` (Next 16's renamed middleware — it is NOT called `middleware.ts`).

## 3. Domain model (tables)

`settings` (singleton, fiscal year + work schedule + geofence) · `departments` ·
`employees` (incl. `username`, `password_hash`, `must_change_password`, `leave_balance`) ·
`leave_types` · `leave_requests` · `tardiness_log` · `attendance` · `holidays` ·
`permissions` (temporary mid-day exit) · `admin_users` · `audit_log` ·
`employee_notifications` · `rate_limits` · `schema_migrations`.

TypeScript shapes: `src/lib/types.ts`. Money columns (`deduction_per_hour`, `currency*`)
still exist but are **unused** — monetary deduction was removed by product decision.

## 4. Core business rules (where they live)

Tunable constants: **`src/lib/constants.ts`**.

- **Attendance / geofence** — `src/lib/attendance-calc.ts` + `src/app/api/attendance/check-in/route.ts`.
  Location is **record-only**: GPS is captured when available and the row is flagged
  `is_offsite` / `is_offsite_checkout` for admin review, but check-in/out is **never blocked**
  by location (laptops have no GPS and mobile fixes can fail at the office). `office_lat/lng` +
  `office_radius` (default 200 m, IP fallback) only decide the off-site *flag*, not access.
- **Work hours / overtime** — `computeWorkHours` (handles overnight wrap, caps at
  `MAX_SHIFT_HOURS=16`), `computeOvertime` (hours beyond `work_hours_per_day`; on a
  holiday/off-day ALL hours are overtime).
- **Leave** — `src/app/api/leaves/*` + `src/lib/leave-days.ts`. Calendar days minus public
  holidays; half-days = 0.5; Emergency ≤ `EMERGENCY_LEAVE_MAX_DAYS`/yr; Sick >
  `SICK_LEAVE_NOTES_THRESHOLD` days needs notes; ≤ `MAX_CONSECUTIVE_LEAVE_DAYS`;
  department `max_absent_same_dept` cap. Balance changes (approve/reject/edit/delete) are
  transactional with row locks.
- **Tardiness** — minutes late vs `work_start_time`; feeds the commitment ranking. No money.
- **Permissions** — temporary exits, admin-approved, auto-closed at day end.
- **Automation** — `src/lib/automation.ts`:
  - `runDailyAutomation` processes the **previous completed day** (`omanYesterday()`), and
    only marks absent for days strictly before today. It marks no-shows absent, auto-deducts
    one annual day for unexcused absence (reversible — see `src/lib/auto-absence.ts`), logs
    tardiness, and closes stale permissions. **Idempotent.**
  - `runYearlyReset` resets balances + advances the fiscal year; fires once at year-end
    (guarded by `last_reset_year`). **Idempotent.**

## 5. Scheduling (cron)

`runDaily/runYearly` are exposed two ways:
- **Admin "run now"** buttons → `/api/automation/daily`, `/api/automation/yearly-reset` (verifyAdmin).
- **Unattended** → `/api/cron/daily`, `/api/cron/yearly`, authorized by a constant-time
  `CRON_SECRET` bearer token (`src/lib/cron-auth.ts`). Triggered by
  `.github/workflows/scheduled-automation.yml` at **01:00 Asia/Muscat** daily.

Required for cron: `CRON_SECRET` env on Railway **and** GitHub repo secrets `CRON_SECRET`
(same value) + `APP_URL`.

## 6. Infrastructure libs (`src/lib/`)

`db.ts` (pool + Oman-TZ helpers `omanNow/omanToday/omanYesterday/omanTime`) ·
`migrate.ts` + `db/migrations/*.sql` (versioned runner) · `ensure-schema.ts` (lazy
self-heal, belt-and-suspenders) · `env.ts` (boot validation, fail-fast in prod) ·
`log.ts` (JSON logging) · `rate-limit.ts` (Postgres-backed, survives deploys) · `jwt.ts` ·
`audit.ts` · `email.ts` · `api.ts` (typed client) · `query-keys.ts` (`qk.*` factory).

Request validation: `src/server/schemas.ts` + `src/server/validation.ts` (zod at write boundaries).

## 7. Schema & migrations

`db/migrations/0001_baseline.sql` is the **canonical, idempotent** schema; `0002_rate_limits.sql`
adds the rate-limit table. Apply with **`npm run migrate`** (local/CI/deploy). Optionally apply
at server boot via `RUN_MIGRATIONS_AT_BOOT=true` (default off).

Historical/legacy SQL (`supabase/migrations/*`, `railway-migration.sql`) predates the runner;
`db/migrations/` is the source of truth going forward. `ensure-schema.ts` still self-heals
columns lazily so an un-migrated DB keeps working.

## 8. Local development

```bash
npm install
cp .env.example .env.local      # then fill values (see below)
npm run migrate                 # create/upgrade the schema
npm run dev                     # http://localhost:3000
```

Quality gates (also enforced in CI):
```bash
npm run lint
npx tsc --noEmit
npm test            # vitest — unit tests for the money/leave/geo math
npx next build
```

## 9. Environment variables (`.env.example`)

- **`DATABASE_URL`** (preferred) or `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`
- **`JWT_SECRET`** — required, ≥32 random chars (signs both cookies)
- **`ADMIN_PASSWORD`** — bootstrap `admin` login; only usable while `admin_users` is empty
- `APP_URL` / `ALLOWED_ORIGINS` — cross-origin allowlist for `/api/*`
- `CRON_SECRET` — enables the scheduled automation endpoints
- `RUN_MIGRATIONS_AT_BOOT` — apply migrations on startup (default false)
- `SMTP_HOST/PORT/USER/PASS`, `NOTIFY_EMAIL` — optional email notifications

## 10. Deploy checklist (Railway)

1. `npm run migrate` against the database (or set `RUN_MIGRATIONS_AT_BOOT=true`).
2. Set env: `JWT_SECRET`, `ADMIN_PASSWORD`, `DATABASE_URL`, `CRON_SECRET` (+ `APP_URL`).
3. GitHub repo secrets for the cron workflow: `CRON_SECRET` (same value) + `APP_URL`.
4. First login as `admin` / `ADMIN_PASSWORD`, then create real admin users (Settings).

## 11. Troubleshooting

- **Check-in location** — location is **record-only**; it never blocks check-in. If you want
  to *see* who is off-site accurately, set correct `office_lat/lng` and a sane `office_radius`
  (150–300 m) in Settings → Location; otherwise rows may be flagged off-site harmlessly. The
  client still tries GPS (longer timeout, cached fix, low-accuracy retry) but a failure no
  longer prevents check-in.
- **Everyone marked absent for a day** — the daily job must run for a *completed* day. It now
  defaults to yesterday and refuses today/future. If a bad run happened, the auto-absence
  leave is reversible: delete the `'absent'` attendance row (refunds the auto-deducted day)
  or undo via SQL filtered on `notes = 'Auto-deducted: absent without leave'`.
- **All logins return 401 / 500 at boot** — `JWT_SECRET` missing, or DB unreachable. Check
  `env.ts` boot logs.
- **Cron returns 401** — `CRON_SECRET` mismatch between Railway and GitHub.
