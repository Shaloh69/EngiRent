# EngiRent Hub - Node.js Server

Backend API server built with Express and TypeScript.

## Responsibilities

- **Authentication** - JWT-based user registration, login, and session management
- **Database** - MySQL via Prisma ORM (users, items, rentals, transactions, lockers, verifications)
- **REST API** - CRUD endpoints for items, rentals, users, and kiosk operations
- **Real-time** - Socket.io for live rental status updates and notifications
- **Payments** - GCash API integration for cashless transactions
- **File Storage** - Image upload handling (item photos, verification images)
- **ML Bridge** - Proxies verification requests to the Python ML service

## Tech Stack

| Technology | Purpose |
|-----------|---------|
| Node.js | Runtime |
| Express | HTTP framework |
| TypeScript | Type safety |
| Prisma | ORM / database migrations |
| MySQL | Database |
| Socket.io | Real-time events |
| JWT | Authentication tokens |
| Multer | File uploads |

## Planned Structure

```
node_server/
├── src/
│   ├── config/         # Database, env, constants
│   ├── controllers/    # Route handlers
│   ├── middleware/      # Auth, validation, error handling
│   ├── models/         # Prisma schema and types
│   ├── routes/         # Express route definitions
│   ├── services/       # Business logic
│   ├── sockets/        # Socket.io event handlers
│   ├── utils/          # Helpers
│   └── index.ts        # Entry point
├── prisma/
│   └── schema.prisma   # Database schema
├── package.json
├── tsconfig.json
└── .env.example
```

## API Endpoints (Planned)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login and receive JWT |
| GET | `/api/items` | List available items |
| POST | `/api/items` | Create item listing |
| POST | `/api/rentals` | Initiate rental |
| POST | `/api/verify` | Trigger item verification (proxies to ML service) |
| GET | `/api/lockers/status` | Kiosk locker availability |
| POST | `/api/payments/gcash` | Process GCash payment |

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env

# Run database migrations
npx prisma migrate dev

# Start development server
npm run dev
```

## Testing

Two layers, and they answer different questions.

### Unit tests — `npx jest`

9 files, 80 tests, mocked Prisma. Fast, run them on every change.

```bash
npx jest              # all
npx jest --coverage
```

The two that matter most are the kiosk trust boundary
(`services/__tests__/kioskSessionStore.test.ts`,
`controllers/__tests__/kioskVerifyFace.test.ts`) — that is the path where a
client request can end with a physical locker door opening.

### End-to-end suites — `node scripts/e2e-all.mjs`

Real HTTP against a running deployment. One command runs the set and prints one
table.

```bash
node scripts/e2e-all.mjs --list     # what each suite does and what it costs
node scripts/e2e-all.mjs --safe     # only the suites that create no rows
node scripts/e2e-all.mjs --only=kiosk-trust,webhook-signature
node scripts/e2e-all.mjs            # everything runnable unattended
```

**Read this before running the full set:**

- **Nine suites talk to MySQL directly** (`@prisma/client`) for setup and
  cleanup, and `DATABASE_URL` points at `localhost:3307` on the server — so the
  full set only runs **on the server**. Use the wrapper there, which reads the
  two secrets from that machine's own `.env` so neither leaves it:

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-e2e-all.ps1
  powershell ... -File scripts\run-e2e-all.ps1 -SuiteArgs "--safe"
  ```

- **The API allows 100 requests per 15-minute window per IP.** The full set is
  several hundred, so it needs `RATE_LIMIT_BYPASS_SECRET` (in the server's
  `.env`; every use is logged at warn). Without it the run dies in 429s partway
  through, and those 429s cascade into Prisma errors that look like code
  defects and are not.
- `--safe` is the subset that creates no rows — the right mode when the
  database is being kept clean for a manual test run. The rest create real rows
  and clean up after themselves; a full run leaves the database exactly as it
  found it.
- `e2e-verification` and `e2e-full-lifecycle` are **excluded from unattended
  runs**: both need a real face image as `argv[2]`, and `verification` enrols
  biometrics for accounts it then deletes.
- **`e2e-coverage-sweep` is pure HTTP** (no `@prisma/client`), so unlike the
  nine above it runs from a laptop against the tunnel. It closes Register 3's
  safe happy-path gaps — account lifecycle, the read-only student and admin
  surfaces, and the retired endpoints. Two things to know:
  - **It reuses one fixed probe account** (`e2e-sweep-probe@…`) rather than
    creating a throwaway per run. `DELETE /auth/account` only *deactivates*,
    and `GET /admin/stats`'s `totalUsers` counts deactivated students — so a
    fresh account per run would permanently inflate the admin dashboard's
    headline number (see PROGRESS.md D-34).
  - It **deliberately does not touch** the three kiosk hardware routes, which
    fire real relays and actuators, nor `POST /kiosk/upload`. Its header says
    why. Don't "complete" the sweep by adding them.
- Set `API_BASE_URL` to the current tunnel when running from outside. Quick
  tunnels rotate on every restart — read the live hostname from
  `startbat-logs/tunnel-api.log` on the server, never from a document.

### The other two languages

```bash
cd ../kiosk        && venv/Scripts/python.exe -m unittest discover -s tests -t .
cd ../python_server/services/ml && venv/Scripts/python.exe -m pytest tests/ -q
```
