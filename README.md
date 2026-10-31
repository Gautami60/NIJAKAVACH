# NIJAKAVACH (निजकवच)

> **Personal Data Exposure Discovery & Removal Management Platform**  
> *Evidence-First, Source-by-Source Privacy Engineering for Indian Consumers*

---

## 1. Product Overview

**NIJAKAVACH (निजकवच)** is an enterprise privacy technology platform designed to empower Indian consumers to audit and discover where their personal information—initially mobile telephone numbers—appears across supported public directories, data brokers, and lead aggregators, and to orchestrate lawful, evidence-backed removal and opt-out workflows.

### Core Product Journey

```
[DISCOVER] ───> [REVIEW] ───> [AUTHORISE] ───> [SUBMIT] ───> [TRACK] ───> [VERIFY]
```

1. **DISCOVER**: Asynchronous worker scans query lawful, public sources within rate-limits without bypassing access controls.
2. **REVIEW**: Consumers review findings alongside immutable point-in-time cryptographic evidence (DOM snippet, SHA-256 digest, S3 storage key).
3. **AUTHORISE**: User confirms match and signs a statutory electronic authorization under **Section 12 of the DPDP Act 2023** (Right to Correction and Erasure).
4. **SUBMIT**: Lawful removal request is formatted and dispatched via supported channel (API, webform, or compliance email).
5. **TRACK**: Tracks source ticket IDs, acknowledgments, and formal rejection notices.
6. **VERIFY**: Independent scheduled rechecks verify that data has truly been expunged, alerting the user immediately if data reappears.

> **CRITICAL ARCHITECTURAL DISTINCTION**:  
> A submitted request or source acknowledgement is **never** treated as a completed removal. Removal is only established after independent verification rechecks.

---

## 2. Technology Stack

- **Monorepo Engine**: pnpm workspaces + Turborepo
- **Frontend**: Next.js 14, React 18, Tailwind CSS, TypeScript
- **Backend**: Node.js 20/24 LTS, TypeScript 5.8 (Strict mode)
- **Primary Database**: PostgreSQL 16 (Logical schema isolation & least-privilege roles)
- **Cache & Coordination**: Redis 7 (Token bucket rate limiting, session revocation, Redlock)
- **Message Broker**: RabbitMQ 3.13 (Durable work queues, Topic exchanges, Dead-letter handling)
- **Evidence Storage**: MinIO / S3-Compatible Object Storage (Server-side AES256, presigned URLs)
- **Validation**: Zod 3.24 (Compile-time and runtime validation contracts)
- **Cryptography**: AES-256-GCM envelope encryption, Keyed HMAC-SHA256 indexing, Scrypt hashing

---

## 3. High-Level Project Structure

```
NIJAKAVACH/
├── apps/
│   ├── web/                         # Next.js 14 Responsive Web Application (Port 3000)
│   ├── api-gateway/                 # Reverse Proxy, Rate Limiting, Correlation IDs (Port 4000)
│   ├── identity-service/            # Accounts, Scrypt Passwords, JWT Tokens (Port 4001)
│   ├── user-service/                # PII Encryption, HMAC Indexing, DPDP Consent (Port 4002)
│   ├── source-registry-service/     # Supported Sources Catalog & Capabilities (Port 4003)
│   ├── discovery-service/           # Scan Scheduling & RabbitMQ Job Dispatch (Port 4004)
│   ├── case-management-service/     # Exposure Cases, S3 Presigned Evidence URLs (Port 4005)
│   ├── removal-workflow-service/    # DPDP Sec 12 Statutory Notices & Submissions (Port 4006)
│   ├── verification-service/        # Independent Recheck & Relisting Surveillance (Port 4007)
│   ├── notification-service/        # Transactional Notifications & Preferences (Port 4008)
│   ├── audit-service/               # Tamper-Evident SHA-256 Hash-Chained Ledger (Port 4009)
│   └── source-workers/              # Asynchronous Worker Daemon for External Sources (Port 4010)
│
├── packages/
│   ├── shared-types/                # Domain enums (ExposureLifecycleState, StatutoryBasis)
│   ├── validation/                  # Zod validation schemas (E.164 phone, UUID, email)
│   ├── contracts/                   # REST API request/response typed contracts
│   ├── event-contracts/             # CloudEvents v1.0 envelopes, payloads & outbox contracts
│   ├── security/                    # AES-256-GCM, HMAC fingerprinting, Scrypt, JWTs
│   ├── config/                      # Fail-fast Zod environment configuration
│   ├── logger/                      # Structured JSON logger with automated PII redaction
│   ├── observability/               # Health check aggregator & correlation ID generator
│   └── test-utils/                  # Mock fixtures and assertion helpers
│
├── infrastructure/
│   ├── docker/docker-compose.yml    # Canonical infrastructure stack
│   ├── postgres/init-schemas.sql    # 9 isolated schemas & least-privilege roles
│   └── rabbitmq/definitions.json    # Durable queues, DLX exchanges, and bindings
│
├── docs/
│   └── ARCHITECTURE.md              # Consolidated Master System Architecture & ADRs
│
├── scripts/
│   ├── init-db.ts                   # Schema and role verification runner
│   └── seed-db.ts                   # Initial directory catalog seeder
│
├── .env.example
├── .gitignore
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── tsconfig.base.json
├── README.md
└── SECURITY.md
```

---

## 4. Prerequisites

Ensure your host environment satisfies:
- **Node.js**: `v20.x` or `v24.x` LTS
- **pnpm**: `v10.x` or `v12.x` (`npm install -g pnpm`)
- **Docker Engine**: `v24.0+` with Docker Compose v2.x
- **Git**

---

## 5. Installation Instructions

```bash
# Clone the repository
git clone https://github.com/Gautami60/NIJAKAVACH.git
cd NIJAKAVACH

# Install all workspace dependencies
pnpm install
```

---

## 6. Environment Configuration

Copy the example environment file to `.env`:

```bash
cp .env.example .env
```

Key environment settings configured in `.env.example`:
- `JWT_SECRET`: Minimum 32-character secret for user session tokens.
- `AES_256_GCM_ENCRYPTION_KEY`: 64-hex-character (32-byte) key for envelope encryption at rest.
- `HMAC_PEPPER_SECRET`: High-entropy pepper for deterministic phone number indexing.
- `INTERNAL_SERVICE_API_KEY`: Inter-service service-to-service header key.
- `DATABASE_URL`: PostgreSQL connection string.
- `REDIS_URL`: Redis connection string with auth.
- `RABBITMQ_URL`: AMQP broker connection string.
- `S3_ENDPOINT`: S3 / MinIO API URL (default: `http://localhost:9000`).

---

## 7. Local Infrastructure Startup

Start the canonical Docker Compose stack (PostgreSQL 16, Redis 7, RabbitMQ 3.13, and MinIO S3):

```bash
# Launch containers in background
pnpm infra:up

# Check container health status
pnpm infra:status

# Stop containers when finished
pnpm infra:down
```

Direct Docker command:
```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

### Local Infrastructure Dashboard & Port Access

| Service | Host Port | Web Dashboard / Protocol | Default Credentials |
| :--- | :--- | :--- | :--- |
| **PostgreSQL 16** | `5432` | TCP (SQL) | `postgres` / `postgres_dev_password` |
| **Redis 7** | `6379` | TCP (RESP) | Auth: `redis_dev_secret` |
| **RabbitMQ 3.13** | `5672` (AMQP), `15672` (UI) | `http://localhost:15672` | `nijakavach` / `rabbit_dev_password` |
| **MinIO (S3)** | `9000` (API), `9001` (Console) | `http://localhost:9001` | `minioadmin` / `minioadmin` |

---

## 8. Database Architecture & Migrations

NIJAKAVACH partitions data into 9 isolated PostgreSQL schemas (`identity`, `user_consent`, `sources`, `discovery`, `cases`, `removals`, `verification`, `notifications`, `audit`) with non-overlapping database roles, zero cross-schema foreign keys, and dedicated transactional outbox tables:

```bash
# Verify and apply database schema initialization and DDL migrations
pnpm db:migrate

# Seed initial verified Indian directory sources into the catalog
pnpm db:seed

# Run database invariant tests (verifies zero cross-schema FKs, UUID PKs, HMAC lookups, AES encryption)
pnpm --filter @nijakavach/test-utils test
```

Migration files located in `infrastructure/postgres/migrations/`:
- `001_initial_schema_and_roles.sql`: Logical schemas and least-privilege service roles (`identity_svc_role`, `sources_svc_role`, etc.).
- `002_core_domain_tables.sql`: 34 domain tables, check constraints, indexes, and transactional outbox tables.
- `003_source_registry_capabilities.sql`: Enterprise metadata, capability verification, evidence tracking, safe integrations, and removal procedures for schema `sources`.
- `seeds/dev-seed.sql`: Catalog of verified Indian directories and compliance policies.

### Source Registry Service PostgreSQL Configuration
The Source Registry Service (`apps/source-registry-service`) connects to PostgreSQL using least-privilege role `sources_svc_role`:
- **Default Connection String**: `postgresql://sources_svc_role:sources_dev_pwd@localhost:5432/nijakavach_dev?schema=sources`
- **Environment Variables**:
  - `SOURCES_DB_URL`: Custom PostgreSQL connection string for the `sources` schema.
  - `USE_POSTGRES`: `true` to enable live PostgreSQL pool; `false` to fallback to structural in-memory repositories.
- **Service-Level Migrations**: Run automatically on boot via `SourceRegistryMigrator` tracking applied scripts in `sources.schema_migrations`.
- **Testing Persistence**:
  ```bash
  # Run Source Registry unit and integration test suite
  pnpm --filter @nijakavach/source-registry-service test
  ```

---

## 9. Development Commands

Run all services and the Next.js web application concurrently:

```bash
# Launch the full monorepo in development mode
pnpm dev
```

Or run targeted services individually:

```bash
# Next.js Web Frontend (Port 3000)
pnpm --filter @nijakavach/web dev

# API Gateway / BFF (Port 4000)
pnpm --filter @nijakavach/api-gateway dev

# Identity Service (Port 4001)
pnpm --filter @nijakavach/identity-service dev

# User & Consent Service (Port 4002)
pnpm --filter @nijakavach/user-service dev
```

### Service Port & Health Check Matrix

Every service exposes a standardized `/health` (liveness probe) and `/ready` (dependency readiness probe) endpoint:

| Service | Port | Liveness Probe | Readiness Probe | Direct Access Policy |
| :--- | :--- | :--- | :--- | :--- |
| **Web Frontend** | `3000` | `http://localhost:3000` | N/A | Public |
| **API Gateway** | `4000` | `http://localhost:4000/health` | `http://localhost:4000/ready` | Public ingress |
| **Identity Service** | `4001` | `http://localhost:4001/health` | `http://localhost:4001/ready` | Internal key required (`X-Internal-Service-Key`) |
| **User & Consent Service** | `4002` | `http://localhost:4002/health` | `http://localhost:4002/ready` | Internal key required (`X-Internal-Service-Key`) |
| **Source Registry Service** | `4003` | `http://localhost:4003/health` | `http://localhost:4003/ready` | Internal key required (`X-Internal-Service-Key`) |
| **Discovery Service** | `4004` | `http://localhost:4004/health` | `http://localhost:4004/ready` | Internal key required (`X-Internal-Service-Key`) |
| **Case Management Service** | `4005` | `http://localhost:4005/health` | `http://localhost:4005/ready` | Internal key required (`X-Internal-Service-Key`) |
| **Removal Workflow Service**| `4006` | `http://localhost:4006/health` | `http://localhost:4006/ready` | Internal key required (`X-Internal-Service-Key`) |
| **Verification Service** | `4007` | `http://localhost:4007/health` | `http://localhost:4007/ready` | Internal key required (`X-Internal-Service-Key`) |
| **Notification Service** | `4008` | `http://localhost:4008/health` | `http://localhost:4008/ready` | Internal key required (`X-Internal-Service-Key`) |
| **Audit Service** | `4009` | `http://localhost:4009/health` | `http://localhost:4009/ready` | Internal key required (`X-Internal-Service-Key`) |
| **Source Workers Daemon** | `4010` | `http://localhost:4010/health` | `http://localhost:4010/ready` | Internal key required (`X-Internal-Service-Key`) |

### API Gateway Route Mapping & Security

All client traffic routes through the API Gateway (`http://localhost:4000`). Direct requests to internal microservices without a valid internal service key are blocked with HTTP 403 Forbidden.

| Gateway Route Prefix | Target Downstream Service | Auth Required | Rewrite Target |
| :--- | :--- | :--- | :--- |
| `/api/v1/identity` | `apps/identity-service:4001` | No (endpoints self-authenticate) | `/v1/identity` |
| `/api/v1/users` | `apps/user-service:4002` | Yes (Bearer JWT) | `/v1/users` |
| `/api/v1/consents` | `apps/user-service:4002` | Yes (Bearer JWT) | `/v1/consents` |
| `/api/v1/authorisations` | `apps/user-service:4002` | Yes (Bearer JWT) | `/v1/authorisations` |
| `/api/v1/sources` | `apps/source-registry-service:4003` | Public for `GET` (redacted catalogue); Admin Bearer JWT (`SYSTEM_ADMIN` / `COMPLIANCE_OFFICER`) for mutations | `/v1/sources` |
| `/api/v1/scans` | `apps/discovery-service:4004` | Yes (Bearer JWT) | `/v1/scans` |
| `/api/v1/cases` | `apps/case-management-service:4005` | Yes (Bearer JWT) | `/v1/cases` |
| `/api/v1/removals` | `apps/removal-workflow-service:4006` | Yes (Bearer JWT) | `/v1/removals` |
| `/api/v1/verification` | `apps/verification-service:4007` | Yes (Bearer JWT) | `/v1/verifications` |

**Security Controls Enforced by Gateway**:
- **Sliding-Window Rate Limiter**: 100 requests / minute per IP (returns `429 Too Many Requests` with `Retry-After`).
- **Max Body Size Limit**: 1MB maximum payload (returns `413 Payload Too Large`).
- **Request Timeouts**: 10s request timeout guard (returns `504 Gateway Timeout`).
- **Header Sanitization**: Gateway unconditionally strips client-injected `X-User-Id`, `X-User-Roles`, and `X-Internal-Service-Key` headers before proxying, injecting authenticated user claims from the verified JWT.
- **Security Headers**: Standard injection of `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'`, and `X-Correlation-Id`.

---

## 10. Testing Commands

Run automated tests across backend foundation modules:

```bash
# Run Identity Service tests (registration, Scrypt, email verification, login, refresh rotation, password reset)
pnpm --filter @nijakavach/identity-service test

# Run User & Consent Service tests (profiles, phone normalization, AES-256-GCM, HMAC, DPDP consent, authorisations, erasure)
pnpm --filter @nijakavach/user-service test

# Run API Gateway foundation tests (routing, auth guard, rate limiter, header sanitization)
pnpm --filter @nijakavach/api-gateway test

# Run Source Worker pool tests (concurrency, idempotency, timeouts, retry backoff, DLQ)
pnpm --filter @nijakavach/source-workers test

# Run Database and Service Communication invariants (CloudEvents, Outbox, Backoff, Timing-safe keys)
pnpm --filter @nijakavach/test-utils test

# Run strict TypeScript type checks across all backend targets
pnpm --filter "!@nijakavach/web" typecheck
```

---

## 11. Build Commands

Compile all shared packages, service entrypoints, and the Next.js production bundle:

```bash
# Build all packages with Turborepo caching
pnpm build
```

---

## 12. Troubleshooting

### Port Conflicts
- If a port like `4000` or `5432` is already occupied, stop the existing local processes or modify the port variable in `.env`.

### Docker Compose Healthcheck Timing
- If PostgreSQL or MinIO takes longer to initialize on slower machines, wait 15 seconds after `pnpm infra:up` before running `pnpm db:migrate`.

### Turborepo Cache Reset
- If you encounter cached artifact discrepancies during development, run:
  ```bash
  npx turbo clean
  ```

---

## 13. Security and Architecture Reference

For complete architectural specifications, C4 diagrams, STRIDE threat models, and architectural decisions, refer to:
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**: Consolidated System Architecture, Microservices, Security, and ADRs.
- **[SECURITY.md](SECURITY.md)**: Vulnerability Disclosure Policy & Cryptographic Tenets.