import { registerAs } from '@nestjs/config';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  baseUrl: string;
  corsOrigin: string;
}

export default registerAs<AppConfig>('app', () => ({
  port: parseInt(process.env.APP_PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  baseUrl: process.env.APP_BASE_URL ?? '',
  corsOrigin: process.env.CORS_ORIGIN ?? '',
}));
