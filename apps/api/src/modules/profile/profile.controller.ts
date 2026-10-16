import { Controller, Get, Post, Patch, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfileService } from './profile.service';
import {
  ProfilePatchDto,
  PreferencePatchDto,
  SkillInputDto,
  ExperienceInputDto,
  EducationInputDto,
  ApplyParsedDto,
  OnboardingStepDto,
} from './dto';

@ApiTags('profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'profile', version: '1' })
export class ProfileController {
  constructor(private profile: ProfileService) {}

  @Get()
  async get(@Req() req: any) {
    await this.profile.ensureExists(req.user.userId);
    return this.profile.get(req.user.userId);
  }

  @Patch()
  patch(@Req() req: any, @Body() dto: ProfilePatchDto) {
    return this.profile.patch(req.user.userId, dto);
  }

  @Patch('preferences')
  patchPreferences(@Req() req: any, @Body() dto: PreferencePatchDto) {
    return this.profile.patchPreferences(req.user.userId, dto);
  }

  @Post('skills')
  setSkills(@Req() req: any, @Body() body: { skills: SkillInputDto[] }) {
    return this.profile.setSkills(req.user.userId, body.skills);
  }

  @Post('experience')
  setExperience(@Req() req: any, @Body() body: { entries: ExperienceInputDto[] }) {
    return this.profile.setExperience(req.user.userId, body.entries);
  }

  @Post('education')
  setEducation(@Req() req: any, @Body() body: { entries: EducationInputDto[] }) {
    return this.profile.setEducation(req.user.userId, body.entries);
  }

  @Post('apply-parsed')
  applyParsed(@Req() req: any, @Body() dto: ApplyParsedDto) {
    return this.profile.applyParsed(req.user.userId, dto);
  }

  @Post('onboarding-step')
  setStep(@Req() req: any, @Body() dto: OnboardingStepDto) {
    return this.profile.setOnboardingStep(req.user.userId, dto.step);
  }

  @Post('complete-onboarding')
  complete(@Req() req: any) {
    return this.profile.completeOnboarding(req.user.userId);
  }
}
