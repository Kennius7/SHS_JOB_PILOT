# SHS Job Pilot

Automated job discovery, matching, and application platform. Nigeria-focused.

## Stack

- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind, TanStack Query
- **Backend:** NestJS, Prisma, PostgreSQL
- **Queue:** Redis + BullMQ
- **AI:** Gemini (via `@google/genai`)
- **Providers:** Adzuna (Nigerian jobs). LinkedIn, Indeed, and Jobberman are
  supported as **manual-application sources only** — their terms of service
  prohibit automated scraping and submission.

## Quick start

```bash
cp .env.example .env
# Edit .env — set JWT_SECRET and SESSION_SECRET to random 48-byte strings.
# Leave AI_API_KEY blank to run in mock mode.

npm install
docker compose up -d
npm run prisma: migrate dev --name init
npm run dev
