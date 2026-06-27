# LinkIQ — Phase 1 Build Plan
### Reliable & Scalable URL Shortener (NestJS Backend)

> **Stack:** NestJS · PostgreSQL (local) · Redis (local) · Prisma ORM · BullMQ · GCP (Cloud Run, Cloud SQL, Memorystore, Secret Manager)
> **Goal:** Production-grade redirect engine with authentication, live on a real domain

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Decisions](#2-architecture-decisions)
3. [Database Schema](#3-database-schema)
4. [Prisma Setup & Migrations](#4-prisma-setup--migrations)
5. [NestJS Module Structure](#5-nestjs-module-structure)
6. [Phase 1 — Project Setup](#6-phase-1--project-setup)
7. [Phase 2 — Authentication](#7-phase-2--authentication)
8. [Phase 3 — Core Redirect Engine](#8-phase-3--core-redirect-engine)
9. [Phase 4 — Async Click Tracking with BullMQ](#9-phase-4--async-click-tracking-with-bullmq)
10. [Phase 5 — Reliability Hardening](#10-phase-5--reliability-hardening)
11. [Phase 6 — GCP Deploy](#11-phase-6--gcp-deploy)
12. [API Contract](#12-api-contract)
13. [Redis Key Design](#13-redis-key-design)
14. [Environment Variables](#14-environment-variables)
15. [Performance Targets](#15-performance-targets)
16. [Phase 2 Product Bridge Notes](#16-phase-2-product-bridge-notes)

---

## 1. Project Overview

LinkIQ Phase 1 is a URL shortener backend built to be **reliable** (no dropped clicks, no broken redirects) and **scalable** (stateless API that can run on multiple Cloud Run instances without coordination issues). Every design decision in this phase is made with Phase 2 (multi-tenant analytics) in mind — nothing will need to be rewritten, only extended.

### What Phase 1 delivers

- `POST /auth/register` — create an account, returns JWT
- `POST /auth/login` — authenticate, returns JWT access + refresh token
- `POST /auth/refresh` — rotate access token using refresh token
- `POST /auth/logout` — revoke refresh token
- `GET /auth/me` — return current user profile
- `POST /links` — create a short link (authenticated), returns a `lnkiq.io/abc1234` URL
- `GET /:slug` — redirect to destination in under 50ms (cache hit path) — public, no auth
- Click events recorded asynchronously via BullMQ (never blocks the redirect)
- Rate limiting on link creation (per-user, not just per-IP)
- Expired and deleted link handling
- Health check endpoint
- CORS configured for the separate frontend
- API versioned under `/v1/`
- Deployed and live on GCP

### What Phase 1 deliberately defers

- Email verification (Phase 2)
- OAuth / social login (Phase 2)
- Password reset flow (Phase 2)
- Multi-tenancy and organisations (Phase 2)
- Analytics dashboard (Phase 2)
- Billing and plan limits (Phase 2)
- Link-in-bio pages (Phase 2)

---

## 2. Architecture Decisions

### 2.1 Authentication — JWT with refresh token rotation

Access tokens are short-lived (15 minutes). Refresh tokens are long-lived (7 days) and stored in Postgres so they can be revoked. This pattern means:

- A stolen access token expires in 15 minutes with no server action needed
- A stolen refresh token can be immediately revoked by the user or server
- Logout actually works (revoke the refresh token)
- Stateless API — no session store needed for auth

```
POST /v1/auth/login
  → validate credentials
  → issue access_token (JWT, 15m, signed with JWT_SECRET)
  → issue refresh_token (opaque UUID, 7d, stored in refresh_tokens table)
  → return both to client

POST /v1/auth/refresh
  → validate refresh_token exists in DB and not revoked
  → issue new access_token
  → rotate refresh_token (delete old, insert new) ← prevents token reuse attacks

POST /v1/auth/logout
  → delete refresh_token from DB
  → access_token expires naturally (15m max)
```

**Why not store refresh tokens in Redis?** Postgres gives you a persistent audit trail of active sessions. In Phase 2 you can show users "logged in from 3 devices" and let them revoke individual sessions. Redis would lose that data on flush.

### 2.2 Slug generation — `nanoid(7)`

Use `nanoid` with a URL-safe alphabet (A–Z, a–z, 0–9 = 62 chars).

```
62^7 = ~3.5 trillion combinations
```

- Never use sequential IDs — they are predictable and scrapeable
- Custom aliases are allowed but validated against a reserved words list
- On collision (extremely rare), retry up to 3 times before returning a 500

**Reserved slugs to block:** `api`, `admin`, `health`, `dashboard`, `login`, `signup`, `static`, `assets`, `favicon`, `v1`

### 2.3 Cache-aside pattern — warm on write

```
Write path:  INSERT via Prisma → SET in Redis (TTL 24h)
Read path:   GET from Redis → hit: return · miss: Prisma findUnique → SET in Redis
Delete path: soft-delete via Prisma → DEL in Redis
```

Warming the cache at write time means the **very first click is always a cache hit**.

### 2.4 Fire-and-forget click tracking with BullMQ

The redirect response (`302`) is sent to the user **before** any analytics write happens. Click events are added to a BullMQ queue after the response is flushed. A BullMQ worker (running in the same NestJS process) then writes to Postgres asynchronously.

```
User click → Redis lookup → 302 response sent → add job to BullMQ queue
                                                        ↓
                                                  BullMQ worker (NestJS)
                                                        ↓
                                                  INSERT into clicks (Prisma)
```

**Why BullMQ over Cloud Tasks:** BullMQ runs on your existing Redis — zero extra infra, no GCP IAM setup, no HTTP overhead, built-in retry/backoff, in-process worker. In Phase 2 the worker can be extracted to a separate service with no queue API changes.

### 2.5 Rate limiting — per user (authenticated) / per IP (unauthenticated)

- Authenticated users: 100 link creations per hour (keyed by `userId`)
- Unauthenticated attempts: blocked at the auth guard level (all link endpoints require auth)

Rate limiting is implemented as a NestJS guard using a Redis sorted set.

### 2.6 Click count strategy — Prisma `_count`

`GET /v1/links` uses Prisma's `_count` include to get click counts per link in a single query with a JOIN — no extra query per link, no denormalized counter column to keep in sync. This is acceptable for Phase 1. In Phase 2 a `click_hourly_rollups` table will be used for analytics queries instead.

```typescript
prisma.link.findMany({
  where: { userId, deletedAt: null },
  include: { _count: { select: { clicks: true } } },
});
```

### 2.7 Soft deletes everywhere

All deletes set `deleted_at = now()`. Expired links (`expires_at < now()`) return `410 Gone`, not `404` — correct HTTP semantics.

### 2.8 URL destination validation

- Must be `http://` or `https://`
- Reject `localhost`, `127.*`, `0.0.0.0`, `10.*`, `172.16-31.*`, `192.168.*` (SSRF protection)
- Maximum 2048 characters
- Custom validator in `common/validators/is-safe-url.validator.ts`

### 2.9 API versioning

All endpoints are prefixed `/v1/` via NestJS global prefix. The redirect endpoint (`GET /:slug`) is the only exception — it must live at root for short URLs to work.

```typescript
// main.ts
app.setGlobalPrefix('v1', { exclude: ['/:slug'] });
```

### 2.10 CORS

Configured at app bootstrap. The frontend origin is whitelisted via `CORS_ORIGIN` env var.

```typescript
app.enableCors({
  origin: process.env.CORS_ORIGIN,  // e.g. https://app.lnkiq.io
  credentials: true,
});
```

---

## 3. Database Schema

The schema is defined via Prisma and versioned through Prisma migrations. Raw SQL shown here for reference; the actual source of truth is `prisma/schema.prisma`.

```sql
-- Users
CREATE TABLE users (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        UNIQUE NOT NULL,
  password    TEXT        NOT NULL,           -- bcrypt hash (rounds=12)
  name        TEXT,                           -- optional display name
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Refresh tokens (one row per active session)
CREATE TABLE refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT        UNIQUE NOT NULL,    -- opaque UUID, not the JWT
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  revoked_at  TIMESTAMPTZ                    -- NULL = still valid
);

CREATE INDEX idx_refresh_tokens_token   ON refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);

-- Links
CREATE TABLE links (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT        UNIQUE NOT NULL,
  destination TEXT        NOT NULL,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT,
  expires_at  TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_links_slug    ON links(slug)    WHERE deleted_at IS NULL;
CREATE INDEX idx_links_user_id ON links(user_id) WHERE deleted_at IS NULL;

-- Click events (append-only)
CREATE TABLE clicks (
  id          BIGSERIAL   PRIMARY KEY,
  link_id     UUID        NOT NULL REFERENCES links(id),
  clicked_at  TIMESTAMPTZ DEFAULT now(),
  ip_hash     TEXT,
  country     TEXT,
  city        TEXT,
  user_agent  TEXT,
  referer     TEXT,
  device_type TEXT
);

CREATE INDEX idx_clicks_link_time ON clicks(link_id, clicked_at DESC);
```

### Schema design notes

- `user_id` on `links` is now **NOT NULL** — every link belongs to an authenticated user. No more nullable foreign key.
- `refresh_tokens` table enables real logout, session listing, and per-device revocation.
- `revoked_at` on `refresh_tokens` is a soft-delete — keeps an audit trail of revoked sessions.
- `clicks` is append-only — never update or delete rows.
- `ip_hash` stores `SHA-256(ip + daily_salt)` — GDPR compliant, never store raw IPs.

---

## 4. Prisma Setup & Migrations

### Installation

```bash
npm install prisma @prisma/client
npm install bcrypt @types/bcrypt
npm install @nestjs/jwt @nestjs/passport passport passport-jwt passport-local
npm install @types/passport-jwt @types/passport-local
npx prisma init
```

### `prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id             String         @id @default(uuid()) @db.Uuid
  email          String         @unique
  password       String
  name           String?
  createdAt      DateTime       @default(now()) @map("created_at")
  updatedAt      DateTime       @updatedAt @map("updated_at")
  links          Link[]
  refreshTokens  RefreshToken[]

  @@map("users")
}

model RefreshToken {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  token     String    @unique
  expiresAt DateTime  @map("expires_at")
  createdAt DateTime  @default(now()) @map("created_at")
  revokedAt DateTime? @map("revoked_at")

  @@index([token])
  @@index([userId])
  @@map("refresh_tokens")
}

model Link {
  id          String    @id @default(uuid()) @db.Uuid
  slug        String    @unique
  destination String
  title       String?
  expiresAt   DateTime? @map("expires_at")
  deletedAt   DateTime? @map("deleted_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  userId      String    @map("user_id") @db.Uuid
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  clicks      Click[]

  @@index([slug])
  @@index([userId])
  @@map("links")
}

model Click {
  id         BigInt   @id @default(autoincrement())
  linkId     String   @map("link_id") @db.Uuid
  link       Link     @relation(fields: [linkId], references: [id])
  clickedAt  DateTime @default(now()) @map("clicked_at")
  ipHash     String?  @map("ip_hash")
  country    String?
  city       String?
  userAgent  String?  @map("user_agent")
  referer    String?
  deviceType String?  @map("device_type")

  @@index([linkId, clickedAt(sort: Desc)])
  @@map("clicks")
}
```

### Migration workflow

```bash
# Create and apply initial migration (development)
npx prisma migrate dev --name init

# After any schema change
npx prisma migrate dev --name <descriptive_name>

# Apply in production (CI/CD or Cloud Run Job — never migrate dev in prod)
npx prisma migrate deploy

# Regenerate Prisma Client after schema changes
npx prisma generate

# Inspect local DB
npx prisma studio
```

### Data migration pattern

For migrations that require backfilling data (not just schema changes):

```
prisma/
├── migrations/
│   └── 20260627000000_init/
│       └── migration.sql           ← auto-generated by Prisma
└── data-migrations/
    └── 20260627_backfill_xxx.ts    ← hand-written, run once as Cloud Run Job
```

Run data migrations as a one-off Cloud Run Job. Never run them at application boot.

### PrismaModule (NestJS)

```typescript
// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

```typescript
// src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

---

## 5. NestJS Module Structure

```
src/
├── app.module.ts
├── main.ts                          # bootstrap, CORS, global prefix, pipes, filters
│
├── prisma/
│   ├── prisma.module.ts             # @Global() module
│   └── prisma.service.ts
│
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts           # POST /v1/auth/register|login|refresh|logout
│   ├── auth.service.ts              # register, login, refresh, logout, validateUser
│   ├── strategies/
│   │   ├── jwt.strategy.ts          # validates access_token, extracts userId
│   │   └── local.strategy.ts        # validates email+password on login
│   ├── guards/
│   │   ├── jwt-auth.guard.ts        # protects authenticated routes
│   │   └── local-auth.guard.ts      # used only on POST /auth/login
│   └── dto/
│       ├── register.dto.ts          # { email, password, name? }
│       ├── login.dto.ts             # { email, password }
│       └── auth-response.dto.ts     # { accessToken, refreshToken, user }
│
├── users/
│   ├── users.module.ts
│   ├── users.service.ts             # findById, findByEmail, create
│   └── dto/
│       └── user-response.dto.ts     # { id, email, name, createdAt }
│
├── links/
│   ├── links.module.ts
│   ├── links.controller.ts          # POST /v1/links, GET /v1/links, DELETE /v1/links/:id
│   ├── links.service.ts
│   ├── links.repository.ts
│   └── dto/
│       ├── create-link.dto.ts       # { destination, slug?, title?, expiresAt? }
│       └── link-response.dto.ts     # { id, slug, shortUrl, destination, clickCount, ... }
│
├── redirect/
│   ├── redirect.module.ts
│   ├── redirect.controller.ts       # GET /:slug  ← hot path, no auth
│   └── redirect.service.ts
│
├── clicks/
│   ├── clicks.module.ts
│   ├── clicks.processor.ts          # BullMQ worker
│   └── clicks.service.ts
│
├── cache/
│   ├── cache.module.ts
│   └── cache.service.ts             # Redis wrapper (get, set, del, setNX, setWithTTL)
│
├── queue/
│   ├── queue.module.ts
│   └── queue.service.ts             # BullMQ producer
│
├── health/
│   ├── health.module.ts
│   └── health.controller.ts         # GET /health (no prefix — outside v1/)
│
└── common/
    ├── filters/
    │   └── http-exception.filter.ts  # { statusCode, message, timestamp, path }
    ├── guards/
    │   └── rate-limit.guard.ts       # Redis sliding window
    ├── interceptors/
    │   └── logging.interceptor.ts    # correlationId, durationMs
    ├── decorators/
    │   └── current-user.decorator.ts # @CurrentUser() → extracts user from JWT payload
    └── validators/
        └── is-safe-url.validator.ts  # blocks private IPs, localhost, non-http(s)
```

---

## 6. Phase 1 — Project Setup

**Goal:** Skeleton running locally with Prisma connected and all config in place.

- [ ] `nest new linkiq-api` with TypeScript strict mode
- [ ] Install all dependencies (see Phase 2 for auth deps, Phase 4 for BullMQ)
- [ ] `npx prisma init` — create `prisma/schema.prisma`
- [ ] Write full schema (users, refresh_tokens, links, clicks)
- [ ] `npx prisma migrate dev --name init` — creates tables in local Postgres
- [ ] `PrismaModule` as `@Global()` in `AppModule`
- [ ] `ioredis` connected, `CacheModule` wired
- [ ] `.env` with `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `APP_PORT`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `APP_BASE_URL`, `CORS_ORIGIN`
- [ ] Global prefix `/v1` with slug redirect excluded
- [ ] CORS enabled with `CORS_ORIGIN`
- [ ] Global `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true`
- [ ] Global `HttpExceptionFilter`
- [ ] ESLint + Prettier config

> **Local setup:** Point `DATABASE_URL` to your local Postgres and `REDIS_HOST/PORT` to your local Redis. No Docker needed.

---

## 7. Phase 2 — Authentication

**Goal:** Register, login, get a JWT, use it on protected routes.

### Install

```bash
npm install @nestjs/jwt @nestjs/passport passport passport-jwt passport-local
npm install bcrypt uuid
npm install --save-dev @types/passport-jwt @types/passport-local @types/bcrypt @types/uuid
```

### UsersService

```typescript
// users/users.service.ts
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, createdAt: true },
    });
  }

  async create(data: { email: string; password: string; name?: string }) {
    const hash = await bcrypt.hash(data.password, 12);
    return this.prisma.user.create({
      data: { email: data.email, password: hash, name: data.name },
      select: { id: true, email: true, name: true, createdAt: true },
    });
  }
}
```

### AuthService

```typescript
// auth/auth.service.ts
@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');
    return user;
  }

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already in use');
    const user = await this.usersService.create(dto);
    return this.issueTokens(user);
  }

  async login(user: { id: string; email: string }) {
    return this.issueTokens(user);
  }

  async refresh(token: string) {
    const record = await this.prisma.refreshToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate: revoke old, issue new
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(record.user);
  }

  async logout(token: string) {
    await this.prisma.refreshToken.updateMany({
      where: { token, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(user: { id: string; email: string }) {
    const payload = { sub: user.id, email: user.email };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: '15m',
    });

    const refreshToken = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.prisma.refreshToken.create({
      data: { userId: user.id, token: refreshToken, expiresAt },
    });

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email },
    };
  }
}
```

### JWT Strategy

```typescript
// auth/strategies/jwt.strategy.ts
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  async validate(payload: { sub: string; email: string }) {
    // payload is already verified — just return what you want on req.user
    return { id: payload.sub, email: payload.email };
  }
}
```

### Local Strategy (login only)

```typescript
// auth/strategies/local.strategy.ts
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'email' });
  }

  async validate(email: string, password: string) {
    return this.authService.validateUser(email, password);
  }
}
```

### Auth Controller

```typescript
// auth/auth.controller.ts
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @UseGuards(LocalAuthGuard)
  login(@CurrentUser() user: { id: string; email: string }) {
    return this.authService.login(user);
  }

  @Post('refresh')
  refresh(@Body('refreshToken') token: string) {
    if (!token) throw new BadRequestException('refreshToken required');
    return this.authService.refresh(token);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout(@Body('refreshToken') token: string) {
    if (!token) throw new BadRequestException('refreshToken required');
    return this.authService.logout(token);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: { id: string; email: string }) {
    return user;
  }
}
```

### CurrentUser decorator

```typescript
// common/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

### Auth checklist

- [ ] `UsersModule` with `UsersService`
- [ ] `AuthModule` imports `UsersModule`, `JwtModule`, `PassportModule`
- [ ] `JwtStrategy` and `LocalStrategy` registered as providers
- [ ] `JwtAuthGuard` — extends `AuthGuard('jwt')`
- [ ] `LocalAuthGuard` — extends `AuthGuard('local')`
- [ ] `POST /v1/auth/register` — validate email format, password min 8 chars
- [ ] `POST /v1/auth/login` — uses `LocalAuthGuard`, returns tokens
- [ ] `POST /v1/auth/refresh` — validates refresh token, rotates it
- [ ] `POST /v1/auth/logout` — revokes refresh token
- [ ] `GET /v1/auth/me` — protected, returns `{ id, email, name, createdAt }`
- [ ] Passwords hashed with bcrypt rounds=12
- [ ] Never return `password` field in any response (use `select` in Prisma)
- [ ] Add cleanup job: delete expired + revoked refresh tokens older than 30 days

---

## 8. Phase 3 — Core Redirect Engine

**Goal:** End-to-end link creation and redirect working locally in under 50ms on cache hit.

### URL validation

```typescript
// common/validators/is-safe-url.validator.ts
import { registerDecorator, ValidationOptions } from 'class-validator';

const PRIVATE_IP_REGEX =
  /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)/i;

export function IsSafeUrl(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isSafeUrl',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: string) {
          if (typeof value !== 'string') return false;
          if (value.length > 2048) return false;
          if (!value.startsWith('http://') && !value.startsWith('https://')) return false;
          if (PRIVATE_IP_REGEX.test(value)) return false;
          return true;
        },
        defaultMessage: () =>
          'URL must be a valid public http/https URL under 2048 characters',
      },
    });
  };
}
```

### CreateLinkDto

```typescript
// links/dto/create-link.dto.ts
import { IsOptional, IsString, MaxLength, IsDateString } from 'class-validator';
import { IsSafeUrl } from '../../common/validators/is-safe-url.validator';

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
```

### LinksRepository

```typescript
// links/links.repository.ts
@Injectable()
export class LinksRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    slug: string;
    destination: string;
    userId: string;
    title?: string;
    expiresAt?: Date;
  }) {
    return this.prisma.link.create({ data });
  }

  async findBySlug(slug: string) {
    return this.prisma.link.findFirst({
      where: { slug, deletedAt: null },
    });
  }

  async findAllByUser(userId: string) {
    return this.prisma.link.findMany({
      where: { userId, deletedAt: null },
      include: { _count: { select: { clicks: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async softDelete(id: string, userId: string) {
    // userId check prevents users deleting other users' links
    return this.prisma.link.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}
```

### LinksService

```typescript
// links/links.service.ts
@Injectable()
export class LinksService {
  constructor(
    private readonly linksRepository: LinksRepository,
    private readonly cache: CacheService,
  ) {}

  async create(dto: CreateLinkDto, userId: string) {
    if (dto.slug) {
      if (isReserved(dto.slug)) throw new UnprocessableEntityException('Reserved slug');
    }

    return this.createWithRetry(dto, userId);
  }

  private async createWithRetry(dto: CreateLinkDto, userId: string, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      try {
        const slug = dto.slug ?? generateSlug();
        const link = await this.linksRepository.create({
          slug,
          destination: dto.destination,
          userId,
          title: dto.title,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        });
        // Warm the cache immediately — first click will always hit Redis
        await this.cache.set(`slug:${slug}`, JSON.stringify(link), 86400);
        return link;
      } catch (err) {
        if (err.code === 'P2002' && !dto.slug) continue;   // auto-slug collision, retry
        if (err.code === 'P2002' && dto.slug) {
          throw new ConflictException('Slug already taken');
        }
        throw err;
      }
    }
    throw new InternalServerErrorException('Failed to generate a unique slug');
  }

  async findAllByUser(userId: string) {
    const links = await this.linksRepository.findAllByUser(userId);
    return links.map((link) => ({
      ...link,
      clickCount: link._count.clicks,
      shortUrl: `${process.env.APP_BASE_URL}/${link.slug}`,
    }));
  }

  async delete(id: string, userId: string) {
    const result = await this.linksRepository.softDelete(id, userId);
    if (result.count === 0) throw new NotFoundException('Link not found');
    // Invalidate cache
    const link = await this.linksRepository.findBySlug(id); // get slug for cache key
    if (link) await this.cache.del(`slug:${link.slug}`);
  }
}
```

### LinksController

```typescript
// links/links.controller.ts
@Controller('links')
@UseGuards(JwtAuthGuard)
export class LinksController {
  constructor(private readonly linksService: LinksService) {}

  @Post()
  @UseGuards(RateLimitGuard)
  @HttpCode(201)
  create(@Body() dto: CreateLinkDto, @CurrentUser() user: { id: string }) {
    return this.linksService.create(dto, user.id);
  }

  @Get()
  findAll(@CurrentUser() user: { id: string }) {
    return this.linksService.findAllByUser(user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.linksService.delete(id, user.id);
  }
}
```

### Redirect controller

```typescript
// redirect/redirect.controller.ts
// NOTE: This controller must be registered outside the v1 prefix
@Controller()
export class RedirectController {
  constructor(private readonly redirectService: RedirectService) {}

  @Get(':slug')
  async redirect(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.redirectService.redirect(slug, req, res);
  }
}
```

```typescript
// redirect/redirect.service.ts
@Injectable()
export class RedirectService {
  constructor(
    private readonly cache: CacheService,
    private readonly linksRepository: LinksRepository,
    private readonly queue: QueueService,
    private readonly logger: Logger,
  ) {}

  async redirect(slug: string, req: Request, res: Response) {
    const link = await this.resolveSlug(slug);

    if (!link) return res.status(404).send();
    if (link.deletedAt || (link.expiresAt && link.expiresAt < new Date())) {
      return res.status(410).send();
    }

    res.redirect(302, link.destination);

    void this.queue.enqueueClick({
      linkId: link.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      referer: req.headers['referer'] as string,
      timestamp: new Date().toISOString(),
      correlationId: req.headers['x-correlation-id'] as string,
    });
  }

  private async resolveSlug(slug: string) {
    try {
      const cached = await this.cache.get(`slug:${slug}`);
      if (cached) return JSON.parse(cached);
    } catch {
      this.logger.warn('Redis unavailable, falling back to Postgres');
    }
    const link = await this.linksRepository.findBySlug(slug);
    if (link) {
      // Re-warm cache on miss
      await this.cache.set(`slug:${slug}`, JSON.stringify(link), 86400).catch(() => {});
    }
    return link;
  }
}
```

### Phase 3 checklist

- [ ] `IsSafeUrl` validator — block private IPs, localhost, non-http(s), >2048 chars
- [ ] `LinksModule` with `LinksController`, `LinksService`, `LinksRepository`
- [ ] `POST /v1/links` — requires JWT, creates link, warms cache
- [ ] `GET /v1/links` — returns user's links with `clickCount` via Prisma `_count`
- [ ] `DELETE /v1/links/:id` — soft delete, invalidate Redis key, ownership check
- [ ] `GET /:slug` — no auth, Redis-first, Postgres fallback, `302` response
- [ ] `slug.util.ts` — nanoid(7) + reserved word check (include `v1` in reserved list)
- [ ] `RateLimitGuard` — Redis sliding window, 100 creations/user/hr

---

## 9. Phase 4 — Async Click Tracking with BullMQ

**Goal:** Every click recorded in Postgres without slowing the redirect path.

### Install

```bash
npm install bullmq @nestjs/bullmq
npm install geoip-lite ua-parser-js
npm install --save-dev @types/geoip-lite
```

### BullMQ global registration

```typescript
// app.module.ts
BullModule.forRoot({
  connection: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
  },
}),
```

### QueueService (producer)

```typescript
// queue/queue.service.ts
@Injectable()
export class QueueService {
  constructor(@InjectQueue('click-events') private readonly queue: Queue) {}

  async enqueueClick(payload: {
    linkId: string;
    ip: string;
    userAgent?: string;
    referer?: string;
    timestamp: string;
    correlationId: string;
  }) {
    await this.queue.add('process-click', payload, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }
}
```

### ClicksProcessor (worker)

```typescript
// clicks/clicks.processor.ts
@Processor('click-events', { concurrency: 5 })
export class ClicksProcessor extends WorkerHost {
  constructor(private readonly clicksService: ClicksService) {
    super();
  }

  async process(job: Job) {
    await this.clicksService.recordClick(job.data);
  }
}
```

> **Concurrency note:** `concurrency: 5` means 5 click jobs processed in parallel. Prisma's default connection pool on 1 vCPU is ~3 connections. Set `DATABASE_URL` connection pool params: `?connection_limit=10` to ensure enough connections. Match BullMQ concurrency to your pool size.

### ClicksService

```typescript
// clicks/clicks.service.ts
@Injectable()
export class ClicksService {
  private readonly logger = new Logger(ClicksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async recordClick(data: {
    linkId: string;
    ip: string;
    userAgent?: string;
    referer?: string;
    timestamp: string;
    correlationId: string;
  }) {
    const ipHash = this.hashIp(data.ip);

    const dedupKey = `dedup:${ipHash}:${data.linkId}`;
    const isNew = await this.cache.setNX(dedupKey, '1', 1800);
    if (!isNew) {
      this.logger.debug(`Deduplicated click [${data.correlationId}]`);
      return;
    }

    const geo = geoip.lookup(data.ip);
    const ua = new UAParser(data.userAgent);
    const deviceType = ua.getDevice().type ?? 'desktop';

    await this.prisma.click.create({
      data: {
        linkId: data.linkId,
        clickedAt: new Date(data.timestamp),
        ipHash,
        country: geo?.country ?? null,
        city: geo?.city ?? null,
        userAgent: data.userAgent ?? null,
        referer: this.parseReferer(data.referer),
        deviceType,
      },
    });
  }

  private hashIp(ip: string): string {
    // Daily salt: hashes rotate each day — cannot reconstruct IPs across days
    const salt = new Date().toISOString().slice(0, 10);
    return createHash('sha256').update(ip + salt).digest('hex');
  }

  private parseReferer(referer?: string): string {
    if (!referer) return 'direct';
    if (referer.includes('instagram.com')) return 'instagram';
    if (referer.includes('tiktok.com')) return 'tiktok';
    if (referer.includes('twitter.com') || referer.includes('t.co')) return 'twitter';
    if (referer.includes('facebook.com')) return 'facebook';
    if (referer.includes('linkedin.com')) return 'linkedin';
    return 'other';
  }
}
```

### Phase 4 checklist

- [ ] `QueueModule` with `BullModule.registerQueue({ name: 'click-events' })`
- [ ] `ClicksModule` with `ClicksProcessor` and `ClicksService`
- [ ] `ClicksProcessor` with `concurrency: 5`
- [ ] `DATABASE_URL` includes `?connection_limit=10`
- [ ] Deduplication via Redis `SET NX` with 30m TTL
- [ ] `hashIp` uses `SHA-256(ip + YYYY-MM-DD)` — daily rotating salt
- [ ] Midnight salt-rotation edge case: acceptable in Phase 1 (dedup miss at midnight = minor overcount). Document as known limitation.

---

## 10. Phase 5 — Reliability Hardening

**Goal:** Observable, handles all edge cases, ready for production traffic.

### Error handling

- [ ] Global `HttpExceptionFilter` returns `{ statusCode, message, timestamp, path }` on every error
- [ ] Never leak stack traces in production (`NODE_ENV=production`)
- [ ] Slug collision handled via `P2002` catch + retry (already in LinksService)
- [ ] Redis failure: fall through to Postgres silently in `resolveSlug`

### Rate limiting

```typescript
// common/guards/rate-limit.guard.ts
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly cache: CacheService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as { id: string };
    const key = `rate:create:${user.id}`;
    const now = Date.now();
    const window = 3600 * 1000; // 1 hour in ms
    const limit = 100;

    await this.cache.client.zadd(key, now, `${now}-${Math.random()}`);
    await this.cache.client.zremrangebyscore(key, 0, now - window);
    const count = await this.cache.client.zcard(key);
    await this.cache.client.expire(key, 3600);

    if (count > limit) {
      throw new HttpException(
        { statusCode: 429, message: 'Rate limit exceeded', retryAfter: 3600 },
        429,
      );
    }
    return true;
  }
}
```

### Health check

```typescript
// health/health.controller.ts
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: PrismaHealthIndicator,
    private readonly redis: MicroserviceHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('postgres'),
      () => this.redis.pingCheck('redis'),
    ]);
  }
}
```

### Structured logging

- [ ] Use `pino` + `nestjs-pino` for JSON structured logs (Cloud Logging parses JSON natively)
- [ ] `LoggingInterceptor` adds `correlationId` (UUID) to every request
- [ ] Pass `correlationId` through to BullMQ job payload for end-to-end click tracing
- [ ] Log shape: `{ correlationId, method, path, statusCode, durationMs, userId?, slug? }`

### Nightly cleanup jobs (BullMQ repeatable)

```typescript
// Register on app bootstrap
await cleanupQueue.add('cleanup-expired-slugs', {}, { repeat: { cron: '0 2 * * *' } });
await cleanupQueue.add('cleanup-refresh-tokens', {}, { repeat: { cron: '0 3 * * *' } });
```

- `cleanup-expired-slugs` — DEL Redis keys for links where `expiresAt < now()`
- `cleanup-refresh-tokens` — Prisma `deleteMany` on `refresh_tokens` where `(revokedAt IS NOT NULL OR expiresAt < now()) AND createdAt < 30 days ago`

---

## 11. Phase 6 — GCP Deploy

**Goal:** Live on a real domain.

### GCP infrastructure setup

- [ ] Create GCP project `linkiq-prod`
- [ ] Enable APIs: Cloud Run, Cloud SQL, Memorystore, Secret Manager
- [ ] Create Cloud SQL Postgres 16 instance
- [ ] Create Memorystore Redis instance (1GB basic tier)
- [ ] Store secrets in Secret Manager: `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `JWT_SECRET`, `DAILY_SALT`, `CORS_ORIGIN`

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
EXPOSE 3000
CMD ["node", "dist/main"]
```

### Migration on deploy

Run as a Cloud Run Job **before** deploying the new revision:

```bash
gcloud run jobs create linkiq-migrate \
  --image gcr.io/linkiq-prod/linkiq-api:latest \
  --command "npx" \
  --args "prisma,migrate,deploy" \
  --set-secrets DATABASE_URL=DATABASE_URL:latest

gcloud run jobs execute linkiq-migrate --wait
# Only then deploy the main service
```

### Cloud Run deploy

- [ ] Push image to Google Artifact Registry
- [ ] Deploy to Cloud Run (min 1 instance, max 10, 512MB RAM)
- [ ] BullMQ workers run inside the same Cloud Run container (Phase 1)
- [ ] `CLOUD_RUN_INGRESS=all`
- [ ] Point custom domain, GCP manages SSL

### Smoke tests

- [ ] `POST /v1/auth/register` → 201 with tokens
- [ ] `POST /v1/auth/login` → 200 with tokens
- [ ] `POST /v1/auth/refresh` → new access token, old refresh token revoked
- [ ] `POST /v1/auth/logout` → refresh token revoked
- [ ] `GET /v1/auth/me` with valid JWT → user object
- [ ] `GET /v1/auth/me` with expired JWT → 401
- [ ] `POST /v1/links` with valid JWT → 201 short URL
- [ ] `POST /v1/links` without JWT → 401
- [ ] `GET /v1/links` → list with click counts
- [ ] `DELETE /v1/links/:id` → 204, subsequent redirect returns 410
- [ ] `GET /:slug` → 302 redirect < 50ms
- [ ] `GET /unknown-slug` → 404
- [ ] `GET /expired-slug` → 410
- [ ] Click appears in Postgres `clicks` table within a few seconds
- [ ] Redis down → redirects still work via Postgres fallback
- [ ] 101 link creations from same user → 429 on 101st
- [ ] `GET /health` → `{ status: "ok" }`

---

## 12. API Contract

All endpoints are under `/v1/` except `GET /:slug` (redirect) and `GET /health`.

### Auth endpoints

#### `POST /v1/auth/register`

```json
// Request
{ "email": "user@example.com", "password": "min8chars", "name": "Alice" }

// Response 201
{
  "accessToken": "eyJ...",
  "refreshToken": "550e8400-...",
  "user": { "id": "uuid", "email": "user@example.com" }
}
```

Errors: `400` invalid input · `409` email already in use

---

#### `POST /v1/auth/login`

```json
// Request
{ "email": "user@example.com", "password": "mypassword" }

// Response 200
{
  "accessToken": "eyJ...",
  "refreshToken": "550e8400-...",
  "user": { "id": "uuid", "email": "user@example.com" }
}
```

Errors: `401` invalid credentials

---

#### `POST /v1/auth/refresh`

```json
// Request
{ "refreshToken": "550e8400-..." }

// Response 200
{
  "accessToken": "eyJ...",
  "refreshToken": "new-uuid-...",   // old token is revoked
  "user": { "id": "uuid", "email": "user@example.com" }
}
```

Errors: `401` invalid/expired/revoked token

---

#### `POST /v1/auth/logout`

Requires: `Authorization: Bearer <accessToken>`

```json
// Request
{ "refreshToken": "550e8400-..." }

// Response 200
{ "message": "Logged out" }
```

---

#### `GET /v1/auth/me`

Requires: `Authorization: Bearer <accessToken>`

```json
// Response 200
{ "id": "uuid", "email": "user@example.com", "name": "Alice", "createdAt": "..." }
```

Errors: `401` missing/invalid/expired token

---

### Link endpoints

All require `Authorization: Bearer <accessToken>`.

#### `POST /v1/links`

```json
// Request
{
  "destination": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "slug": "rickroll",       // optional
  "title": "Rick Astley",   // optional
  "expiresAt": "2026-12-31T23:59:59Z"  // optional
}

// Response 201
{
  "id": "uuid",
  "slug": "rickroll",
  "shortUrl": "https://lnkiq.io/rickroll",
  "destination": "https://...",
  "title": "Rick Astley",
  "expiresAt": "2026-12-31T23:59:59Z",
  "createdAt": "2026-06-27T10:00:00Z"
}
```

Errors: `400` invalid URL · `401` not authenticated · `409` slug taken · `422` reserved slug · `429` rate limit

---

#### `GET /v1/links`

```json
// Response 200
{
  "data": [
    {
      "id": "uuid",
      "slug": "rickroll",
      "shortUrl": "https://lnkiq.io/rickroll",
      "destination": "https://...",
      "clickCount": 1482,
      "createdAt": "2026-06-27T10:00:00Z"
    }
  ],
  "total": 1
}
```

---

#### `DELETE /v1/links/:id`

Response `204` — no body. Errors: `401` · `404` not found or not yours

---

### Redirect

#### `GET /:slug`

Response `302` — `Location: {destination}` header. No auth required.

Errors: `404` not found · `410` expired or deleted

---

### Health

#### `GET /health`

```json
{ "status": "ok", "checks": { "postgres": "up", "redis": "up" } }
```

---

## 13. Redis Key Design

| Key pattern | Value | TTL | Purpose |
|-------------|-------|-----|---------|
| `slug:{slug}` | JSON stringified link object | 24h | Redirect cache |
| `rate:create:{userId}` | sorted set of timestamps | 1h | Rate limiting (per user) |
| `dedup:{ip_hash}:{link_id}` | `1` | 30m | Click deduplication |
| `bull:click-events:*` | BullMQ job data | managed by BullMQ | Click event queue |

**Rules:**
- Always prefix with the entity (`slug:`, `rate:`, `dedup:`)
- Rate limiting is now per `userId`, not per IP — users are authenticated
- Never store raw IPs — only hashed form in `dedup:`
- All application keys have explicit TTLs

---

## 14. Environment Variables

```bash
# App
APP_PORT=3000
NODE_ENV=development
APP_BASE_URL=https://lnkiq.io
CORS_ORIGIN=https://app.lnkiq.io    # or http://localhost:3001 in dev

# Postgres
DATABASE_URL=postgresql://linkiq:secret@localhost:5432/linkiq?connection_limit=10

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=a-long-random-secret-string-change-in-prod
JWT_REFRESH_SECRET=another-long-random-secret-string   # separate secret for refresh tokens

# Security
DAILY_SALT=change-this-to-a-random-string   # rotated daily via Secret Manager in prod

# GCP (prod only)
GCP_PROJECT_ID=linkiq-prod
GCP_LOCATION=asia-south1   # Mumbai — closest to Chennai
```

---

## 15. Performance Targets

| Metric | Target | How |
|--------|--------|-----|
| Redirect latency (cache hit) | < 50ms p99 | Redis in Memorystore, same VPC as Cloud Run |
| Redirect latency (cache miss) | < 200ms p99 | Postgres with index on `slug` |
| Login latency | < 400ms p99 | bcrypt cost factor 12 (~250ms hash) + DB query |
| Link creation latency | < 300ms p99 | Prisma insert + Redis SET |
| Click tracking latency | 0ms (async) | Fire-and-forget via BullMQ |
| Uptime | 99.9% | Cloud Run min 1 instance, health checks |
| Rate limit | 100 creations/user/hr | Redis sliding window |

> **bcrypt note:** rounds=12 takes ~250ms intentionally — that's the point. It makes brute-forcing passwords computationally expensive. Don't optimize this away.

### How to measure

- `k6` for load testing locally
- Cloud Run dashboard: p50/p95/p99 latency
- `durationMs` in every log line for Cloud Logging queries
- `bull-board` (optional) for BullMQ queue health

---

## 16. Phase 2 Product Bridge Notes

Phase 1 is designed so Phase 2 (multi-tenant analytics) is purely additive — only new migrations and new modules.

### What Phase 2 adds to the schema

```prisma
model Organisation {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  slug      String   @unique
  plan      String   @default("free")
  createdAt DateTime @default(now()) @map("created_at")
  users     User[]
  links     Link[]
  @@map("organisations")
}
// npx prisma migrate dev --name add_organisations
// Then: ALTER TABLE users ADD COLUMN org_id, ALTER TABLE links ADD COLUMN org_id
```

### What Phase 2 adds to auth

- Email verification on register (send token via email, verify endpoint)
- Password reset flow (`POST /auth/forgot-password`, `POST /auth/reset-password`)
- OAuth / social login (Google, GitHub) via Passport strategies
- Session listing: `GET /auth/sessions` → list active refresh tokens for current user
- `POST /auth/sessions/:id/revoke` → revoke a specific device session

### What Phase 2 adds to the architecture

- Tenant middleware injects `orgId` into every request
- Row Level Security on Postgres (per-org data isolation)
- Hourly rollup BullMQ job: `clicks` → `click_hourly_rollups`
- WebSocket gateway for real-time click counter

### BullMQ scale path

When Phase 2 click volume grows:
1. Move `ClicksProcessor` to a dedicated `worker.ts` entry point
2. Deploy as a separate Cloud Run service pointing at the same Redis
3. `QueueService` (producer) and queue name unchanged — zero API change

---

*Plan version 3.0 — June 2026 — Backend (NestJS) only*
*Frontend (Next.js or other) is a separate project*
