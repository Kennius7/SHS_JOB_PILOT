import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@shs/data';
import {
  ProfilePatchDto, PreferencePatchDto, SkillInputDto,
  ExperienceInputDto, EducationInputDto, ApplyParsedDto,
} from './dto';

@Injectable()
export class ProfileService {
  constructor(private prisma: PrismaService) {}

  async get(userId: string) {
    return this.prisma.userProfile.findUnique({
      where: { userId },
      include: {
        skills: { include: { skill: true } },
        experiences: { orderBy: { startDate: 'desc' } },
        education: { orderBy: { endDate: 'desc' } },
        preferences: true,
        languages: true,
      },
    });
  }

  async ensureExists(userId: string) {
    const existing = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.userProfile.create({
      data: {
        userId,
        targetRoles: [],
        onboardingStep: 'welcome',
        preferences: { create: {} },
      },
    });
  }

  async patch(userId: string, dto: ProfilePatchDto) {
    await this.ensureExists(userId);
    return this.prisma.userProfile.update({
      where: { userId },
      data: { ...dto, version: { increment: 1 } },
    });
  }

  async patchPreferences(userId: string, dto: PreferencePatchDto) {
    await this.ensureExists(userId);
    const profile = await this.prisma.userProfile.findUniqueOrThrow({ where: { userId } });
    return this.prisma.$transaction(async (tx) => {
      const prefs = await tx.careerPreference.upsert({
        where: { profileId: profile.id },
        create: { profileId: profile.id, ...dto },
        update: dto,
      });
      await tx.userProfile.update({
        where: { userId },
        data: { version: { increment: 1 } },
      });
      return prefs;
    });
  }

  async setSkills(userId: string, skills: SkillInputDto[]) {
    await this.ensureExists(userId);
    const profile = await this.prisma.userProfile.findUniqueOrThrow({ where: { userId } });
    return this.prisma.$transaction(async (tx) => {
      const skillRows = await Promise.all(
        skills.map((s) =>
          tx.skill.upsert({
            where: { name: s.name.trim() },
            create: { name: s.name.trim() },
            update: {},
          }),
        ),
      );
      await tx.userSkill.deleteMany({ where: { profileId: profile.id } });
      await tx.userSkill.createMany({
        data: skills.map((s, i) => ({
          profileId: profile.id,
          skillId: skillRows[i].id,
          level: s.level ?? null,
          yearsUsed: s.yearsUsed ?? null,
        })),
        skipDuplicates: true,
      });
      await tx.userProfile.update({
        where: { userId },
        data: { version: { increment: 1 } },
      });
      return tx.userSkill.findMany({
        where: { profileId: profile.id },
        include: { skill: true },
      });
    });
  }

  async setExperience(userId: string, entries: ExperienceInputDto[]) {
    await this.ensureExists(userId);
    const profile = await this.prisma.userProfile.findUniqueOrThrow({ where: { userId } });
    return this.prisma.$transaction(async (tx) => {
      await tx.experience.deleteMany({ where: { profileId: profile.id } });
      if (entries.length) {
        await tx.experience.createMany({
          data: entries.map((e) => ({
            profileId: profile.id,
            title: e.title,
            employer: e.employer,
            startDate: e.startDate ? new Date(e.startDate) : null,
            endDate: e.endDate ? new Date(e.endDate) : null,
            isCurrent: e.isCurrent ?? !e.endDate,
            description: e.description ?? null,
            highlights: e.highlights ?? [],
          })),
        });
      }
      await tx.userProfile.update({
        where: { userId },
        data: { version: { increment: 1 } },
      });
      return tx.experience.findMany({
        where: { profileId: profile.id },
        orderBy: { startDate: 'desc' },
      });
    });
  }

  async setEducation(userId: string, entries: EducationInputDto[]) {
    await this.ensureExists(userId);
    const profile = await this.prisma.userProfile.findUniqueOrThrow({ where: { userId } });
    return this.prisma.$transaction(async (tx) => {
      await tx.education.deleteMany({ where: { profileId: profile.id } });
      if (entries.length) {
        await tx.education.createMany({
          data: entries.map((e) => ({
            profileId: profile.id,
            institution: e.institution,
            degree: e.degree ?? null,
            field: e.field ?? null,
            startDate: e.startDate ? new Date(e.startDate) : null,
            endDate: e.endDate ? new Date(e.endDate) : null,
          })),
        });
      }
      await tx.userProfile.update({
        where: { userId },
        data: { version: { increment: 1 } },
      });
      return tx.education.findMany({ where: { profileId: profile.id } });
    });
  }

  async applyParsed(userId: string, dto: ApplyParsedDto) {
    const doc = await this.prisma.document.findUnique({ where: { id: dto.documentId } });
    if (!doc || doc.userId !== userId) throw new NotFoundException('Document not found');
    if (!doc.parsedData) throw new BadRequestException('Document has not been parsed yet');

    const parsed = doc.parsedData as any;
    const accepted = new Set(
      dto.acceptedSections ?? ['contact', 'skills', 'experience', 'education', 'summary'],
    );
    await this.ensureExists(userId);

    const profileFields: any = {};
    if (accepted.has('contact')) {
      if (parsed.fullName) profileFields.fullName = parsed.fullName;
      if (parsed.phone) profileFields.phone = parsed.phone;
    }
    if (accepted.has('summary') && parsed.summary) profileFields.summary = parsed.summary;

    await this.prisma.$transaction(async (tx) => {
      await tx.userProfile.update({
        where: { userId },
        data: { ...profileFields, ...(dto.profile ?? {}), version: { increment: 1 } },
      });

      if (accepted.has('skills')) {
        const skills = dto.skills ?? (parsed.skills ?? []).map((name: string) => ({ name }));
        if (skills.length) {
          const skillRows = await Promise.all(
            skills.map((s: any) =>
              tx.skill.upsert({
                where: { name: s.name },
                create: { name: s.name },
                update: {},
              }),
            ),
          );
          const profile = await tx.userProfile.findUniqueOrThrow({ where: { userId } });
          await tx.userSkill.deleteMany({ where: { profileId: profile.id } });
          await tx.userSkill.createMany({
            data: skills.map((s: any, i: number) => ({
              profileId: profile.id,
              skillId: skillRows[i].id,
              level: s.level ?? null,
              yearsUsed: s.yearsUsed ?? null,
            })),
          });
        }
      }

      if (accepted.has('experience')) {
        const entries = dto.experience ?? parsed.experience ?? [];
        if (entries.length) {
          const profile = await tx.userProfile.findUniqueOrThrow({ where: { userId } });
          await tx.experience.deleteMany({ where: { profileId: profile.id } });
          await tx.experience.createMany({
            data: entries.map((e: any) => ({
              profileId: profile.id,
              title: e.title,
              employer: e.employer,
              startDate: e.startDate ? new Date(e.startDate) : null,
              endDate: e.endDate ? new Date(e.endDate) : null,
              isCurrent: !e.endDate,
              highlights: e.highlights ?? [],
            })),
          });
        }
      }

      if (accepted.has('education')) {
        const entries = dto.education ?? parsed.education ?? [];
        if (entries.length) {
          const profile = await tx.userProfile.findUniqueOrThrow({ where: { userId } });
          await tx.education.deleteMany({ where: { profileId: profile.id } });
          await tx.education.createMany({
            data: entries.map((e: any) => ({
              profileId: profile.id,
              institution: e.institution,
              degree: e.degree ?? null,
              field: e.field ?? null,
            })),
          });
        }
      }
    });

    return this.get(userId);
  }

  async setOnboardingStep(userId: string, step: string) {
    await this.ensureExists(userId);
    return this.prisma.userProfile.update({
      where: { userId },
      data: { onboardingStep: step },
    });
  }

  async completeOnboarding(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      include: { preferences: true, skills: true },
    });
    if (!profile) throw new BadRequestException('Profile not created');
    if (!profile.fullName) throw new BadRequestException('Full name is required');
    if (!profile.targetRoles?.length) throw new BadRequestException('At least one target role is required');
    if (!profile.skills?.length) throw new BadRequestException('At least one skill is required');
    if (!profile.preferences) throw new BadRequestException('Preferences are required');

    const ruleCount = await this.prisma.applicationRule.count({
      where: { userId, isActive: true },
    });
    if (ruleCount === 0) throw new BadRequestException('An active rule is required');

    return this.prisma.userProfile.update({
      where: { userId },
      data: {
        onboardingCompletedAt: new Date(),
        onboardingStep: 'done',
      },
    });
  }
}
