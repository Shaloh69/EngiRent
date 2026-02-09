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
