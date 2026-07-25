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

**A valid signature is not enough.** Tokens carry a `tv` (token version) claim checked
against the database on every authenticated request (`src/lib/token-version.ts`). Bumping
`token_version` instantly invalidates every token issued before it, which is what makes
password resets and deactivation actually end sessions — previously an offboarded employee
kept access for up to 12h until the JWT expired. Deactivated or deleted identities are
rejected immediately, and the check **fails closed** if the DB is unreachable.

The one exception is the **bootstrap admin**: `authenticate()` issues a token for username
`admin` backed by `ADMIN_PASSWORD` when `admin_users` is still empty, so there is no row to
version-check. That case is allowed explicitly (and only for that username, and only while
`ADMIN_PASSWORD` is set) — otherwise an admin would be locked out of a fresh deployment.
Covered by `tests/integration/authorization.itest.ts`.

**Health:** `GET /api/health` is unauthenticated and checks Postgres, returning 503 when
the database is unreachable and reporting the applied `schemaVersion` — useful for
confirming a deploy actually migrated. Point an uptime monitor at it.

## 3. Domain model (tables)

`settings` (singleton, fiscal year + work schedule + geofence) · `departments` ·
`employees` (incl. `username`, `password_hash`, `must_change_password`, `leave_balance`) ·
`leave_types` · `leave_requests` · `tardiness_log` · `attendance` · `holidays` ·
`permissions` (temporary mid-day exit) · `admin_users` · `audit_log` ·
`employee_notifications` · `rate_limits` · `schema_migrations`.

TypeScript shapes: `src/lib/types.ts`. There are **no money columns** — payroll was removed
by product decision and the leftover `deduction_per_hour` / `currency` / `currency_symbol`
columns were dropped in migration `0010` (along with `tardiness_log.hours_late_decimal`,
which merely duplicated `minutes_late / 60`).

Work schedules resolve **employee → department → global `settings`**: `departments` and
`employees` both carry nullable `work_start_time` / `work_days` / `work_hours_per_day`, and
NULL means "inherit". `src/lib/schedule.ts` (`resolveSchedule`, `resolveScheduleMap`) is the
single place that chain is applied — important because tardiness costs annual leave, so
measuring someone against the wrong start time now costs them real days.

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
- **Tardiness** — minutes late vs `work_start_time`; feeds the commitment ranking. Late
  minutes also **deduct annual leave proportionally** (`src/lib/tardiness-penalty.ts`): a full
  workday of lateness = 1 leave day. A **grace period** is forgiven first
  (`TARDINESS_PENALTY_GRACE_MINUTES`, default 10) — only minutes beyond it are charged, so a
  late arrival within 10 min costs nothing (still recorded for punctuality). The deduction is
  applied when the tardiness row is created (manual add + nightly automation), stored on the
  row as `leave_deducted`, and refunded if the row is deleted. Balance may go negative.
  Toggle the whole penalty with `TARDINESS_DEDUCTS_LEAVE` in `constants.ts`. (No monetary
  deduction — money was removed.)
- **Permissions** — temporary exits, admin-approved, auto-closed at day end.
- **Leave forecast** — `src/lib/leave-forecast.ts` + `/api/leave-forecast`, surfaced on the
  employee portal's apply-leave tab. Projects the balance to year end: pending requests are
  subtracted (not yet deducted), approved leave is **not** (approval already deducted it),
  and the tardiness burn rate is extrapolated across the remaining year. Because the reset
  is a clean slate, it states how many days **expire** if unused.
- **Public holidays** — `src/lib/oman-holidays.ts` + `/api/holidays/seed` seeds a year from
  Settings. Fixed Gregorian dates (Accession, Renaissance, National Day) are exact; the lunar
  ones (Eid al-Fitr/Adha, Arafah, Islamic New Year, Mawlid, Isra & Mi'raj) are computed from
  the Umm al-Qura calendar and flagged `estimated`, because the real dates come from official
  moon sighting. Seeding **never overwrites an existing date**, so it is safe to re-run after
  the official announcement to fill gaps without losing corrections.
- **Automation** — `src/lib/automation.ts`:
  - `runDailyAutomation` processes the **previous completed day** (`omanYesterday()`), and
    only marks absent for days strictly before today. It marks no-shows absent, auto-deducts
    one annual day for unexcused absence (reversible — see `src/lib/auto-absence.ts`), logs
    tardiness, **auto-closes forgotten check-outs** at the official end-of-day time (hours/OT
    computed, note `[Auto checkout]`), and closes stale permissions. Every charge
    (tardiness deduction, absence deduction, auto checkout) sends the employee an **in-app
    notification** (`src/lib/employee-notify.ts`). **Idempotent.**
  - `runYearlyReset` resets balances + advances the fiscal year; fires once at year-end
    (guarded by `last_reset_year`). **Idempotent.**
  - **Every run is journalled and reversible** — `src/lib/automation-journal.ts`. Each
    mutation is written to `automation_effects` with the row id and its prior values, so
    **Settings → Automation → history → Undo** puts everything back: absences removed,
    leave days refunded, auto check-outs reopened, a yearly reset's balances and fiscal
    year restored. This exists because a run once marked all 14 employees absent and the
    cleanup was hand-written SQL against production. Undo is conditional on each row still
    looking the way the automation left it — **undoing the robot never undoes a human's
    later edit** — and a run can only be undone once.
- **Balance policy (owner decisions, 2026-06):** (a) the yearly reset is a **clean slate** —
  every active employee returns to the configured annual balance, and any negative balance
  (tardiness/absence debt) is forgiven, deliberately; (b) **employees with balance ≤ 0
  cannot SUBMIT new leave requests** (blocked at POST with a bilingual error); (c) admins
  are never hard-stopped — approving or extending a leave may take the balance (further)
  negative, and the admin sees the resulting balance (warning toast + `balance_after` in
  the approve response).

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
`migrate.ts` + `db/migrations/*.sql` (versioned runner) · `env.ts` (boot validation,
fail-fast in prod) · `log.ts` (JSON logging) · `rate-limit.ts` (Postgres-backed, survives
deploys) · `jwt.ts` · `audit.ts` · `email.ts` · `api.ts` (typed client) ·
`query-keys.ts` (`qk.*` factory) · `schedule.ts` (employee→department→global work schedule) ·
`leave-forecast.ts` · `oman-holidays.ts` · `tardiness-penalty.ts`.

**Error visibility:** `onRequestError` in `src/instrumentation.ts` is Next's global
server-error hook; it persists every captured error to `error_log`, viewable at
**Settings → Error log**. Before this, a production 500 only reached stdout and was
invisible unless someone happened to be tailing Railway logs at that moment.

Request validation: `src/server/schemas.ts` + `src/server/validation.ts` (zod at write
boundaries). Business logic that mutates balances lives in `src/server/services/*`
(`leave-service`, `correction-service`, `holiday-service`) and returns a `ServiceResult`,
which routes hand to `respond()` — so the same logic is callable from tests without HTTP.

### Translations

All UI strings live in `src/lib/translations.ts` and are read via `useT()` → `t('key')`.
Do **not** add new `lang === 'ar' ? '…' : '…'` ternaries.

Sentences containing values use placeholders — `t('balanceLow', { name, days })` against
`'{name} balance low ({days} days)'`. The placeholder sits **inside** the translated
string rather than being concatenated around it, because Arabic and English order the
words differently. An unknown placeholder is left visible (`{missing}`) instead of
rendering "undefined". A test asserts both languages of a key declare the same
placeholders.

## 7. Schema & migrations

`db/migrations/0001_baseline.sql` is the **canonical, idempotent** schema; later numbered
files add to it. Apply with **`npm run migrate`** (local/CI/deploy). Migrations also run
**at server boot by default** — set `RUN_MIGRATIONS_AT_BOOT=false` to opt out.

`db/migrations/` is the **single source of truth** for schema. There used to be a second
mechanism — `ensure-schema.ts` — that issued `CREATE TABLE`/`ALTER TABLE` lazily on request
paths to self-heal un-migrated databases. It was removed (migration `0009`) because two
sources of schema truth is exactly the drift problem the runner exists to solve, and the
DDL ran on hot request paths. **Consequence: the schema must be migrated before the app
serves traffic.** Boot migrations default to on so this holds automatically.

Recent migrations worth knowing about:

| Migration | What it does |
| --- | --- |
| `0008_per_entity_schedules` | Nullable schedule columns on `departments` / `employees` |
| `0009_uniqueness_guards` | Adopts the last indexes the self-heal owned. **Dedupes first** — and refunds the leave charged by duplicate `tardiness_log` rows before removing them |
| `0010_drop_money_columns` | Drops the dead payroll columns |
| `0011_audit_log_indexes` | Indexes `audit_log` by `created_at` / `action` for server-side filtering |
| `0012_automation_journal` | `automation_runs` + `automation_effects` (undo), and `error_log` |
| `0013_token_revocation` | `token_version` on `employees` / `admin_users` — makes sessions revocable |

Historical/legacy SQL (`supabase/migrations/*`, `railway-migration.sql`) predates the runner
and is kept for reference only.

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
npm test                  # vitest — pure logic: leave, tardiness penalty, geo, forecast, holidays
npm run test:integration  # vitest against a REAL Postgres; skipped unless TEST_DATABASE_URL is set
npx next build
```

## 9. Environment variables (`.env.example`)

- **`DATABASE_URL`** (preferred) or `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`
- **`JWT_SECRET`** — required, ≥32 random chars (signs both cookies)
- **`ADMIN_PASSWORD`** — bootstrap `admin` login; only usable while `admin_users` is empty
- `APP_URL` / `ALLOWED_ORIGINS` — cross-origin allowlist for `/api/*`
- `CRON_SECRET` — enables the scheduled automation endpoints
- `RUN_MIGRATIONS_AT_BOOT` — apply migrations on startup (**default true**; set `false` to opt out)
- `SMTP_HOST/PORT/USER/PASS`, `NOTIFY_EMAIL` — optional email notifications

## 10. Deploy checklist (Railway)

1. `npm run migrate` against the database (or rely on boot migrations, which are on by
   default). This is **no longer optional** — there is no per-request self-heal to paper over
   a schema that was never migrated. If `RUN_MIGRATIONS_AT_BOOT=false` is set in the
   environment, run the migration step yourself before the new code serves traffic.
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
