# SHS Job Pilot

Automated job discovery, matching, and application platform. Nigeria-focused.

It aggregates jobs, scores them against a user's profile using deterministic
rules plus AI, generates tailored materials, and — where legally permitted —
submits applications automatically.

## Stack

- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind, TanStack Query
- **Backend:** NestJS, Prisma, PostgreSQL
- **Queue:** Redis + BullMQ
- **AI:** Gemini (via `@google/genai`)
- **Providers:** Adzuna (Nigerian jobs). LinkedIn, Indeed, and Jobberman are
  supported as **manual-application sources only** — their terms of service
  prohibit automated scraping and submission.

## Architecture

npm workspaces + Turborepo monorepo. Three applications share five workspace
packages, backed by PostgreSQL and Redis.

```
apps/
  web/      Next.js 15 (App Router) UI                     :3000
  api/      NestJS REST API (auth, profile, documents)     :3001
  worker/   NestJS background worker (BullMQ processors)
packages/
  shared/        Application lifecycle state machine (14 states)
  rules/         Deterministic eligibility engine (Zod schemas)
  ai/            Gemini adapter + USD budget guardrails
  email/         Pluggable email transports (console/memory/smtp/none)
  provider-sdk/  Job-source contracts + Adzuna/Jooble/Remotive/RemoteOK/USAJOBS +
                 Greenhouse/Lever/Ashby board adapters
  data/          Prisma + NestJS services (persistence/orchestration)
prisma/schema.prisma   Full data model
```

### Application pipeline (BullMQ queues)

1. **`provider-sync`** — every 6 hours, pulls listings from every configured,
   search-capable provider (one repeatable job per provider key), dedupes by
   `canonicalKey`, then fans out `match-recent` per active user.
2. **`match-recent`** — evaluates up to 500 jobs per user with the `@shs/rules`
   engine against the user's single active rule, creates `Application` rows,
   and enqueues `prepare-application`.
3. **`prepare-application`** — scores the match with AI (`@shs/ai`), decides
   eligible / review / ineligible, generates a cover letter, then auto-queues
   submission, marks `MANUAL_APPLICATION_REQUIRED`, or waits in
   `AWAITING_APPROVAL` for user approval.
4. **`application-submission`** — idempotent submission via the provider
   (3 attempts with backoff), then enqueues delayed verification.
5. **`application-verification`** — confirms the outcome → `CONFIRMED`,
   `FAILED`, or retries via `UNKNOWN_OUTCOME`.

## Applications

### `apps/api`

REST API. JWT auth (in-memory access token, HttpOnly refresh cookie, Argon2id
hashing) with email verification and password reset (single-use hashed tokens),
profile/onboarding CRUD, document upload with CV text extraction
(`pdf-parse` / `mammoth`) and AI parsing, application-rule CRUD plus simulation,
and application approve/skip/verify. Swagger at `/api/docs`. Non-production-only
admin test endpoints back the e2e smoke script.

### `apps/worker`

Context-only Nest app (no HTTP listener). Runs the five processors above plus a
cron scheduler, owns the provider registry (`buildRegistry`), and tracks
provider health.

### `apps/web`

Authenticated UI with client-side route guards:

- Dashboard with application-state summary
- Job browser and job detail
- **Approval queue** (Approve / Skip) and application detail with live polling
- Document upload and extraction-status management
- Deterministic rule builder with simulation
- 8-step onboarding wizard (CV upload → parse → contact → career → skills →
  preferences → rules → done)

`settings` (account, automation controls, AI usage) and `notifications` (inbox +
unread badge) render real API data. Public auth pages cover the email flows:
`/verify-email`, `/forgot-password`, and `/reset-password`.

## Packages

- **`@shs/shared`** — the canonical `ApplicationState` state machine and
  transition guards. No dependencies.
- **`@shs/rules`** — Zod-validated job-eligibility engine. Hard conditions gate
  eligibility; soft conditions produce `ELIGIBLE` or `REVIEW`. Ships vitest
  tests.
- **`@shs/ai`** — provider-agnostic AI abstraction over Gemini with strict
  Zod structured output, prompt-injection hardening, and per-user/platform USD
  budget caps. Mocks when no key is configured.
- **`@shs/email`** — small `EmailSender` interface with `console` (dev),
  `memory` (tests), `smtp` (nodemailer), and `none` transports, selected via
  `EMAIL_PROVIDER`. Used by the API to send verification and reset emails.
- **`@shs/provider-sdk`** — zero-dependency contracts for job providers
  (search, details, submission, verification). Ships adapters for Adzuna,
  Jooble, Remotive, Remote OK, and USAJOBS plus Greenhouse / Lever / Ashby
  employer job boards, along with a mock submission provider for pipeline
  tests. Encodes access modes, including `MANUAL_LINK_ONLY` for
  terms-restricted sites (LinkedIn, Indeed, Jobberman).
- **`@shs/data`** — global NestJS module wrapping Prisma and exposing
  `TransitionsService` (row-locked atomic transitions), `ApplicationsService`
  (submission guards: caps, duplicates, automation flags, provider capability),
  and `AiService`.

## Data model

`prisma/schema.prisma` defines ~25 models covering users and sessions, career
profiles (experience, education, skills, languages, preferences), documents,
providers and sync runs, jobs and skills, matches, rules and evaluations,
applications (attempts, materials, status events), and notifications, audit
logs, usage records, and settings. Uses the `pg_trgm` and `unaccent` extensions
and Postgres full-text search.

## Quick start

```bash
cp .env.example .env
# Edit .env — set JWT_SECRET and SESSION_SECRET to random 48-byte strings.
# Leave AI_API_KEY blank to run in mock mode.
# Email defaults to EMAIL_PROVIDER=console (prints messages to the API log).

npm install
docker compose up -d
npm run prisma:deploy   # apply committed migrations
npm run db:seed         # optional: demo users, profile, rule, sample jobs
npm run dev
```

The seed creates `admin@example.com` and `demo@example.com` (password `Password123!`,
override with `SEED_PASSWORD`). It refuses to run when `NODE_ENV=production`.

## Scripts

Root (Turbo-powered):

| Command | Description |
| --- | --- |
| `npm run dev` | Run all apps in parallel |
| `npm run build` | Build all workspaces |
| `npm run lint` | Lint all workspaces |
| `npm run typecheck` | Typecheck all workspaces |
| `npm run test` | Run tests |
| `npm run test:e2e` | Run e2e tests |
| `npm run test:integration --workspace=@shs/api` | Run the API integration/security suite (needs Postgres + Redis) |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Create/apply a dev migration |
| `npm run prisma:deploy` | Apply migrations (production) |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run db:seed` | Seed the database |

## Configuration

See `.env.example` for the full list. Key variables:

- **Runtime:** `NODE_ENV`, `APP_URL`, `WEB_URL`, `API_URL`
- **Database:** `DATABASE_URL`
- **Redis:** `REDIS_URL`
- **Auth:** `JWT_SECRET`, `SESSION_SECRET`, `JWT_ACCESS_TTL`,
  `REFRESH_TOKEN_TTL_DAYS`, `COOKIE_SECURE` (defaults to `NODE_ENV === "production"`;
  set `false` when serving over plain HTTP)
- **AI:** `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_MOCK_MODE`,
  `AI_MONTHLY_BUDGET_USD`, `AI_PER_USER_MONTHLY_BUDGET_USD`
- **Documents:** `DOCUMENT_STORAGE_PATH`, `MAX_UPLOAD_SIZE_MB`
- **Email:** `EMAIL_PROVIDER` (`console` | `memory` | `smtp` | `none`),
  `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`
- **CORS:** `CORS_ORIGINS`
- **Providers:** `PROVIDER_ADZUNA_ENABLED`, `PROVIDER_ADZUNA_APP_ID`,
  `PROVIDER_ADZUNA_APP_KEY`, `PROVIDER_ADZUNA_COUNTRY`

## Testing

- **Unit** (`npm run test`): `@shs/rules` engine (vitest) and the `@shs/api`
  Jobs / Notifications / Automation services (Jest + ts-jest).
- **Integration & security** (`npm run test:integration --workspace=@shs/api`):
  a dedicated Nest test app (`apps/api/test`) runs against a real Postgres +
  Redis. It points at a `*_test` database and Redis DB 1 (derived from `.env`,
  or set `TEST_DATABASE_URL` / `TEST_REDIS_URL`), applies migrations, and
  truncates tables between tests. Covers the auth/email flows (register →
  verify → resend, forgot → reset → session revocation, no account
  enumeration) and security (cross-tenant isolation, admin authorization,
  malicious uploads, duplicate-submission idempotency, mass-assignment,
  forged tokens, and secret leakage).

## CI/CD & deployment

- **CI** (`.github/workflows/ci.yml`): a `verify` job (install → `prisma
  generate` → typecheck → unit tests → build) and an `integration` job that
  spins up Postgres + Redis services and runs the integration suite.
- **Publishing** (`.github/workflows/publish.yml`): builds and pushes the
  `api`, `worker`, and `web` images to GHCR on `v*` tags (or manual dispatch,
  tagged `dev`).
- **Images** (`docker/Dockerfile`): multi-stage with `api` / `worker` / `web`
  targets, driven by a root `turbo run build`.
- **Production** (`docker-compose.prod.yml`): `web` (published), `api`,
  `worker`, `postgres`, and `redis` on a private network with healthchecks.

## Design notes

- **Legal safety:** terms-restricted providers (LinkedIn, Indeed, Jobberman)
  are `MANUAL_LINK_ONLY`; only Adzuna (`PUBLIC_API`) is automated.
- **Correctness:** canonical dedupe keys, idempotency keys on submissions,
  row-level locks on state transitions, and retry/backoff policies.
- **AI guardrails:** fabricated-qualification ban, `<UNTRUSTED>` prompt
  injection neutralization, Zod-validated structured output, and per-user /
  platform monthly spend caps.
