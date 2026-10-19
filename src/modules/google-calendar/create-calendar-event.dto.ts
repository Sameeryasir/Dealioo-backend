import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCalendarEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @MaxLength(40)
  start!: string;

  @IsString()
  @MaxLength(40)
  end!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  timeZone!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  attendeeEmail?: string;
}
