import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() @MaxLength(160) login: string;
  @IsString() @MaxLength(200) password: string;
  @IsOptional() @IsIn(['dealer', 'platform']) portal?: 'dealer' | 'platform';
  /** pick one dealership when the same login exists in several */
  @IsOptional() @IsString() @MaxLength(40) tenantId?: string;
}

export class ChangePasswordDto {
  @IsString() current: string;
  @IsString() @MinLength(8) @MaxLength(200) password: string;
}

export class SetupDto {
  @IsString() @MaxLength(120) name: string;
  @IsString() @MinLength(3) @MaxLength(120) login: string;
  @IsString() @MinLength(8) @MaxLength(200) password: string;
  @IsOptional() @IsString() setupKey?: string;
}

export class SignupDto {
  @IsString() @MinLength(2) @MaxLength(120) dealershipName: string;
  @IsString() @MaxLength(120) name: string;
  @IsEmail() @MaxLength(160) email: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsString() @MinLength(8) @MaxLength(200) password: string;
  /** honeypot: bots fill it */
  @IsOptional() @IsString() website?: string;
}
