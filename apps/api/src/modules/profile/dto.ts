import {
  IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUrl,
  Max, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { NigerianState, EmploymentType } from '@prisma/client';

export class ProfilePatchDto {
  @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsEnum(NigerianState) state?: NigerianState;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsBoolean() workAuthorized?: boolean;
  @IsOptional() @IsBoolean() needsSponsorship?: boolean;
  @IsOptional() @IsString() @MaxLength(120) currentRole?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) targetRoles?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(60) yearsExperience?: number;
  @IsOptional() @IsString() @MaxLength(120) noticePeriod?: string;
  @IsOptional() @IsString() @MaxLength(120) availability?: string;
  @IsOptional() @IsUrl() linkedinUrl?: string;
  @IsOptional() @IsUrl() githubUrl?: string;
  @IsOptional() @IsUrl() portfolioUrl?: string;
  @IsOptional() @IsUrl() websiteUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) summary?: string;
}

export class PreferencePatchDto {
  @IsOptional() @IsArray() @IsEnum(NigerianState, { each: true }) preferredStates?: NigerianState[];
  @IsOptional() @IsBoolean() remoteOnly?: boolean;
  @IsOptional() @IsBoolean() hybridAllowed?: boolean;
  @IsOptional() @IsBoolean() onsiteAllowed?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) salaryFloor?: number;
  @IsOptional() @IsString() @MaxLength(3) salaryCurrency?: string;
  @IsOptional() @IsArray() @IsEnum(EmploymentType, { each: true }) employmentTypes?: EmploymentType[];
  @IsOptional() @IsArray() @IsString({ each: true }) preferredIndustries?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) excludedIndustries?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) excludedCompanies?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) maxApplicationsPerDay?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) maxApplicationsPerWeek?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) minMatchScore?: number;
  @IsOptional() @IsBoolean() autoSubmitEnabled?: boolean;
  @IsOptional() @IsBoolean() coverLetterAutoGen?: boolean;
  @IsOptional() @IsBoolean() cvTailoringAllowed?: boolean;
  @IsOptional() @IsBoolean() reviewOnMissingRequired?: boolean;
}

export class SkillInputDto {
  @IsString() @MaxLength(60) name!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) level?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(60) yearsUsed?: number;
}

export class ExperienceInputDto {
  @IsString() @MaxLength(120) title!: string;
  @IsString() @MaxLength(200) employer!: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) highlights?: string[];
}

export class EducationInputDto {
  @IsString() @MaxLength(200) institution!: string;
  @IsOptional() @IsString() @MaxLength(120) degree?: string;
  @IsOptional() @IsString() @MaxLength(120) field?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
}

export class ApplyParsedDto {
  @IsString() documentId!: string;
  @IsOptional() @IsArray() @IsString({ each: true })
  acceptedSections?: ('contact' | 'skills' | 'experience' | 'education' | 'summary')[];
  @IsOptional() profile?: ProfilePatchDto;
  @IsOptional() @IsArray() skills?: SkillInputDto[];
  @IsOptional() @IsArray() experience?: ExperienceInputDto[];
  @IsOptional() @IsArray() education?: EducationInputDto[];
}

export class OnboardingStepDto {
  @IsString() @MaxLength(40) step!: string;
}
