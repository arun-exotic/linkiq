import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsSafeUrl } from '@app/common';

export class CreateLinkDto {
  @IsSafeUrl()
  destination: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
