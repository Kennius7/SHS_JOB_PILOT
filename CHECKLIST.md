# SHS Job Pilot — Implementation Progress Checklist

Tracks delivery against the master development prompt. Status legend:
`[x]` done · `[~]` partial · `[ ]` not started · `[!]` blocked on external prerequisite.

Last audit: repository baseline after monorepo scaffold (commit `3c4237a`).

---

## Phase 1 — Repository & infrastructure audit

- [x] Inspected repository structure, packages, apps, Prisma schema, dev Docker Compose.
- [x] Confirmed build/test tooling (`turbo`, `tsc`, `vitest` in `@shs/rules`, `jest` configured in `apps/api`).
- [~] Oracle Cloud VM / reverse proxy / live deployment: **not inspected** (no access from this
      environment). Prerequisite: SSH/deployment access + existing infra details.
- [x] Produced gap analysis and prioritized plan (see below).

## Phase 2 — Foundation

- [x] Monorepo (npm workspaces + Turborepo), TypeScript strict config.
- [x] NestJS API, NestJS worker, Next.js 15 web apps.
- [x] Prisma schema (25 models) with PostgreSQL, `pg_trgm` + `unaccent`.
- [x] Redis + BullMQ wiring in API and worker.
- [x] JWT auth (access in-memory, rotating refresh cookie, Argon2id hashing).
- [x] Dev Docker Compose (postgres + redis).
- [x] Committed Prisma migrations (`prisma/migrations/20260101000000_init`).
- [x] Development seed data (`prisma/seed.ts`, guarded against production).
- [ ] Root lint/format tooling (no ESLint/Prettier config at root).
- [x] Environment validation at startup — **partial**; secrets read ad hoc, not centrally validated.

## Phase 3 — Profiles & documents

- [x] Career profile CRUD, preferences, skills, experience, education, languages.
- [x] Onboarding wizard (8 steps) with server-persisted step.
- [x] Document upload, storage service, PDF/DOCX text extraction, AI CV parsing.
- [x] Parsed-CV review + `apply-parsed` merge.
- [~] OCR for scanned PDFs — detected (`NEEDS_OCR`) but no OCR backend.
- [ ] Multiple CV versions surfaced distinctly in UI (model supports it; UI lists documents).
- [ ] Malware scanning of uploads.
- [ ] Password reset.
- [ ] Email verification (requires email provider — not configured).

## Phase 4 — Provider integrations

- [x] Provider registry + capability model + `MANUAL_LINK_ONLY` for LinkedIn/Indeed/Jobberman.
- [x] Adzuna adapter (search), mock submission provider, provider health rows.
- [x] Normalization + dedup (`canonicalKey`) + `ProviderSyncRun` accounting.
- [x] Stage 1 API providers: Jooble, Remotive, Remote OK, USAJOBS (implemented + registered via env).
- [x] Stage 2 ATS board readers: Greenhouse, Lever, Ashby (public employer-board APIs, slug-configured).
- [x] Generic `provider-sync` queue + processor (per-provider repeatable jobs, admin-triggerable for any
      search-capable provider).
- [ ] Stage 3 Nigeria/Africa providers beyond Jobberman.
- [ ] Admin provider activation UI (see Phase 7).

## Phase 5 — Job matching

- [x] Deterministic rules engine (`@shs/rules`) with hard/soft conditions + tests.
- [x] AI match scoring + cover-letter generation (`@shs/ai`).
- [x] Rule simulation endpoint (`POST /rules/simulate`).
- [x] Public search/filter API for jobs (`GET /api/v1/jobs`, `GET /api/v1/jobs/:id`).
- [x] `GET /api/v1/matches` + `GET /api/v1/matches/:jobId` (match explanation).
- [x] Saved jobs endpoints (`GET /jobs/saved`, `POST/DELETE /jobs/:id/save`).

## Phase 6 — Application automation

- [x] 14-state application state machine (`@shs/shared`) with guards.
- [x] Transitions with row locks, status events, notifications creation.
- [x] Submission orchestration, attempts, idempotency keys, retry/backoff.
- [x] Verification workflow, `UNKNOWN_OUTCOME` handling.
- [x] Automation status/pause/resume endpoints (`/automation/*`) + enforcement via `autoSubmitEnabled`.
- [ ] Browser automation adapters (`PERMITTED_BROWSER`) — not implemented.
- [ ] Fair per-user scheduling / quotas in queue processing.

## Phase 7 — Dashboard & notifications

- [x] User dashboard, jobs browser, approval queue, application tracker/detail, rules builder.
- [x] Notifications API (`/notifications`) + read/unread UI + header badge.
- [x] Admin: non-prod test controller + read-only ops API (`/admin/providers|queues|health|audit`,
      `POST /admin/providers/:key/sync`). Admin dashboard UI (`/admin`, role-gated) shows
      health cards, queue depth, provider registry with per-provider "Sync now", and a paged
      audit-log view (action filter); audit records written for logins and admin syncs.
- [x] Usage & AI cost endpoints (`GET /usage`) + settings UI.

## Phase 8 — Testing & security

- [x] Unit tests: `@shs/rules` engine.
- [x] Unit tests: `@shs/api` Jobs / Notifications / Automation services (Jest + ts-jest).
- [x] e2e smoke script (`scripts/e2e-smoke.sh`) — ad hoc, not wired to a runner.
- [ ] API/worker unit tests.
- [ ] Integration tests (Prisma, Redis/BullMQ, provider errors, auth, uploads, AI timeouts).
- [ ] Security tests (cross-tenant isolation, unauthorized admin, malicious uploads, dup submissions,
      prompt-injection resistance, secret leakage).
- [x] Multi-tenant ownership enforcement in `ApplicationsService.get` (spot-checked).

## Phase 9 — Production deployment

- [ ] `.github/workflows` (none).
- [ ] GHCR image publishing.
- [ ] Production `docker-compose` with web+api+worker+postgres+redis, private network, healthchecks.
- [ ] Dockerfiles (multi-stage, non-root) for web/api/worker.
- [ ] Oracle VM deployment scripts + reverse proxy integration.
- [ ] Backup/restore + rollback documentation.
- [ ] Observability: correlation IDs, queue-depth metrics, structured logs.

---

## Prioritized plan (next slices)

1. **Unblock core product (P0):** `apps/api` Jobs module (search/filter/detail/save), Matches,
   Notifications, `users/me`, automation status/pause/resume, usage endpoints. The web app already
   calls several of these.
2. **Reproducible dev (P0):** commit initial Prisma migration + `prisma/seed.ts`; root lint/format.
3. **Provider breadth (P1):** Stage-1 API adapters (Jooble, Remotive, Remote OK, USAJOBS) + Stage-2
   ATS readers (Greenhouse, Lever, Ashby); expand registry + capability matrix.
4. **Automation completeness (P1):** pause/resume enforcement in workers, per-user fair scheduling,
   optional permitted-browser adapter framework (no unauthorized sites).
5. **Admin surface (P2):** provider registry UI, queue/failed-jobs view, audit log view.
6. **Testing (P1/P2):** API/worker unit + integration + security test suites.
7. **Deployment (P1):** CI/CD, GHCR, prod compose, VM scripts, backups, observability.

## Known limitations / prerequisites

- No Oracle VM access — infrastructure items marked `[!]` require credentials/details.
- No provider credentials for most catalogue entries — adapters implemented as interfaces +
  configuration, documented as inactive until configured.
- Email delivery not configured — verification/reset deferred behind provider config.

---

## Session log

### P0 slice — core API surface + reproducible dev (implemented)

Fixed blocking defects and built the missing API surface the web app already called:

- **Prisma schema was invalid** (space-separated enum values) so `prisma generate` never ran.
  Reformatted all enums; schema now validates and the Prisma client generates.
- **Committed initial migration** `prisma/migrations/20260101000000_init` (generated with
  `prisma migrate diff`, no live DB required) + `migration_lock.toml`.
- **Added `prisma/seed.ts`** (idempotent, production-guarded): providers, admin + demo users,
  profile, skills, active rule, sample jobs.
- **New API modules:** Jobs (search/filter/detail/save), Matches, Notifications, Users (`/me` +
  account deletion), Automation (status/pause/resume), Usage; plus admin ops (providers/queues/health
  + sync trigger).
- **Fixed queue DI:** `@nestjs/bullmq` queue tokens are not global, so `@InjectQueue` in sibling
  modules failed at runtime. Each consuming module now registers its own queues.
- **Fixed pre-existing type errors:** `@shs/ai` `zodToJsonSchema` TS2589; worker
  `submission.processor` (`job.queue` protected, nullable cover letter, non-unique `idempotencyKey`
  update); web onboarding implicit-any.
- **Web:** real Notifications page + header badge; Settings page with account, automation
  pause/resume, AI usage, and account deletion.
- **Tests:** Jest + ts-jest config for `@shs/api`; 18 unit tests across Jobs/Notifications/Automation.

Verification: `npm run typecheck` ✅ · `npm run build` ✅ · `npm run test` ✅ (22 tests).

Not yet runtime-verified: no PostgreSQL/Redis available in this environment (Docker absent), so
migrations were not applied and the API/worker were not booted end-to-end.

### Provider breadth slice — Stage 1 APIs + ATS board readers (implemented)

- **New adapters in `@shs/provider-sdk`:** Jooble (credentialed POST API), Remotive (public, paginated),
  Remote OK (single-request feed, client-side keyword filter), USAJOBS (credentialed, header-based),
  plus employer job boards Greenhouse / Lever / Ashby (public board APIs, board-slug configured).
- **Shared normalization helpers** (`adapters/mapping.ts`): `mapEmploymentType`, `inferWorkArrangement`,
  `parseSalaryRange` — maps free-form strings like "₦400k - ₦600k monthly" to typed fields.
- **Registry:** `RegistryEnv` extended; credential-gated providers register only when credentials exist,
  public APIs register unless disabled. `buildRegistry` wires everything from env.
- **Generic sync:** replaced the adzuna-specific processor with `provider-sync` (queue renamed).
  The processor reads `job.data.providerKey`, checks availability, ingests via `canonicalKey` dedup,
  and fans out `match-recent` when new jobs arrive. Scheduler enqueues a repeatable 6-hourly job per
  search-capable provider; `POST /admin/providers/:key/sync` now works for any registered provider.
- **Seed:** provider matrix expanded to 11 search/submit rows + 3 manual-link rows, capabilities aligned
  with adapters, externalized through `.env`.
- Adapters are fetch-based and pure; verified by `tsc`/build. Runtime calls to live APIs are not
  exercised here (no credentials, no network guarantees) — they are activated by configuring `.env`.

Verification: `npm run typecheck` ✅ (13/13) · `npm run build` ✅ (8/8) · `npm run test` ✅.

Note: `extras/bootstrap-part4.sh` / `bootstrap-part5.sh` are legacy one-shot scaffolding scripts and
still describe the old `adzuna-sync` worker; they are not run as part of the build.

### Admin dashboard UI slice (implemented)

- `/admin` page at `apps/web/src/app/(app)/admin/page.tsx`, role-gated client-side to `ADMIN`
  (redirects non-admins to the dashboard; the API enforces `AdminGuard` server-side).
- Three sections fed by the existing v1 admin endpoints:
  - **Health** — per-check cards (database, redis) + provider health summary.
  - **Job queues** — waiting/active/delayed/completed/failed depth + paused state per queue.
  - **Provider registry** — access mode, search/submit capabilities, health/error, last sync,
    and a per-provider **Sync now** button (`POST /v1/admin/providers/:key/sync`), disabled for
    unconfigured providers; React Query invalidation + inline errors.
- Sidebar shows an **Admin** link only for `ADMIN` users (`(app)/layout.tsx`).

Verification: web typecheck ✅, `npm run build` ✅ (route compiled). Runtime still requires
Postgres/Redis to be running to populate health/queue/provider data.

### Audit-log slice (implemented)

- `GET /v1/admin/audit?page&limit&action` on `AdminOpsController` (AdminGuard) →
  `AdminOpsService.audit()` reads `AuditLog` (desc, includes user email) → `{items,total,page,limit}`.
- Audit writes: successful logins (`auth.login` with ip/userAgent, fire-and-forget in
  `AuthService.login`) and admin-triggered provider syncs (`admin.sync` with jobId, admin userId, ip).
- `/admin` page gains an **Audit log** section: action filter, newest-first table
  (when/user/action/target/details/IP), paged 25/ps with prev/next.

Verification: `npm run typecheck` ✅ (api + web) · `npm run test` ✅ (22) · `npm run build` ✅ (api + web).
Phase 2 admin surface (providers, queues, health, audit view) is now complete.

### Dev-run fixes (`npm run dev`)

- **API `Cannot find module dist/main`** — `apps/api/tsconfig.json` had `"incremental": true`, so a
  stale `tsconfig.build.tsbuildinfo` with missing `dist/` made `nest start --watch` / `nest build`
  skip emit. Removed `incremental` (and deleted the stray `*.tsbuildinfo`); `nest build` now always
  emits `dist/main.js`.
- **Worker `Cannot read properties of undefined (reading 'providerSync')`** — `QUEUES` was exported
  from `worker.module.ts`, while processors imported it from there; the processor → scheduler →
  worker.module import cycle left `QUEUES` undefined at decorator eval. Extracted `QUEUES` to
  `apps/worker/src/queues.ts` (no imports) and repointed `worker.module.ts` + all processors +
  scheduler at it.

Verification: api/worker typecheck ✅, both `dist/main.js` emitted ✅, worker modules import cleanly ✅.
