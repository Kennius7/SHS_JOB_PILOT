/**
 * Development seed data for SHS Job Pilot.
 *
 * Safe to run repeatedly (all writes are upserts). Refuses to run against a
 * production database so it can never create demo accounts or fake jobs there.
 *
 *   npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

function assertNotProduction() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database (NODE_ENV=production).');
  }
}

async function seedProviders() {
  const adzunaConfigured = !!(process.env.PROVIDER_ADZUNA_APP_ID && process.env.PROVIDER_ADZUNA_APP_KEY);

  await prisma.jobProvider.upsert({
    where: { key: 'adzuna' },
    update: { configured: adzunaConfigured },
    create: {
      key: 'adzuna',
      displayName: 'Adzuna',
      accessMode: 'PUBLIC_API',
      enabled: process.env.PROVIDER_ADZUNA_ENABLED !== 'false',
      configured: adzunaConfigured,
      capabilities: {
        searchJobs: true,
        retrieveJobDetails: false,
        submitApplications: false,
        verifySubmission: false,
        supportsPagination: true,
        requiresCredentials: true,
        requiresEmployerAuthorization: false,
        accessMode: 'PUBLIC_API',
      },
    },
  });

  await prisma.jobProvider.upsert({
    where: { key: 'mock-submission' },
    update: {},
    create: {
      key: 'mock-submission',
      displayName: 'Mock Submission Provider (dev only)',
      accessMode: 'AUTHORIZED_API',
      enabled: true,
      configured: true,
      capabilities: {
        searchJobs: false,
        retrieveJobDetails: false,
        submitApplications: true,
        verifySubmission: true,
        supportsPagination: false,
        requiresCredentials: false,
        requiresEmployerAuthorization: false,
        accessMode: 'AUTHORIZED_API',
      },
    },
  });

  const manual = [
    { key: 'linkedin', displayName: 'LinkedIn Jobs' },
    { key: 'indeed', displayName: 'Indeed' },
    { key: 'jobberman', displayName: 'Jobberman Nigeria' },
  ];
  for (const p of manual) {
    await prisma.jobProvider.upsert({
      where: { key: p.key },
      update: {},
      create: {
        key: p.key,
        displayName: p.displayName,
        accessMode: 'MANUAL_LINK_ONLY',
        enabled: true,
        configured: true,
        capabilities: {
          searchJobs: false,
          retrieveJobDetails: false,
          submitApplications: false,
          verifySubmission: false,
          supportsPagination: false,
          requiresCredentials: false,
          requiresEmployerAuthorization: true,
          accessMode: 'MANUAL_LINK_ONLY',
        },
      },
    });
  }

  console.log('  providers: adzuna, mock-submission, linkedin, indeed, jobberman');
}

async function seedUsers() {
  const password = process.env.SEED_PASSWORD ?? 'Password123!';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: { email: 'admin@example.com', passwordHash, role: 'ADMIN', emailVerified: new Date() },
  });

  const demo = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: { email: 'demo@example.com', passwordHash, role: 'USER', emailVerified: new Date() },
  });

  console.log(`  users: ${admin.email} (ADMIN), ${demo.email} (USER) — password: ${password}`);
  return demo;
}

async function seedProfile(userId: string) {
  const profile = await prisma.userProfile.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      fullName: 'Demo Candidate',
      phone: '+2348000000000',
      country: 'NG',
      state: 'LAGOS',
      city: 'Lagos',
      currentRole: 'Software Engineer',
      targetRoles: ['Backend Engineer', 'Full Stack Engineer'],
      yearsExperience: 4,
      summary: 'Backend engineer with experience building Node.js and TypeScript services.',
      onboardingCompletedAt: new Date(),
      onboardingStep: 'done',
    },
  });

  await prisma.careerPreference.upsert({
    where: { profileId: profile.id },
    update: {},
    create: {
      profileId: profile.id,
      preferredStates: ['LAGOS', 'FCT'],
      remoteOnly: false,
      hybridAllowed: true,
      onsiteAllowed: true,
      salaryFloor: 400000,
      salaryCurrency: 'NGN',
      employmentTypes: ['FULL_TIME'],
      preferredIndustries: [],
      excludedIndustries: [],
      excludedCompanies: [],
      minMatchScore: 70,
      autoSubmitEnabled: false,
      coverLetterAutoGen: true,
      cvTailoringAllowed: false,
    },
  });

  const skillNames = ['TypeScript', 'Node.js', 'PostgreSQL', 'NestJS', 'React'];
  for (const name of skillNames) {
    const skill = await prisma.skill.upsert({
      where: { name },
      update: {},
      create: { name, category: 'Engineering' },
    });
    await prisma.userSkill.upsert({
      where: { profileId_skillId: { profileId: profile.id, skillId: skill.id } },
      update: {},
      create: { profileId: profile.id, skillId: skill.id, level: 4, yearsUsed: 3 },
    });
  }

  await prisma.applicationRule.upsert({
    where: { id: 'seed-rule-demo' },
    update: {},
    create: {
      id: 'seed-rule-demo',
      userId,
      name: 'Engineering roles in Lagos / Abuja',
      isActive: true,
      version: 1,
      conditions: {
        hard: [
          { type: 'STATE_IN', states: ['LAGOS', 'FCT'] },
          { type: 'EMPLOYER_NOT_IN', employers: [] },
        ],
        soft: {
          conditions: [
            { type: 'TITLE_MATCHES', patterns: ['engineer', 'developer'] },
            { type: 'REQUIRED_SKILLS_PRESENT', skills: ['TypeScript'], minOverlap: 1 },
          ],
          minPassRatio: 0.5,
        },
        minMatchScore: 70,
      },
    },
  });

  console.log('  profile, preferences, 5 skills, 1 active rule');
  return profile.id;
}

async function seedJobs() {
  const jobs = [
    {
      canonicalKey: 'seed-adzuna-backend-1',
      externalId: 'seed-backend-1',
      title: 'Backend Engineer (Node.js)',
      employer: 'Acme Technologies',
      city: 'Lagos',
      state: 'LAGOS' as const,
      workArrangement: 'HYBRID' as const,
      employmentType: 'FULL_TIME' as const,
      salaryMin: 500000,
      salaryMax: 800000,
      description: 'Design and build scalable Node.js services. Hybrid role in Lagos.',
      requiredSkills: ['TypeScript', 'Node.js', 'PostgreSQL'],
      preferredSkills: ['NestJS'],
    },
    {
      canonicalKey: 'seed-adzuna-fullstack-1',
      externalId: 'seed-fullstack-1',
      title: 'Full Stack Engineer',
      employer: 'Bravo Labs',
      city: 'Abuja',
      state: 'FCT' as const,
      workArrangement: 'REMOTE' as const,
      employmentType: 'FULL_TIME' as const,
      salaryMin: 600000,
      salaryMax: 1000000,
      description: 'Build React front ends and NestJS APIs. Fully remote within Nigeria.',
      requiredSkills: ['React', 'TypeScript'],
      preferredSkills: ['NestJS', 'PostgreSQL'],
    },
    {
      canonicalKey: 'seed-adzuna-data-1',
      externalId: 'seed-data-1',
      title: 'Data Analyst',
      employer: 'Charlie Analytics',
      city: 'Port Harcourt',
      state: 'RIVERS' as const,
      workArrangement: 'ONSITE' as const,
      employmentType: 'FULL_TIME' as const,
      salaryMin: 350000,
      salaryMax: 500000,
      description: 'Analyse operational data and build dashboards.',
      requiredSkills: ['SQL'],
      preferredSkills: ['Python'],
    },
  ];

  for (const job of jobs) {
    await prisma.job.upsert({
      where: { canonicalKey: job.canonicalKey },
      update: { lastSeenAt: new Date() },
      create: {
        ...job,
        providerKey: 'adzuna',
        country: 'NG',
        salaryCurrency: 'NGN',
        salaryPeriod: 'MONTH',
        sourceUrl: `https://example.test/jobs/${job.externalId}`,
        applyUrl: `https://example.test/jobs/${job.externalId}/apply`,
        status: 'ACTIVE',
        attribution: 'Jobs by Adzuna',
        discoveredBy: 'seed',
      },
    });
  }

  console.log(`  jobs: ${jobs.length} active sample listings`);
}

async function main() {
  assertNotProduction();
  console.log('Seeding SHS Job Pilot (development)...');
  await seedProviders();
  const demo = await seedUsers();
  await seedProfile(demo.id);
  await seedJobs();
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
