# LinkIQ Architecture

> **Stack:** NestJS 11 · PostgreSQL · Redis · Prisma ORM 7 · BullMQ 5  
> **Monorepo:** NestJS CLI (not Nx) — 2 apps, 4 shared libs  
> **Deployment target:** GCP Cloud Run + Cloud SQL + Memorystore  
> **Status:** Phase 1 code complete (~90%). Missing: Prisma migrations, Dockerfile, GCP deploy, tests.

---

## 1. Monorepo Configuration

### 1.1 `nest-cli.json`

Defines 6 projects:

| Project | Type | Root | Entry |
|---|---|---|---|
| `api` | Application | `apps/api` | `main` |
| `worker` | Application | `apps/worker` | `main` |
| `prisma` | Library | `libs/prisma` | `index` |
| `cache` | Library | `libs/cache` | `index` |
| `common` | Library | `libs/common` | `index` |
| `queue` | Library | `libs/queue` | `index` |

Build uses `tsc` (not webpack). Output to `dist/`.

### 1.2 TypeScript Config

Root `tsconfig.json` — extended by all apps and libs. Key settings:

| Setting | Value | Purpose |
|---|---|---|
| `module` | `commonjs` | NestJS standard |
| `target` | `ES2023` | Modern Node.js |
| `esModuleInterop` | `true` | CJS/ESM interop |
| `emitDecoratorMetadata` | `true` | NestJS DI |
| `experimentalDecorators` | `true` | NestJS decorators |
| `strictNullChecks` | `true` | Null safety |
| `noImplicitAny` | `true` | Explicit types |
| `baseUrl` | *(removed)* | Deprecated in TS 6+ |

Path aliases (all prefixed with `./` since `baseUrl` is absent):

| Alias | Resolves to |
|---|---|
| `@app/prisma` | `./libs/prisma/src` |
| `@app/cache` | `./libs/cache/src` |
| `@app/common` | `./libs/common/src` |
| `@app/queue` | `./libs/queue/src` |

### 1.3 Package Scripts

| Command | Action |
|---|---|
| `npm run build` | Build API app |
| `npm run build:worker` | Build worker app |
| `npm run start:dev` | Watch-mode API dev server |
| `npm run start:worker:dev` | Watch-mode worker dev server |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:reset` | Reset DB (force) |
| `npm run lint` | ESLint + Prettier |
| `npm run test` | Jest unit tests |
| `npm run test:e2e` | Jest e2e tests |

### 1.4 Code Quality

- **ESLint:** Flat config (`eslint.config.mjs`) with `typescript-eslint`, Prettier plugin
- **Prettier:** Single quotes, trailing commas
- **No `baseUrl`:** Removed to avoid deprecation in TypeScript 6/7. Paths use `./` prefix.

---

## 2. Repository Structure

```
linkiq/
├── apps/
│   ├── api/src/                        # HTTP server
│   │   ├── main.ts                     # Bootstrap, CORS, global prefix, filters
│   │   ├── app.module.ts               # Root module
│   │   ├── auth/                       # Authentication
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── dto/                    # register.dto, login.dto, auth-response.dto
│   │   │   ├── guards/                 # jwt-auth.guard, local-auth.guard
│   │   │   └── strategies/             # jwt.strategy, local.strategy
│   │   ├── users/                      # User data access
│   │   │   ├── users.module.ts
│   │   │   ├── users.service.ts
│   │   │   └── dto/                    # user-response.dto
│   │   ├── links/                      # Link CRUD + read resolver
│   │   │   ├── links.module.ts
│   │   │   ├── links.controller.ts
│   │   │   ├── links.service.ts         # Write path (create, list, delete)
│   │   │   ├── links.repository.ts      # Prisma queries
│   │   │   ├── link-resolver.service.ts  # Read path (cache + DB resolution)
│   │   │   └── dto/                    # create-link.dto, link-response.dto
│   │   ├── redirect/                   # Redirect engine (hot path)
│   │   │   ├── redirect.module.ts
│   │   │   ├── redirect.controller.ts
│   │   │   └── redirect.service.ts
│   │   └── health/                     # Health check
│   │       ├── health.module.ts
│   │       └── health.controller.ts
│   └── worker/src/                     # Background job processor
│       ├── main.ts                     # Headless NestJS context
│       ├── worker.module.ts
│       ├── queue.config.ts             # Queue config (concurrency, defaults, schedules)
│       └── clicks/
│           ├── clicks.module.ts
│           ├── clicks.processor.ts      # Consumes click-events queue
│           ├── clicks.service.ts        # GeoIP, UA parsing, dedup, DB insert
│           └── cleanup.processor.ts     # Consumes cleanup queue, schedules repeatable jobs
├── libs/
│   ├── prisma/                         # Database (Global)
│   │   ├── schema.prisma
│   │   ├── prisma.config.ts            # Prisma CLI config (custom schema path)
│   │   └── src/
│   │       ├── index.ts
│   │       ├── prisma.module.ts         # @Global()
│   │       └── prisma.service.ts        # PrismaClient + PrismaPg adapter
│   ├── cache/                          # Redis (Global)
│   │   └── src/
│   │       ├── index.ts
│   │       ├── cache.module.ts          # @Global()
│   │       └── cache.service.ts         # ioredis wrapper
│   ├── queue/                          # Queue producer (shared)
│   │   └── src/
│   │       ├── index.ts
│   │       ├── queue.constants.ts       # QUEUES = { CLICK_EVENTS, CLEANUP }
│   │       ├── queue.module.ts          # Registers click-events queue
│   │       └── queue.service.ts         # enqueueClick producer
│   └── common/                         # Shared utilities
│       └── src/
│           ├── index.ts
│           ├── decorators/             # @CurrentUser()
│           ├── filters/                # HttpExceptionFilter
│           ├── guards/                 # RateLimitGuard
│           ├── interceptors/           # LoggingInterceptor
│           ├── utils/                  # slug.util (nanoid, reserved words)
│           └── validators/             # IsSafeUrl decorator
├── docs/
│   ├── ARCHITECTURE.md                 # This file
│   └── IMPLEMENTATION.md               # Original build plan
├── test/
│   ├── app.e2e-spec.ts                 # Boilerplate (not updated)
│   └── jest-e2e.json
├── .env                                # Local dev environment
├── nest-cli.json
├── tsconfig.json
├── tsconfig.build.json
├── eslint.config.mjs
├── .prettierrc
└── package.json
```

---

## 3. Applications

### 3.1 API App (`apps/api`)

HTTP server at `APP_PORT` (default 3000). Handles all public and authenticated routes.

#### 3.1.1 Bootstrap (`main.ts`)

```typescript
// BigInt serialization (Prisma Click.id is BIGSERIAL)
(BigInt.prototype as any).toJSON = function () { return this.toString(); };

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({ origin: CORS_ORIGIN, credentials: true });
  app.setGlobalPrefix('v1', { exclude: ['/:slug', '/health'] });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,              // Strip unknown properties
    forbidNonWhitelisted: true,   // Throw on unknown properties
    transform: true,              // Auto-transform types
  }));

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  await app.listen(process.env.APP_PORT ?? 3000);
}
```

#### 3.1.2 Module Graph

```
AppModule
 ├── PrismaModule (@Global)          → PrismaService
 ├── CacheModule  (@Global)          → CacheService (Redis)
 ├── BullModule.forRoot              → BullMQ connection (Redis)
 ├── UsersModule                     → UsersService
 │    (no imports)
 ├── AuthModule                      → AuthService, JwtStrategy, LocalStrategy
 │    └── imports: UsersModule, PassportModule, JwtModule
 │    └── exports: JwtAuthGuard
 ├── QueueModule                     → QueueService (producer)
 │    └── registers: click-events queue
 ├── LinksModule                     → LinksService, LinksRepository, LinkResolverService
 │    └── imports: AuthModule, QueueModule
 │    └── exports: LinksRepository, LinkResolverService
 ├── RedirectModule                  → RedirectService
 │    └── imports: LinksModule, QueueModule
 └── HealthModule                    → HealthController
      └── imports: TerminusModule
```

#### 3.1.3 Auth Module

**Files:** `auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `dto/`, `guards/`, `strategies/`

**Endpoints:**

| Method | Path | Auth | Guard | Rate Limited |
|---|---|---|---|---|
| `POST` | `/v1/auth/register` | No | — | No |
| `POST` | `/v1/auth/login` | No | `LocalAuthGuard` | No |
| `POST` | `/v1/auth/refresh` | No | — | No |
| `POST` | `/v1/auth/logout` | Yes | `JwtAuthGuard` | No |
| `GET` | `/v1/auth/me` | Yes | `JwtAuthGuard` | No |

**AuthService methods:**

- `validateUser(email, password)` — `findByEmail` + `bcrypt.compare`. Throws `401` on mismatch.
- `register(dto)` — checks email uniqueness, hashes password (bcrypt rounds=12), creates user, issues tokens.
- `login(user)` — issues tokens for authenticated user.
- `refresh(token)` — validates refresh token (exists, not revoked, not expired), revokes old, issues new pair.
- `logout(token)` — sets `revoked_at` on matching refresh token.

**Token issuance (`issueTokens`):**
```typescript
const accessToken = jwtService.sign(
  { sub: user.id, email: user.email },
  { secret: JWT_SECRET, expiresIn: '15m' },
);
const refreshToken = uuidv4(); // opaque, not a JWT
const expiresAt = now + 7 days;
prisma.refreshToken.create({ data: { userId, token: refreshToken, expiresAt } });
return { accessToken, refreshToken, user: { id, email } };
```

**Passport strategies:**

| Strategy | Strategy Class | Guard | Used On |
|---|---|---|---|
| `local` | `LocalStrategy` (email/password) | `LocalAuthGuard` | `POST /login` |
| `jwt` | `JwtStrategy` (Bearer token) | `JwtAuthGuard` | `/logout`, `/me`, all `/links` |

**DTOs:**

| DTO | Fields | Validation |
|---|---|---|
| `RegisterDto` | `email`, `password` (min 8), `name?` | `@IsEmail`, `@MinLength(8)`, `@IsOptional` |
| `LoginDto` | `email`, `password` | `@IsEmail`, `@IsString` |
| `AuthResponseDto` | `accessToken`, `refreshToken`, `user` | — |

**`GET /auth/me` — known gap:** Returns only `{ id, email }` from JWT payload. Does not query DB for `name` / `createdAt`.

#### 3.1.4 Users Module

**Files:** `users.module.ts`, `users.service.ts`, `dto/user-response.dto.ts`

Simple data-access layer. Not a controller — only used internally by `AuthModule`.

| Method | Returns | Notes |
|---|---|---|
| `findByEmail(email)` | Full user (incl. password hash) | Used by auth for credential validation |
| `findById(id)` | `{ id, email, name, createdAt }` | Public profile (no password) |
| `create({ email, password, name })` | `{ id, email, name, createdAt }` | Hashes password with bcrypt rounds=12 |

#### 3.1.5 Links Module

**Files:** `links.module.ts`, `links.controller.ts`, `links.service.ts`, `links.repository.ts`, `link-resolver.service.ts`, `dto/`

Two services with distinct responsibilities:

```
Write path:    LinksController → LinksService → LinksRepository → Prisma
                                              → CacheService (warm/invalidate)

Read path:     RedirectService → LinkResolverService → CacheService (lookup/populate)
                                                      → LinksRepository (fallback)
```

**LinksController** — all routes require `JwtAuthGuard`:

| Method | Path | Guard | Description |
|---|---|---|---|
| `POST` | `/v1/links` | `JwtAuthGuard` + `RateLimitGuard` | Create short link (100/hr) |
| `GET` | `/v1/links` | `JwtAuthGuard` | List user's links |
| `DELETE` | `/v1/links/:id` | `JwtAuthGuard` | Soft-delete link |

**LinksService** (write path):

| Method | Key Behavior |
|---|---|
| `create(dto, userId)` | Check reserved slug → retry loop (3x) on slug collision → insert → warm cache → return with `shortUrl` |
| `findAllByUser(userId)` | List with `_count.clicks` → map `clickCount` + `shortUrl` |
| `delete(id, userId)` | Ownership check via `findById` → soft delete → evict cache |

Slug collision handling:
- Auto-generated slug (no `dto.slug`): retry with new slug on `P2002`, up to 3 attempts, then `500`
- Custom slug (`dto.slug`): `409 Conflict` on first `P2002`

**LinksRepository** — thin wrapper over Prisma:

| Method | Prisma Query |
|---|---|
| `create(data)` | `prisma.link.create` |
| `findById(id)` | `findFirst` where `id` + `deletedAt: null` |
| `findBySlug(slug)` | `findFirst` where `slug` + `deletedAt: null` |
| `findAllByUser(userId)` | `findMany` with `_count.clicks`, ordered by `createdAt desc` |
| `softDelete(id, userId)` | `updateMany` setting `deletedAt: now()` (scoped to both `id` + `userId`) |

**LinkResolverService** (read path):

```typescript
async resolveBySlug(slug: string): Promise<ResolvedLink | null> {
  // 1. Try Redis cache
  // 2. On miss, try Postgres
  // 3. On Postgres hit, populate cache
  // 4. Return link or null
}
```

`ResolvedLink` shape: `{ id, destination, deletedAt, expiresAt }`.

**DTOs:**

| DTO | Fields | Validation |
|---|---|---|
| `CreateLinkDto` | `destination`, `slug?`, `title?`, `expiresAt?` | `@IsSafeUrl`, `@MaxLength(50/120)`, `@IsDateString` |
| `LinkResponseDto` | `id`, `slug`, `shortUrl`, `destination`, `title`, `expiresAt`, `createdAt`, `clickCount?` | — |

#### 3.1.6 Redirect Module

**Files:** `redirect.module.ts`, `redirect.controller.ts`, `redirect.service.ts`

**The hot path.** No auth. No global prefix (registered at root `/`).

```
GET /:slug
  → RedirectController (no @Controller prefix)
  → RedirectService.redirect(slug, req, res)
     │
     ├── LinkResolverService.resolveBySlug(slug)
     │   ├── Cache GET slug:{slug}
     │   │   ├── HIT → parse → return
     │   │   └── MISS → Prisma findBySlug → Cache SET (24h) → return
     │   └── Redis error → fall through to Postgres (logged as warning)
     │
     ├── null      → 404
     ├── deleted   → 410
     ├── expired   → 410
     ├── valid     → 302 → Location: destination
     │
     └── void QueueService.enqueueClick({…})  ← fire-and-forget, after response

Response is sent (302) BEFORE the async click enqueue.
```

`RedirectService` depends ONLY on `LinkResolverService` + `QueueService` — never touches `CacheService` or `LinksRepository` directly.

#### 3.1.7 Health Module

**Files:** `health.module.ts`, `health.controller.ts`

Uses `@nestjs/terminus` with two health indicators:

| Check | Method | Failure |
|---|---|---|
| Postgres | `PrismaHealthIndicator.pingCheck` | DB unreachable |
| Redis | Manual `cache.client.ping()` | Redis unreachable |

Route: `GET /health` (no `/v1` prefix).

---

### 3.2 Worker App (`apps/worker`)

Headless NestJS application context — no HTTP listener. Runs BullMQ workers for background job processing.

#### 3.2.1 Bootstrap (`main.ts`)

```typescript
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  await app.init();
}
```

**Known gap:** No graceful shutdown handler. `app.enableShutdownHooks()` not called.

#### 3.2.2 Module Graph

```
WorkerModule
 ├── PrismaModule (@Global)
 ├── CacheModule  (@Global)
 ├── BullModule.forRoot              connection from queue.config.ts
 └── ClicksModule
      ├── BullModule.registerQueue   click-events (with defaultJobOptions)
      ├── BullModule.registerQueue   cleanup (with defaultJobOptions)
      ├── ClicksProcessor            @Processor('click-events', concurrency: 5)
      ├── CleanupProcessor           @Processor('cleanup', concurrency: 1)
      └── ClicksService              recordClick, hashIp, parseReferer
```

#### 3.2.3 Queue Config (`queue.config.ts`)

Single source of truth for all queue behavior. Lives in the worker app (not shared lib).

```typescript
export const CONCURRENCY = {
  CLICK_EVENTS: 5,
  CLEANUP: 1,
};

export const QUEUE_DEFAULTS = {
  'click-events': {
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  },
  'cleanup': {
    defaultJobOptions: {
      attempts: 3,
      removeOnComplete: 10,
      removeOnFail: 50,
    },
  },
};

export function getQueueConnection(): ConnectionOptions {
  return { host: REDIS_HOST, port: REDIS_PORT };
}

export const CLEANUP_SCHEDULE = {
  EXPIRED_SLUGS:  { pattern: '0 2 * * *', jobId: 'cleanup-expired-slugs' },
  REFRESH_TOKENS: { pattern: '0 3 * * *', jobId: 'cleanup-refresh-tokens' },
};
```

#### 3.2.4 ClicksProcessor

Consumes `click-events` queue. Concurrency: 5 (5 jobs in parallel).

```typescript
@Processor('click-events', { concurrency: 5 })
async process(job) {
  await this.clicksService.recordClick(job.data);
}
```

#### 3.2.5 ClicksService

**`onModuleInit`:** Loads GeoIP database sync (`geoip.reloadDataSync()`).

**`recordClick(data)`:**
```
1. Hash IP: SHA-256(ip + YYYY-MM-DD)
2. Dedup check: Redis SET NX dedup:{ipHash}:{linkId} (30m TTL)
   → false → skip (already processed this session)
3. GeoIP: country + city (geoip-lite)
4. UA parse: device_type (ua-parser-js, default: 'desktop')
5. Referer classify: direct | instagram | tiktok | twitter | facebook | linkedin | other
6. Prisma INSERT click
```

**`hashIp(ip)`:**
```typescript
const salt = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
return createHash('sha256').update(ip + salt).digest('hex');
```

Daily salt rotation means IPs cannot be reconstructed across days. Known limitation: at midnight, dedup window resets, causing minor overcount.

**`parseReferer(referer?)`:** Categorizes into `direct`, `instagram`, `tiktok`, `twitter`, `facebook`, `linkedin`, `other`.

#### 3.2.6 CleanupProcessor

Consumes `cleanup` queue. Also schedules its own repeatable jobs on bootstrap (`OnApplicationBootstrap`).

| Job | Schedule | Action |
|---|---|---|
| `cleanup-expired-slugs` | Daily 2AM | Redis `DEL` for links where `expiresAt < now()` |
| `cleanup-refresh-tokens` | Daily 3AM | Prisma `deleteMany` where revoked/expired AND older than 30 days |

---

## 4. Shared Libraries

### 4.1 Prisma (`@app/prisma`) — `@Global()`

Uses **Prisma driver adapter** (`@prisma/adapter-pg`), not the binary engine. This connects directly via the `pg` driver rather than spawning a binary.

```typescript
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })

// PrismaService
const adapter = new PrismaPg(process.env.DATABASE_URL!);
super({ adapter });
```

**Schema** at `libs/prisma/schema.prisma` — 4 models mapped to snake_case via `@@map`:

```
users
 ├── id             UUID          PK @default(uuid())
 ├── email          String        UNIQUE
 ├── password       String        bcrypt hash (rounds=12)
 ├── name           String?
 ├── created_at     DateTime      @default(now())
 └── updated_at     DateTime      @updatedAt

refresh_tokens
 ├── id             UUID          PK @default(uuid())
 ├── user_id        UUID          FK → users (CASCADE)
 ├── token          String        UNIQUE (opaque UUID v4)
 ├── expires_at     DateTime      7 days
 ├── created_at     DateTime      @default(now())
 ├── revoked_at     DateTime?     NULL = active
 └── INDEX (token), INDEX (user_id)

links
 ├── id             UUID          PK @default(uuid())
 ├── slug           String        UNIQUE (nanoid(7) or custom)
 ├── destination    String        Validated safe URL
 ├── user_id        UUID          FK → users (CASCADE)
 ├── title          String?
 ├── expires_at     DateTime?
 ├── deleted_at     DateTime?     NULL = active
 ├── created_at     DateTime      @default(now())
 ├── INDEX (slug)                 (no condition — Prisma limitation)
 └── INDEX (user_id)

clicks
 ├── id             BigInt        PK @default(autoincrement())
 ├── link_id        UUID          FK → links
 ├── clicked_at     DateTime      @default(now())
 ├── ip_hash        String?       SHA-256(ip + daily_salt)
 ├── country        String?       GeoIP lookup
 ├── city           String?
 ├── user_agent     String?
 ├── referer        String?       Categorized (not raw URL)
 ├── device_type    String?       desktop | mobile | tablet
 └── INDEX (link_id, clicked_at DESC)
```

**Prisma CLI config** (`prisma.config.ts`):
```typescript
export default defineConfig({
  schema: "schema.prisma",
  migrations: { path: "migrations" },
  datasource: { url: process.env["DATABASE_URL"] },
});
```

Custom output path: `../../node_modules/.prisma/client`.

**Known gap:** No `migrations/` directory has ever been created. Run `npm run prisma:generate` then `npx prisma migrate dev --name init` to create tables.

### 4.2 Cache (`@app/cache`) — `@Global()`

Wraps an `ioredis` client.

```typescript
CacheService
 ├── .client          → raw Redis instance (for manual commands)
 ├── .get(key)        → Promise<string | null>
 ├── .set(key, val, ttlSec)
 ├── .del(key)
 └── .setNX(key, val, ttlSec) → Promise<boolean>
```

Connection from `REDIS_HOST` / `REDIS_PORT`. `maxRetriesPerRequest: 3`. Errors are logged, never thrown. Graceful shutdown via `OnModuleDestroy` (`.quit()`).

### 4.3 Queue (`@app/queue`)

The producer library. API app imports this to enqueue click events.

```typescript
// queue.constants.ts
export const QUEUES = { CLICK_EVENTS: 'click-events', CLEANUP: 'cleanup' };

// queue.module.ts — registers click-events queue (no defaultJobOptions — worker sets those)
BullModule.registerQueue({ name: QUEUES.CLICK_EVENTS });

// queue.service.ts
async enqueueClick(payload: ClickPayload) {
  await this.clickQueue.add('process-click', payload, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}
```

`ClickPayload`: `{ linkId, ip, userAgent?, referer?, timestamp, correlationId }`.

Queue registration is idempotent — both API and worker register the same queues. The worker applies `defaultJobOptions`; the API just declares existence.

### 4.4 Common (`@app/common`)

Not `@Global()`. Imported explicitly where needed.

| Export | Type | Purpose |
|---|---|---|
| `@CurrentUser()` | Decorator | Extracts `req.user` from JWT payload |
| `HttpExceptionFilter` | Filter | `{ statusCode, message, timestamp, path }` |
| `RateLimitGuard` | Guard | Redis sorted-set sliding window, 100 creates/user/hr |
| `LoggingInterceptor` | Interceptor | Correlation ID, method, path, statusCode, durationMs |
| `generateSlug()` | Util | `nanoid(7)` with URL-safe alphabet (62 chars) |
| `isReserved(slug)` | Util | Checks against 17 reserved words |
| `IsSafeUrl()` | Validator | Blocks private IPs, localhost, non-http(s), >2048 chars |

**Reserved slugs** (`slug.util.ts`):
```
api, admin, health, dashboard, login, signup, register, logout,
static, assets, favicon, v1, auth, links, redirect, user, users
```

**Rate limiting** (`RateLimitGuard`):
```typescript
const key = `rate:create:${user.id}`;
const now = Date.now();
const window = 3600 * 1000;  // 1 hour
const limit = 100;

redis.zadd(key, now, `${now}-${Math.random()}`);
redis.zremrangebyscore(key, 0, now - window);
const count = redis.zcard(key);
redis.expire(key, 3600);

if (count > limit) throw 429;
```

**Logging** (`LoggingInterceptor`):
```typescript
// On each request:
const correlationId = req.headers['x-correlation-id'] ?? uuidv4();
req.correlationId = correlationId;

// On success:
{ correlationId, method, path, statusCode, durationMs, userId }

// On error:
{ correlationId, method, path, statusCode, durationMs, userId, error }
```

**URL validation** (`IsSafeUrl`):
- Must be `http://` or `https://`
- Max 2048 characters
- Rejects `localhost`, `127.*`, `0.0.0.0`, `10.*`, `172.16-31.*`, `192.168.*`

---

## 5. Redis Key Design

| Key Pattern | Type | TTL | Set By | Purpose |
|---|---|---|---|---|
| `slug:{slug}` | String | 24h | `LinksService.create` (warm), `LinkResolverService.resolveBySlug` (populate) | Redirect cache |
| `rate:create:{userId}` | Sorted Set | 1h | `RateLimitGuard.canActivate` | Sliding window rate limit |
| `dedup:{ipHash}:{linkId}` | String | 30m | `ClicksService.recordClick` (NX) | Click deduplication |
| `bull:click-events:*` | Various | BullMQ | BullMQ | Click event queue |
| `bull:cleanup:*` | Various | BullMQ | BullMQ | Cleanup queue |

Rules:
- Prefix with entity type (`slug:`, `rate:`, `dedup:`)
- All application keys have explicit TTLs
- No raw IPs stored (only SHA-256 hashes)

---

## 6. Data Flows

### 6.1 Authentication

```
POST /v1/auth/register
  → RegisterDto validated (email + password min 8 chars)
  → AuthService.register()
  → UsersService.findByEmail()     → 409 if exists
  → UsersService.create()           → bcrypt(password, 12)
  → issueTokens()                   → JWT(15m, sub=id) + refresh UUID(7d)
  → Prisma: INSERT refresh_tokens
  → 201 { accessToken, refreshToken, user }

POST /v1/auth/login
  → LocalAuthGuard → LocalStrategy.validate(email, password)
  → AuthService.validateUser()      → findByEmail + bcrypt.compare → 401 if fail
  → AuthService.login()             → issueTokens()
  → 200 { accessToken, refreshToken, user }

POST /v1/auth/refresh
  → Body: { refreshToken }
  → AuthService.refresh(token)
  → Prisma: findUnique where token
  → Check: not revoked, not expired                        → 401 if invalid
  → Prisma: UPDATE revoked_at on old token (rotation)
  → issueTokens() with NEW refresh token
  → 200 { accessToken, refreshToken, user }

POST /v1/auth/logout
  → JwtAuthGuard required
  → Body: { refreshToken }
  → AuthService.logout(token)
  → Prisma: UPDATE revoked_at where token and revokedAt IS NULL
  → 200 { message: 'Logged out' }

GET /v1/auth/me
  → JwtAuthGuard required
  → Returns JWT payload: { id, email }           ← known gap: no DB profile lookup
```

### 6.2 Redirect (Hot Path)

```
GET /{slug}
  → No auth, no prefix
  → RedirectService.redirect(slug, req, res)
     │
     ├── LinkResolverService.resolveBySlug(slug)
     │   ├── TRY cache.get(`slug:{slug}`)
     │   │   ├── OK + hit → JSON.parse → return ResolvedLink
     │   │   ├── OK + miss → ↓
     │   │   └── Error → log warn, fall through to DB
     │   │
     │   │   LinksRepository.findBySlug(slug)
     │   │   ├── found → cache.set(`slug:{slug}`, 86400) → return
     │   │   └── null  → return null
     │   │
     │   └── return ResolvedLink | null
     │
     ├── null                                       → 404
     ├── link.deletedAt ≠ null                       → 410
     ├── link.expiresAt < now()                      → 410
     ├── valid                                       → 302 Location: link.destination
     │
     └── (async, fire-and-forget)
         QueueService.enqueueClick({
           linkId, ip, userAgent, referer, timestamp, correlationId
         })
         → BullMQ click-events queue
```

### 6.3 Link CRUD

```
POST /v1/links (JWT required)
  → RateLimitGuard (100/hr, Redis sorted set)      → 429 if exceeded
  → LinksService.create(dto, userId)
  → isReserved(slug)                                → 422 if reserved
  → generateSlug() / use custom slug
  → try LinksRepository.create()
  → on P2002:
      auto-slug → retry with new slug (up to 3x)   → 500 if exhausted
      custom    → 409 Conflict
  → cache.set(`slug:{slug}`, 86400)                 ← warm cache at write
  → 201 { ...link, shortUrl: APP_BASE_URL/slug }

GET /v1/links (JWT required)
  → LinksService.findAllByUser(userId)
  → LinksRepository.findAllByUser()
     → Prisma: findMany with _count.clicks
  → Return { data: [...], total }

DELETE /v1/links/:id (JWT required)
  → LinksService.delete(id, userId)
  → findById(id)                                     → 404 if not found or not owner
  → softDelete(id, userId)                           → sets deleted_at
  → cache.del(`slug:{slug}`)                         ← evict cache
  → 204 No Content
```

### 6.4 Click Tracking

```
API: 302 response sent → void enqueueClick(payload)
                                    ↓
                        BullMQ: click-events queue
                                    ↓
Worker: ClicksProcessor.process(job)
          → ClicksService.recordClick(data)
               │
               ├── hashIp(ip): SHA-256(ip + YYYY-MM-DD)
               │
               ├── dedupKey = `dedup:{ipHash}:{linkId}`
               │   cache.setNX(dedupKey, '1', 1800)
               │   ├── false → already processed → return (logged as debug)
               │   └── true  → continue
               │
               ├── geo = geoip.lookup(ip)
               │   → country, city (or null)
               │
               ├── ua = UAParser(userAgent)
               │   → deviceType (mobile/tablet/desktop, default: desktop)
               │
               ├── referer = parseReferer(referer)
               │   → direct | instagram | tiktok | twitter | facebook | linkedin | other
               │
               └── Prisma: INSERT click
                     { linkId, clickedAt, ipHash, country, city, userAgent, referer, deviceType }
```

### 6.5 Cleanup Jobs

Scheduled by `CleanupProcessor.onApplicationBootstrap()`:

```
Worker starts
  → CleanupProcessor.onApplicationBootstrap()
  → cleanupQueue.add('cleanup-expired-slugs',  {}, { repeat: { pattern: '0 2 * * *' } })
  → cleanupQueue.add('cleanup-refresh-tokens', {}, { repeat: { pattern: '0 3 * * *' } })

Daily 2AM — cleanup-expired-slugs:
  → Prisma: findMany links where expiresAt < now() AND deletedAt IS NULL
  → For each: Redis DEL slug:{slug}
  → Log count

Daily 3AM — cleanup-refresh-tokens:
  → Prisma: deleteMany refresh_tokens
     WHERE (revokedAt IS NOT NULL OR expiresAt < now())
     AND createdAt < 30 days ago
  → Log count
```

---

## 7. API Reference

### 7.1 Auth

#### `POST /v1/auth/register`

```
Request:  { "email": "string", "password": "string (min 8)", "name?": "string" }
Response: 201 { "accessToken", "refreshToken", "user": { "id", "email" } }
Errors:   400 invalid input, 409 email exists
```

#### `POST /v1/auth/login`

```
Request:  { "email": "string", "password": "string" }
Response: 200 { "accessToken", "refreshToken", "user": { "id", "email" } }
Errors:   401 invalid credentials
```

#### `POST /v1/auth/refresh`

```
Request:  { "refreshToken": "uuid-string" }
Response: 200 { "accessToken", "refreshToken (new)", "user": { "id", "email" } }
Errors:   401 invalid/expired/revoked token
```

#### `POST /v1/auth/logout`

```
Headers:  Authorization: Bearer <accessToken>
Request:  { "refreshToken": "uuid-string" }
Response: 200 { "message": "Logged out" }
Errors:   401 missing/invalid token, 400 missing refreshToken
```

#### `GET /v1/auth/me`

```
Headers:  Authorization: Bearer <accessToken>
Response: 200 { "id", "email" }
Errors:   401 missing/invalid/expired token
```

### 7.2 Links

All require `Authorization: Bearer <accessToken>`.

#### `POST /v1/links`

```
Request:  { "destination": "https://...", "slug?": "string (max 50)", "title?": "string (max 120)", "expiresAt?": "ISO date" }
Response: 201 { "id", "slug", "shortUrl", "destination", "title", "expiresAt", "createdAt" }
Errors:   400 invalid URL, 401 not authenticated, 409 slug taken, 422 reserved slug, 429 rate limit
```

#### `GET /v1/links`

```
Response: 200 { "data": [{ "id", "slug", "shortUrl", "destination", "clickCount", "createdAt" }], "total": number }
```

#### `DELETE /v1/links/:id`

```
Response: 204 No Content
Errors:   401 not authenticated, 404 not found or not owner
```

### 7.3 Redirect

#### `GET /:slug`

```
Response: 302 Location: <destination>
Errors:   404 not found, 410 deleted or expired
```

### 7.4 Health

#### `GET /health`

```
Response: 200 { "status": "ok", "info": { "postgres": { "status": "up" }, "redis": { "status": "up" } } }
```

---

## 8. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `APP_PORT` | No | `3000` | API HTTP listen port |
| `NODE_ENV` | No | `development` | Environment |
| `APP_BASE_URL` | Yes | — | Base for short URLs (e.g. `https://lnkiq.io`) |
| `CORS_ORIGIN` | Yes | — | Allowed CORS origin (e.g. `https://app.lnkiq.io`) |
| `DATABASE_URL` | Yes | — | Postgres connection string (include `?connection_limit=10`) |
| `REDIS_HOST` | No | `localhost` | Redis host |
| `REDIS_PORT` | No | `6379` | Redis port |
| `JWT_SECRET` | Yes | — | HMAC secret for access token JWTs |
| `DAILY_SALT` | Yes | — | Salt for IP hashing (rotate daily in production) |

---

## 9. Design Decisions

### 9.1 Separate API and Worker processes

Instead of running BullMQ workers in-process (as the IMPLEMENTATION.md plan originally specified), the project uses two independent NestJS application contexts. This enables independent horizontal scaling — API scales on HTTP request volume, worker scales on queue depth. Both share the same Redis instance for BullMQ coordination and the same Postgres database.

### 9.2 Worker-owned queue configuration

All queue behavior (concurrency, job options, retry policies, schedules) is defined in `apps/worker/src/queue.config.ts`. The shared `@app/queue` lib only exposes queue name constants (`QUEUES`). The worker decides how queues behave; the API only needs to know which queues exist to produce messages.

### 9.3 Read/Write path separation

```
Read path:  RedirectService → LinkResolverService → Cache + Repository
Write path: LinksService    → Repository + Cache (warm/invalidate)
```

`LinkResolverService` owns the full read contract: cache-first lookup, DB fallback, cache population on miss, Redis failure handling. `LinksService` owns write contracts: create with cache warming, delete with cache eviction. `RedirectService` depends only on the resolver — it never touches `CacheService` or `LinksRepository`. This keeps the hot path (redirect) isolated from CRUD complexity and prevents accidental write-path changes from affecting redirect latency.

### 9.4 Cache-aside with write-through warming

Links are written to Redis at creation time (not lazily on first read). This guarantees the very first click on any link is a cache hit — no cold-start latency penalty. TTL is 24 hours, refreshed on every cache hit during redirect resolution.

### 9.5 Refresh token rotation

Each call to `/refresh`:
1. Revokes the old refresh token (sets `revoked_at`)
2. Issues a completely new token

This prevents replay attacks: if a stolen refresh token is used by an attacker, the legitimate user's next refresh will fail because the old token is already revoked. This immediately alerts the user to a compromised session.

### 9.6 Driver adapter (not binary engine)

Prisma connects via `@prisma/adapter-pg` (driver adapter pattern) instead of the default binary engine. This means:
- No binary downloads (works on ARM, serverless, etc.)
- Direct `pg` driver connection
- Compatible with Prisma 7's new architecture

### 9.7 Soft deletes with proper HTTP semantics

Links use `deleted_at` (soft delete). Expired links (`expires_at < now()`) also remain in the DB. Both return `410 Gone` rather than `404 Not Found`, which is semantically correct — the resource existed but is no longer available.

### 9.8 IP privacy

Raw IPs are never stored. The click tracking pipeline:
1. Hashes the IP with `SHA-256(ip + YYYY-MM-DD)` using a daily rotating salt
2. Stores only the hash
3. The dedup key uses this hash (not the raw IP)

This means IPs cannot be reconstructed and correlation across days is impossible without the daily salt.

### 9.9 Fire-and-forget click tracking

The redirect response (`302`) is sent to the client before any analytics work begins. Click data is enqueued to BullMQ via `queue.add()` with `void` (no await). The response path is never blocked by analytics.

---

## 10. Known Gaps

### Missing (not started)

| Item | Impact |
|---|---|
| Prisma migrations | Database tables don't exist. Run `npx prisma migrate dev --name init` |
| Dockerfile | No containerization for deployment |
| GCP infrastructure | No Cloud Run, Cloud SQL, or Memorystore instance created |
| Unit tests (`*.spec.ts`) | No test coverage |
| E2E tests | `test/app.e2e-spec.ts` still tests default NestJS boilerplate |
| `.env.example` | No template for new developers |

### Partially implemented

| Item | Current behavior | Expected |
|---|---|---|
| `GET /auth/me` | Returns `{ id, email }` from JWT only | Should query DB for `{ id, email, name, createdAt }` |
| Stack trace leakage | `HttpExceptionFilter` shows details | Should hide stack in `NODE_ENV=production` |
| Pino structured logging | Installed but unused; custom `LoggingInterceptor` with `Logger.log` | Should replace with `nestjs-pino` for JSON logs |
| Worker graceful shutdown | No `enableShutdownHooks()` | Should drain BullMQ before exiting |
| Midnight salt dedup limit | Undocumented minor overcount | Should be documented |
