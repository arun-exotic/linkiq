import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import appConfig from './app.config';
import authConfig from './auth.config';
import databaseConfig from './database.config';
import redisConfig from './redis.config';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, authConfig, databaseConfig, redisConfig],
      validationSchema: Joi.object({
        APP_PORT: Joi.number().default(3000),
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        APP_BASE_URL: Joi.string().uri().required(),
        CORS_ORIGIN: Joi.string().required(),
        JWT_SECRET: Joi.string().min(32).required(),
        DAILY_SALT: Joi.string().required(),
        DATABASE_URL: Joi.string()
          .pattern(/^postgresql:\/\//)
          .required(),
        REDIS_HOST: Joi.string().default('localhost'),
        REDIS_PORT: Joi.number().default(6379),
      }),
    }),
  ],
})
export class ConfigModule {}
