# EngiRent Hub - Backend API

Node.js/Express backend API for the EngiRent Hub IoT-powered Smart Kiosk System.

## 🚀 Features

- **RESTful API** with Express.js and TypeScript
- **Authentication & Authorization** with JWT tokens
- **Database** with Prisma ORM and MySQL
- **Real-time Communication** with Socket.io
- **Payment Integration** (GCash ready)
- **AI Verification** integration with ML service
- **IoT Kiosk** integration ready
- **Comprehensive Validation** with express-validator
- **Error Handling** with custom error classes
- **Rate Limiting** for API protection
- **Logging** with Winston

## 📋 Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- MySQL 8.0
- ML Service running (optional for development)

## 🛠️ Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Setup

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Server
NODE_ENV=development
PORT=5000
API_VERSION=v1

# Database
DATABASE_URL="mysql://username:password@localhost:3306/engirent_db"

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRE=7d
JWT_REFRESH_SECRET=your-refresh-token-secret-change-this
JWT_REFRESH_EXPIRE=30d

# ML Service (optional in development)
ML_SERVICE_URL=http://localhost:8001

# Frontend URLs
CLIENT_WEB_URL=http://localhost:3000
CLIENT_MOBILE_URL=http://localhost:3000
```

### 3. Database Setup

Generate Prisma client:

```bash
npm run prisma:generate
```

Push the schema to your database:

```bash
npm run prisma:push
```

Or run migrations:

```bash
npm run prisma:migrate
```

### 4. Create Logs Directory

```bash
mkdir logs
```

## 🏃 Running the Server

### Development Mode

```bash
npm run dev
```

The server will start on `http://localhost:5000` with hot-reload enabled.

### Production Build

```bash
npm run build
npm start
```

### Prisma Studio (Database GUI)

```bash
npm run prisma:studio
```

## 📚 API Documentation

See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) for complete API reference.

### Base URL

```
http://localhost:5000/api/v1
```

### Health Check

```http
GET /api/v1/health
```

### Main Endpoints

- `/auth` - Authentication (register, login, profile)
- `/items` - Item listings management
- `/rentals` - Rental transactions
- `/payments` - Payment processing
- `/kiosk` - Kiosk operations (deposit, claim, return)
- `/notifications` - User notifications

## 🔒 Authentication

All protected endpoints require a Bearer token:

```http
Authorization: Bearer <access_token>
```

## 🗄️ Database Schema

The database includes the following main tables:

- **users** - Student accounts
- **items** - Rental listings
- **rentals** - Rental transactions
- **transactions** - Payment records
- **verifications** - AI verification logs
- **lockers** - Physical locker units
- **notifications** - User notifications
- **reviews** - User and item reviews

See `prisma/schema.prisma` for complete schema details.

## 🏗️ Project Structure

```
server/
├── src/
│   ├── config/          # Configuration files
│   ├── controllers/     # Request handlers
│   ├── middleware/      # Express middleware
│   ├── routes/          # API routes
│   ├── utils/           # Utility functions
│   └── index.ts         # Main entry point
├── prisma/
│   └── schema.prisma    # Database schema
├── logs/                # Application logs
└── README.md
```

## 🚀 Deployment

### Using Docker

```bash
docker-compose up -d
```

See [docker-compose.yml](./docker-compose.yml) for configuration.

## 📄 License

MIT License

---

Built with ❤️ for UCLM Engineering Students
