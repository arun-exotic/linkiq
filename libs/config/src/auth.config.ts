import { registerAs } from '@nestjs/config';

export interface AuthConfig {
  jwtSecret: string;
  dailySalt: string;
}

export default registerAs<AuthConfig>('auth', () => ({
  jwtSecret: process.env.JWT_SECRET ?? '',
  dailySalt: process.env.DAILY_SALT ?? '',
}));
