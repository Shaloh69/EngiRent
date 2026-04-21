# EngiRent Hub — Full Repository Analysis

**Date:** 2026-04-21
**Repository:** EngiRent (monorepo)
**Institution:** University of Cebu Lapu-Lapu and Mandaue (UCLM), College of Engineering
**Type:** Engineering Thesis Project

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Architecture](#2-project-architecture)
3. [Backend — Node.js/Express API](#3-backend--nodejs-express-api)
4. [AI/ML Verification Service](#4-aiml-verification-service)
5. [Raspberry Pi Kiosk Controller](#5-raspberry-pi-kiosk-controller)
6. [Admin Console — Next.js](#6-admin-console--nextjs)
7. [Public Web App — Next.js](#7-public-web-app--nextjs)
8. [Flutter Mobile App](#8-flutter-mobile-app)
9. [Database Schema](#9-database-schema)
10. [Key Workflows](#10-key-workflows)
11. [Security Architecture](#11-security-architecture)
12. [Deployment — Render.com](#12-deployment--rendercom)
13. [Strengths & Gaps](#13-strengths--gaps)
14. [File Index](#14-file-index)

---

## 1. Executive Summary

**EngiRent Hub** is an IoT-powered smart kiosk system that enables peer-to-peer equipment rentals among engineering students at UCLM. The platform automates the full rental lifecycle — listing, booking, payment, physical exchange via smart lockers, AI-powered item verification, and dispute resolution — replacing informal and unaccountable borrowing with structured, software-enforced workflows.

### Core Problem Solved

Students informally lend and borrow expensive engineering equipment (calculators, Arduino kits, measurement tools, etc.) with no accountability, fraud protection, or payment security. EngiRent Hub introduces:

- **Escrow-controlled payments** (GCash, held until verified return)
- **Smart locker kiosks** (automated, unattended item exchange with Raspberry Pi 5)
- **AI verification** at both deposit and return (prevents fraud by both parties)
- **Admin oversight** with manual review capability

### Technology Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Mobile App | Flutter (Dart) | SDK 3.9.2+ | iOS/Android student-facing app |
| Admin Console | Next.js + TypeScript | 15.5 / React 19 | Operations dashboard |
| Public Website | Next.js + TypeScript | 15.5 / React 18 | Marketing & documentation |
| Backend API | Node.js + Express | 18.x LTS | REST API, business logic |
| Database | MySQL | 8.0 | Relational data store |
| ORM | Prisma | 5.22 | Type-safe database access |
| ML Service | Python + FastAPI | 3.9+ / 0.104+ | AI item verification |
| Auth | JWT + Bcrypt | — | Token-based authentication |
| Storage | Supabase Storage | — | Image hosting (replaces AWS S3) |
| Payments | GCash API | — | Cashless payment & escrow |
| Hardware | Raspberry Pi 5 | — | Kiosk locker controller |
| Real-time | Socket.io | 4.8.1 | Push notifications + kiosk commands |
| UI Framework | HeroUI + Tailwind CSS | 2.6 / 4.1 | Component library (all web apps) |
| Deployment | Render.com | — | Cloud hosting (Singapore region) |

---

## 2. Project Architecture

### Monorepo Structure

```
EngiRent/
├── client/
│   ├── admin/              Next.js admin console (port 3001)
│   ├── web/                Next.js public website (port 3000)
│   └── flutter_app/        Flutter mobile app
│
├── server/
│   ├── node_server/        Node.js/Express REST API (port 5000)
│   │   ├── src/            Controllers, routes, middleware, services
│   │   └── prisma/         MySQL schema & migrations
│   ├── python_server/
│   │   └── services/ml/    FastAPI ML service (port 8001)
│   └── kiosk/              Raspberry Pi 5 kiosk controller (Python)
│
├── render.yaml             Render.com cloud deployment config
├── README.md
├── AI_SYSTEM_DOCUMENTATION.md
├── AI_VERIFICATION_GUIDE.md
├── EngiRent_Hub_Analysis.md
├── ITEM_CATEGORIES.md
└── analyzation.md          (this file)
```

### Component Communication

```
┌─────────────────────────────────────────────────────────────────┐
│              Flutter Mobile App (port: varies)                  │
│  Student browses, books, pays, tracks rentals                   │
│  HTTP REST + JWT Bearer token                                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│          Next.js Admin Console (port 3001)                      │
│  Operations team monitors, reviews verifications, manages users │
│  HTTP REST + JWT Bearer token (admin_token)                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│         Node.js / Express REST API (port 5000)                  │
│  /api/v1/{auth|items|rentals|payments|kiosk|notifications|upload}│
│                                                                 │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────────────────┐ │
│  │ Controllers  │  │ Middleware  │  │ Socket.io (real-time)  │ │
│  │ auth         │  │ authenticate│  │ user rooms (notifs)    │ │
│  │ items        │  │ validation  │  │ kiosk rooms (commands) │ │
│  │ rentals      │  │ rateLimiter │  └────────────────────────┘ │
│  │ payments     │  │ upload      │                             │
│  │ kiosk        │  │ errorHandler│                             │
│  │ notifications│  └─────────────┘                             │
│  └──────────────┘                                               │
│  storageService → Supabase Storage (image upload)               │
└───────┬────────────────────┬───────────────────┬───────────────┘
        │                    │                   │
        ▼                    ▼                   ▼
┌──────────────┐  ┌──────────────────────┐  ┌────────────────────┐
│  MySQL 8.0   │  │  Python FastAPI ML   │  │ Raspberry Pi 5     │
│  (via Prisma)│  │  Service (port 8001) │  │ Kiosk Controller   │
│              │  │                      │  │ (Socket.io client) │
│ users        │  │ POST /verify         │  │                    │
│ items        │  │ POST /extract-feats  │  │ GPIO solenoids     │
│ rentals      │  │ GET  /health         │  │ L298N actuators    │
│ transactions │  │                      │  │ CSI + USB cameras  │
│ verifications│  │ 8-stage hybrid CV    │  │ Face recognition   │
│ lockers      │  │ pipeline             │  │ HDMI UI (Flask)    │
│ notifications│  └──────────────────────┘  │ WiFi provisioning  │
│ reviews      │                            └────────────────────┘
└──────────────┘

External Services:
  GCash API ──────────── Payment processing & escrow
  Supabase Storage ────── Image hosting (item photos, kiosk captures, profiles)
  Render.com ─────────── Cloud hosting (Singapore), 4 services
```

---

## 3. Backend — Node.js/Express API

**Root:** `server/node_server/`
**Entry Point:** [server/node_server/src/index.ts](server/node_server/src/index.ts)
**Port:** 5000
**Base Path:** `/api/v1`

### Folder Structure

```
server/node_server/
├── src/
│   ├── config/
│   │   ├── database.ts         Prisma client initialization
│   │   └── env.ts              Zod env schema validation
│   ├── controllers/
│   │   ├── authController.ts
│   │   ├── itemController.ts
│   │   ├── rentalController.ts
│   │   ├── paymentController.ts
│   │   ├── kioskController.ts
│   │   └── notificationController.ts
│   ├── middleware/
│   │   ├── auth.ts             JWT authentication
│   │   ├── errorHandler.ts     Global error handling
│   │   ├── validation.ts       express-validator integration
│   │   ├── rateLimiter.ts      IP-based rate limiting
│   │   └── upload.ts           Multer file upload (memory storage)
│   ├── routes/
│   │   ├── index.ts            Router aggregator
│   │   ├── authRoutes.ts
│   │   ├── itemRoutes.ts
│   │   ├── rentalRoutes.ts
│   │   ├── paymentRoutes.ts
│   │   ├── kioskRoutes.ts
│   │   ├── notificationRoutes.ts
│   │   └── uploadRoutes.ts     NEW: image upload endpoints
│   ├── services/
│   │   └── storageService.ts   NEW: Supabase Storage wrapper
│   ├── utils/
│   │   ├── errors.ts           Custom AppError classes
│   │   ├── jwt.ts              Token generation/verification
│   │   ├── bcrypt.ts           Password hashing
│   │   └── logger.ts           Winston logger
│   └── index.ts
├── prisma/
│   └── schema.prisma
├── schema.sql                  Raw SQL dump of schema
├── Dockerfile                  Multi-stage Docker build (Node 20)
├── docker-compose.yml          MySQL + API services
├── .env.example
└── package.json
```

### Key Dependencies

| Package | Version | Purpose |
|---|---|---|
| express | 4.21.2 | Web framework |
| @prisma/client | 5.22.0 | Database ORM |
| @supabase/supabase-js | 2.99.2 | Supabase Storage client |
| socket.io | 4.8.1 | Real-time events |
| jsonwebtoken | 9.0.2 | JWT tokens |
| bcryptjs | 2.4.3 | Password hashing |
| axios | 1.7.9 | ML service HTTP calls |
| multer | 2.0.2 | File upload handling (memory buffer) |
| express-validator | 7.2.0 | Input validation |
| helmet | 8.0.0 | Security headers |
| winston | 3.17.0 | Structured logging |
| zod | 3.24.1 | Config schema validation |
| uuid | 14.0.0 | UUID generation for filenames |
| morgan | 1.10.0 | HTTP request logging |

### API Endpoints

#### Authentication — `/api/v1/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/register` | No | Register new student account |
| POST | `/login` | No | Login, returns access + refresh tokens |
| POST | `/refresh` | No | Exchange refresh token for new access token |
| POST | `/logout` | Yes | Invalidate refresh token |
| GET | `/profile` | Yes | Get authenticated user's profile |
| PUT | `/profile` | Yes | Update profile (name, phone, parent contact, image) |
| PUT | `/password` | Yes | Change password (requires current password) |

#### Items — `/api/v1/items`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/` | Yes | Create item listing (triggers background ML feature extraction) |
| GET | `/` | Optional | List items with filters: `category`, `search`, `minPrice`, `maxPrice`, `condition`, `isAvailable`, `campusLocation`, `page`, `limit` |
| GET | `/my-items` | Yes | Get current user's listed items |
| GET | `/:id` | Optional | Item detail with owner info and reviews |
| PUT | `/:id` | Yes | Update item (owner only) |
| DELETE | `/:id` | Yes | Soft-delete item (blocked if active rentals exist) |

#### Rentals — `/api/v1/rentals`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/` | Yes | Create rental request, auto-calculate price |
| GET | `/` | Yes | List rentals filtered by `type` (rented/owned), `status`, pagination |
| GET | `/:id` | Yes | Rental detail with item, users, transactions, verifications |
| PATCH | `/:id/status` | Yes | Update rental status with locker assignments |
| POST | `/:id/cancel` | Yes | Cancel if PENDING or AWAITING_DEPOSIT |

#### Payments — `/api/v1/payments`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/` | Yes | Create GCash transaction, returns payment URL |
| POST | `/confirm` | Optional | Webhook callback to confirm payment |
| GET | `/` | Yes | List user's transactions (filterable by status/type) |
| POST | `/:transactionId/refund` | Yes | Process refund, notify user |

#### Kiosk — `/api/v1/kiosk`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/deposit` | Yes | Owner deposits item → triggers ML verification |
| POST | `/claim` | Yes | Renter claims item from locker |
| POST | `/return` | Yes | Renter returns item → triggers ML verification |
| GET | `/lockers` | Yes | List available lockers (filterable by size) |

#### Upload — `/api/v1/upload` (NEW)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/image` | Yes | Upload single image → Supabase Storage, returns public URL |
| POST | `/images` | Yes | Upload up to 10 images → Supabase Storage, returns URL array |

#### Notifications — `/api/v1/notifications`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Yes | Get user's notifications with `unreadCount` |
| PATCH | `/:id/read` | Yes | Mark single notification read |
| PATCH | `/read-all` | Yes | Mark all notifications read |
| DELETE | `/:id` | Yes | Delete notification |

#### Health Check

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/health` | No | API health check (used by Docker and Render) |

### Supabase Storage Service (NEW)

**File:** [server/node_server/src/services/storageService.ts](server/node_server/src/services/storageService.ts)

Replaces the previously planned AWS S3 integration. Provides:
- `uploadFile(folder, filename, buffer, mimetype)` → returns public URL
- `deleteFile(storagePath)` → removes file from bucket
- `pathFromUrl(url)` → extracts storage path from full Supabase public URL

Folder prefixes inside the `media` bucket:
- `item-images/` — listing photos
- `kiosk-captures/` — kiosk camera frames
- `profile-images/` — user avatars

### Controller Business Logic

**authController.ts** — 7 functions: register (hash + tokens), login (verify + lastLogin), refreshToken, logout (clear DB token), getProfile, updateProfile, changePassword.

**itemController.ts** — 6 functions. `createItem()` triggers **background ML feature extraction** via `setImmediate()`: downloads images as Blobs, calls ML `/extract-features`, caches result in `item.mlFeatures` for faster future verification.

**kioskController.ts** — Most complex controller. Handles:
- Persistent attempt counters (`depositAttemptCount`, `returnAttemptCount`)
- Pre-extracted feature cache passing (skips expensive ResNet50 re-extraction)
- ML decision routing:
  - `RETRY` (attempt < 10): Release locker, increment counter, return HTTP 422
  - `REJECTED` (attempt ≥ 10): Cancel rental, set REJECTED verification, notify renter
  - `APPROVED`: Mark DEPOSITED/COMPLETED, set locker occupied
  - `PENDING`: Approve but flag for `MANUAL_REVIEW`

**rentalController.ts** — Manages the 10-state rental status machine and fires notifications on each status transition.

### Middleware Stack

| Middleware | Purpose |
|---|---|
| `helmet()` | Security headers (XSS, clickjacking, MIME sniffing) |
| `cors()` | CORS for web and mobile client origins |
| `json({ limit: '10mb' })` + `urlencoded()` | Request body parsing |
| `morgan()` | HTTP request logging |
| `rateLimiter` | 100 req / 15 min per IP (in-memory) |
| `authenticate()` | JWT Bearer token verification, user active check |
| `optionalAuth()` | Auth attempted but not required (public+auth endpoints) |
| `uploadSingle` / `uploadMultiple` | Multer memory-buffer upload for `/upload` routes |
| `validate()` | express-validator chain runner, returns field errors |
| `errorHandler()` | Global catch-all: Prisma errors, AppError, JWT errors |
| `notFound()` | 404 handler for unmatched routes |

### Real-time (Socket.io)

Two separate real-time channels:
- **User rooms** (`user:<userId>`): Notification push events to mobile and admin clients
- **Kiosk channel**: The backend **receives** events from the Pi kiosk (`kiosk:register`, `kiosk:status`, `kiosk:images`, `kiosk:face`) and **sends** commands (`kiosk:command`, `kiosk:config`)

### Environment Configuration

All validated by Zod schema in [server/node_server/src/config/env.ts](server/node_server/src/config/env.ts):

| Variable | Default | Required |
|---|---|---|
| `NODE_ENV` | development | No |
| `PORT` | 5000 | No |
| `API_VERSION` | v1 | No |
| `DATABASE_URL` | — | **Yes** |
| `JWT_SECRET` | — | **Yes** (min 32 chars) |
| `JWT_EXPIRE` | 7d | No |
| `JWT_REFRESH_SECRET` | — | **Yes** (min 32 chars) |
| `JWT_REFRESH_EXPIRE` | 30d | No |
| `ML_SERVICE_URL` | http://localhost:8001 | No |
| `ML_SERVICE_API_KEY` | — | No |
| `GCASH_API_URL` | — | No |
| `GCASH_MERCHANT_ID` | — | No |
| `GCASH_SECRET_KEY` | — | No |
| `GCASH_PUBLIC_KEY` | — | No |
| `SUPABASE_URL` | — | **Yes** |
| `SUPABASE_SERVICE_ROLE_KEY` | — | **Yes** |
| `SUPABASE_STORAGE_BUCKET` | media | No |
| `CLIENT_WEB_URL` | http://localhost:3000 | No |
| `CLIENT_MOBILE_URL` | http://localhost:3000 | No |
| `KIOSK_RASPBERRY_PI_URL` | — | No |
| `KIOSK_WEBHOOK_SECRET` | — | No |
| `RATE_LIMIT_WINDOW_MS` | 900000 | No |
| `RATE_LIMIT_MAX_REQUESTS` | 100 | No |
| `MAX_FILE_SIZE` | 10485760 (10 MB) | No |
| `ALLOWED_FILE_TYPES` | image/jpeg,image/png,... | No |
| `LOG_LEVEL` | info | No |

### Docker Setup

**Dockerfile:** Multi-stage build (Node 20) — Stage 1 (builder): deps + Prisma generate + TypeScript compile. Stage 2 (production): only production deps + compiled JS. Exposes port 5000. Health check pings `/api/v1/health`.

**docker-compose.yml:** Two services:
- `engirent-mysql`: MySQL 8.0 on port 3306, volume `mysql_data`, database `engirent_db`
- `engirent-api`: Node API on port 5000, depends on MySQL, mounts `./logs`

---

## 4. AI/ML Verification Service

**Root:** `server/python_server/services/ml/app/`
**Framework:** FastAPI (Python 3.9+)
**Port:** 8001

### Purpose

Answers the question: **"Is the physical item placed inside the kiosk the same item as the owner's listing photos?"**

Triggered at two checkpoints:
1. **Deposit** — Owner places item in kiosk. Prevents owner from depositing a different/damaged item.
2. **Return** — Renter returns item. Prevents renter from returning a substitute or damaged item.

### API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/verify` | Full hybrid verification of item identity |
| POST | `/api/v1/extract-features` | Pre-extract and return features for caching |
| GET | `/api/v1/health` | Health check with capability flags |

**`POST /verify` Input:**
- `original_images`: 3+ upload files (listing photos)
- `kiosk_images`: 3–5 upload files (kiosk camera captures)
- `attempt_number`: int
- `reference_features`: optional JSON (pre-extracted cache from `item.mlFeatures`)

**`POST /verify` Output (VerificationResponse):**
```json
{
  "decision": "APPROVED | PENDING | RETRY | REJECTED",
  "confidence": 0.0–100.0,
  "attempt_number": 1,
  "method_scores": {
    "traditional_best": 0.0,
    "traditional_aggregated": 0.0,
    "sift_best_match": 0.0,
    "sift_best_inlier": 0.0,
    "sift_combined": 0.0,
    "ssim_aggregated": 0.0,
    "deep_learning_aggregated": 0.0,
    "phash_best": 0.0
  },
  "ocr_result": { "match": true, "details": {} },
  "quality_issues": []
}
```

### 8-Stage Hybrid Pipeline

| Stage | Method | Weight | Description |
|---|---|---|---|
| 1 | Image Quality Gate | Gate | Resolution, brightness, blur, coverage checks |
| 2 | Perceptual Hash (pHash) | ~10% | Quick hash-based similarity filter |
| 3 | Traditional CV | ~20% | Color histogram, LBP texture, ORB keypoints |
| 4 | SIFT + FLANN + RANSAC | ~20% | Keypoint matching with Lowe's ratio test + geometric validation |
| 5 | SSIM | included | Structural similarity index (pixel-level) |
| 6 | ResNet50 Deep Learning | ~40% | CNN semantic feature embedding cosine similarity |
| 7 | OCR Serial Number | ~10% | Tesseract text extraction and serial matching |
| 8 | Hybrid Score | final | Weighted aggregation of all stage scores |

**Image Pre-processing (all inputs):**
- Gray-world white balance correction
- CLAHE contrast normalization
- Aspect-ratio-preserving resize to 640×640
- GrabCut background removal

### Decision Thresholds

| Confidence Score | Decision | Action |
|---|---|---|
| ≥ 85% | `APPROVED` | Rental proceeds normally |
| 60–84% | `PENDING` | Rental proceeds but flagged for admin manual review |
| < 60%, attempt < 10 | `RETRY` | Locker released, user repositions and retries |
| < 60%, attempt ≥ 10 | `REJECTED` | Rental cancelled (deposit) or disputed (return) |

### Feature Caching Strategy

When an item is created (`POST /items`), `itemController.ts` fires a background job:
1. Downloads item listing images
2. Calls `POST /extract-features`
3. Stores `StorableFeatures` JSON in `item.mlFeatures` (MySQL)

At kiosk time, `kioskController.ts` passes `reference_features` to `/verify`, skipping the expensive ResNet50 feature extraction on already-seen images.

### Service Files

```
app/
├── main.py                     FastAPI app, CORS, router registration
├── config.py                   ML service configuration
├── models/
│   └── schemas.py              Pydantic request/response models
├── routers/
│   └── verification.py         3 endpoint implementations
├── features/
│   ├── traditional.py          OpenCV: color, shape, LBP texture, ORB
│   ├── sift.py                 SIFT keypoint matching + RANSAC
│   ├── deep.py                 ResNet50 embeddings
│   └── phash.py                Perceptual hash
├── comparison/
│   ├── hybrid.py               HybridVerifier class, weighted scoring
│   └── similarity.py           Similarity utility helpers
└── utils/
    ├── image.py                Image loading, resizing, preprocessing
    ├── ocr.py                  Tesseract OCR for serial numbers
    ├── quality.py              Blur/brightness/coverage assessment
    └── background.py           Background processing utilities
```

---

## 5. Raspberry Pi Kiosk Controller

**Root:** `server/kiosk/`
**Hardware:** Raspberry Pi 5 (4 GB+)
**Language:** Python 3 (asyncio + gpiozero + socketio)
**Communication:** Socket.io client → Node.js backend

This is a **new, complete hardware controller** added to the project. It is the physical brain of each smart locker kiosk unit.

### Responsibilities

- WiFi provisioning (AP captive portal on first boot)
- GPIO solenoid lock control (12 solenoids across 4 lockers)
- L298N linear actuator control (4 trapdoor actuators)
- Camera management (CSI + USB cameras for item capture + face recognition)
- Face detection + identity verification (OpenCV Haar cascade + ML service)
- Image upload to Supabase Storage
- HDMI UI rendering (Flask web server → Chromium kiosk browser)
- Socket.io persistent connection to the Node.js backend

### Hardware Configuration (per kiosk unit)

| Component | Qty | Role |
|---|---|---|
| Raspberry Pi 5 (4 GB+) | 1 | Main controller |
| 5V 4-channel relay module | 3 | 12 solenoid channels total |
| 12V solenoid lock | 12 | 3 per locker: main_door, trapdoor, bottom_door |
| L298N dual H-bridge motor driver | 2 | 4 actuator channels (2 per driver) |
| 12V linear actuator | 4 | Trapdoor push/pull mechanism per locker |
| Raspberry Pi Camera Module 3 | 2 | CSI0 (locker 1), CSI1 (locker 2) |
| USB webcam | 3 | Lockers 3 & 4 item capture + face camera |
| HDMI monitor | 1 | 7–10" kiosk display |

### Folder Structure

```
server/kiosk/
├── main.py                     Entry point: startup sequence
├── config.py                   Env-driven config (kiosk_id, server URL, GPIO pins)
├── kiosk_config.json           Live timing config (updated via admin panel)
├── diagnose.py                 Hardware diagnostic script
├── requirements.txt            Python dependencies
├── setup.sh / setup.bat        Install scripts (Linux/Windows dev)
├── .env.example
├── hardware/
│   ├── gpio_controller.py      SolenoidController: 12-relay GPIO management
│   ├── actuator_controller.py  ActuatorController: L298N PWM/direction control
│   └── camera_manager.py       CameraManager: CSI + USB capture + face cam
├── services/
│   ├── socket_client.py        Socket.io async client + command dispatcher
│   ├── face_service.py         OpenCV Haar cascade + ML /verify-face call
│   └── image_uploader.py       Upload captured frames to Supabase Storage
├── kiosk_ui/
│   ├── server.py               Flask HDMI UI server (port 8080)
│   ├── templates/index.html    Kiosk display HTML
│   └── static/
│       ├── app.js              UI state polling via AJAX
│       └── style.css           Kiosk display styles
├── provisioning/
│   ├── wifi_manager.py         Check WiFi status via nmcli
│   └── ap_portal.py            Captive portal for WiFi credentials entry
├── systemd/
│   ├── engirent-kiosk.service         Auto-start kiosk controller on boot
│   └── engirent-kiosk-browser.service Auto-launch Chromium in kiosk mode
└── data/
    └── .gitkeep                Holds local haarcascade XML if not system-installed
```

### Startup Sequence

```
1. Load .env, configure colored logging
2. Check WiFi → if not connected, start AP hotspot "EngiRent-Kiosk-Setup"
   → User connects phone and enters credentials at http://192.168.4.1
   → Pi reboots with WiFi configured
3. Initialize hardware:
   → SolenoidController (12 relays, active-LOW by default)
   → ActuatorController (4 L298N channels via PWM)
   → CameraManager (CSI0, CSI1, USB video devices)
4. Start HDMI UI Flask server on port 8080 (daemon thread)
   → Chromium auto-launches in kiosk mode pointing to localhost:8080
5. Start Socket.io client loop (reconnects indefinitely on disconnect)
   → Emits kiosk:register on connect
   → Waits for kiosk:command events
```

### Socket.io Protocol

**Events emitted TO server:**

| Event | Payload | Trigger |
|---|---|---|
| `kiosk:register` | `{kiosk_id, locker_count, version}` | On connect |
| `kiosk:status` | `{kiosk_id, ui_state, config}` | After any command |
| `kiosk:images` | `{kiosk_id, locker_id, image_urls, rental_id}` | After capture_image command |
| `kiosk:face` | `{kiosk_id, rental_id, user_id, detected, verified, confidence}` | After capture_face command |
| `kiosk:error` | `{kiosk_id, message}` | On unknown/failed command |

**Events received FROM server:**

| Event | Payload | Action |
|---|---|---|
| `kiosk:command` | `{action, locker_id, ...params}` | Dispatch to handler |
| `kiosk:config` | timing config JSON | Update `kiosk_config.json` |

**Supported actions in `kiosk:command`:**

| Action | Description |
|---|---|
| `open_door` | Unlock solenoid for `door` type on `locker_id` for configurable seconds |
| `drop_item` | Penalty sequence: unlock trapdoor → actuator push/pull → lock trapdoor |
| `capture_image` | Capture N frames from locker camera → upload to Supabase → emit URLs |
| `capture_face` | Capture face frames → Haar detect + ML verify → emit result |
| `lock_all` | Emergency: lock all solenoids and stop all actuators |
| `actuator_extend` | Manual actuator push for `locker_id` |
| `actuator_retract` | Manual actuator pull for `locker_id` |

### Locker Mechanical Design

Each of the 4 lockers has a **3-door system**:

| Door | Solenoid | Purpose |
|---|---|---|
| `main_door` | Top | Owner inserts / renter retrieves item |
| `trapdoor` | Internal | Drop mechanism (penalty/item drop to bottom) |
| `bottom_door` | Bottom | Renter retrieval access |

The trapdoor uses a linear actuator to physically push/pull it open and closed, with the solenoid as the latch.

### Configuration

Timing parameters are stored in `kiosk_config.json` and can be updated live from the admin panel. Per-locker config includes:
- `main_door_open_seconds` — how long main door stays unlocked
- `trapdoor_unlock_seconds` — solenoid unlock duration
- `bottom_door_open_seconds` — retrieval door open time
- `actuator_push_seconds` / `actuator_pull_seconds` — trapdoor actuation
- `actuator_speed_percent` — L298N PWM duty cycle

### Mock Mode (Development)

```bash
MOCK_GPIO=true MOCK_CAMERA=true python main.py
```

All GPIO and camera calls are intercepted by mock classes — no hardware needed for development and testing.

---

## 6. Admin Console — Next.js

**Root:** `client/admin/`
**Framework:** Next.js 15.5.12, React 19.0.0
**Port:** 3001
**UI Library:** HeroUI 2.6 + Tailwind CSS 4.1

### Dependencies

| Package | Purpose |
|---|---|
| @heroui/react | Full component library |
| recharts | Dashboard charts |
| zustand | Global state management |
| react-hook-form | Form handling |
| axios | HTTP client |
| date-fns | Date formatting |
| lucide-react | Icons |
| framer-motion | Animations |
| zod | Validation |

### Pages

| Route | File | Description |
|---|---|---|
| `/` | [app/page.tsx](client/admin/src/app/page.tsx) | Auth guard: redirects to `/dashboard` or `/login` |
| `/login` | [app/login/page.tsx](client/admin/src/app/login/page.tsx) | Email/password login, demo mode support |
| `/dashboard` | [app/dashboard/page.tsx](client/admin/src/app/dashboard/page.tsx) | Metrics (users, items, rentals, verifications, revenue) + recent rentals table |
| `/users` | [app/users/page.tsx](client/admin/src/app/users/page.tsx) | User list, search, activate/deactivate toggle |
| `/items` | [app/items/page.tsx](client/admin/src/app/items/page.tsx) | Inventory, filter by category/search, view/delete |
| `/rentals` | [app/rentals/page.tsx](client/admin/src/app/rentals/page.tsx) | Rental list, filter by status, date/price display |
| `/verifications` | [app/verifications/page.tsx](client/admin/src/app/verifications/page.tsx) | AI verification queue, confidence scores, approve/reject modal |
| `/reports` | [app/reports/page.tsx](client/admin/src/app/reports/page.tsx) | Revenue LineChart, rental BarChart, category BarChart (sample data) |

### API Integration Layer

**File:** [client/admin/src/lib/api.ts](client/admin/src/lib/api.ts)

- Base URL: `NEXT_PUBLIC_API_URL` or `http://localhost:5000/api/v1`
- Request interceptor: attaches `Authorization: Bearer admin_token` from localStorage
- Response interceptor: 401 → clear token + redirect to `/login`
- **Demo Mode** (`NEXT_PUBLIC_DEMO_MODE=true`): In-memory state with sample UCLM users/items/rentals, all mutations mocked locally. Allows fully functional demo with no backend.

### Components

**AdminLayout** ([client/admin/src/components/layout/AdminLayout.tsx](client/admin/src/components/layout/AdminLayout.tsx)):
- Sticky header with ER brand, notifications badge, user dropdown + logout
- Sidebar (lg+ only): 6 nav items with active link highlighting
- Mobile hamburger menu with collapsible nav

**StatsCard** ([client/admin/src/components/charts/StatsCard.tsx](client/admin/src/components/charts/StatsCard.tsx)):
- Props: `title`, `value`, `icon` (LucideIcon), `color` (bg-* class), optional `trend`
- Renders HeroUI Card with colored icon square, value, optional trend percentage

### Styling

- Custom CSS variables: `--color-bg`, `--color-surface`, `--color-primary` (#2563EB), `--color-secondary` (#10B981), etc.
- Font: Manrope (Google Fonts)
- Utility classes: `.app-shell`, `.app-surface`, `.app-soft`, `.app-muted`
- Full dark mode support via `darkMode: "class"`

---

## 7. Public Web App — Next.js

**Root:** `client/web/`
**Framework:** Next.js 15.5.12, React 18.3.1
**Port:** 3000
**Purpose:** Marketing site + technical documentation for the thesis project

### Dependencies

- Same HeroUI ecosystem (40+ individual component packages)
- next-themes for dark mode
- tailwind-variants for styled primitives
- framer-motion for animations
- No API calls — fully static informational site

### Pages

| Route | Description |
|---|---|
| `/` | Hero section (smart kiosk pitch) + 4-feature grid (Booking, Kiosk QR/Face, AI Verification, Escrow) |
| `/about` | Project intent, team info, university, contact (support@engirenthub.com) |
| `/docs` | 4 linkable sections: Owner Flow, Renter Flow, Verification Pipeline, Security Controls |
| `/pricing` | 3 tiers: Student Basic (free), Kiosk Transaction (per rental), Admin Operations (institution) |
| `/blog` | 3 blog posts about project design, AI verification, and automation philosophy |

### Components

**Navbar** ([client/web/components/navbar.tsx](client/web/components/navbar.tsx)):
- Logo + "EngiRent Hub" branding
- Desktop nav with active page highlight
- Mobile hamburger with collapsible menu
- Theme switch (dark/light) in both layouts
- "Read Docs" CTA button

**Primitives** ([client/web/components/primitives.ts](client/web/components/primitives.ts)):
- `title()`: tailwind-variants styled heading with color/size variants
- `subtitle()`: body text with max-width constraints and muted color

---

## 8. Flutter Mobile App

**Root:** `client/flutter_app/`
**Framework:** Flutter SDK 3.9.2+
**State Management:** Provider (ChangeNotifier)
**HTTP:** dart:http via ApiService wrapper

### pubspec.yaml Dependencies

| Package | Purpose |
|---|---|
| provider | ChangeNotifier state management |
| get_it | Service locator (DI — installed, not yet wired) |
| http | REST API calls |
| dio | Advanced HTTP (installed, not yet used) |
| flutter_secure_storage | Encrypted token storage |
| shared_preferences | Non-sensitive user data |
| go_router | Routing (installed, not yet used — basic routes active) |
| image_picker | Camera/gallery image selection |
| image_cropper | Image cropping |
| qr_code_scanner | QR scanning |
| qr_flutter | QR code generation |
| flutter_local_notifications | Push notifications |
| google_fonts | Font loading |
| cached_network_image | Network image caching |
| shimmer | Loading skeleton effect |
| intl | Date formatting |
| timeago | Relative timestamps |
| permission_handler | Runtime permissions |
| connectivity_plus | Network status |

### App Entry Point & Routes

**File:** [client/flutter_app/lib/main.dart](client/flutter_app/lib/main.dart)

- `MultiProvider` wraps `MaterialApp` with `AuthProvider`
- Theme: Material 3, primary `#2563EB`, secondary `#10B981`
- 6 named routes:

| Route | Screen | Description |
|---|---|---|
| `/login` | LoginScreen | Entry point, auth form |
| `/register` | RegisterScreen | Student account creation |
| `/home` | HomeScreen | 4-tab main dashboard |
| `/items` | ItemsScreen | Browse marketplace |
| `/items/search` | ItemsScreen | Search variant |
| `/items/create` | CreateItemScreen | List new item |
| `/kiosk/scan` | KioskScanScreen | QR token validation |

### Core Layer

**Constants** ([lib/core/constants/app_constants.dart](client/flutter_app/lib/core/constants/app_constants.dart)):
- `baseUrl`: `http://localhost:5000/api/v1`
- `mlServiceUrl`: `http://localhost:8001/api/v1`
- Storage keys, item categories (8), rental statuses (10), app version

**Models:**
- `UserModel`: id, email, studentId, firstName, lastName, phone, profileImage, isVerified
- `ItemModel`: id, title, description, category, condition, pricePerDay, images, averageRating, owner (ItemOwner)
- `RentalModel`: id, status, startDate, endDate, totalPrice, securityDeposit, item (RentalItem), computed: `daysRemaining`, `isActive`, `isCompleted`
- `NotificationModel`: id, title, message, type, isRead, createdAt

**ApiService** ([lib/core/services/api_service.dart](client/flutter_app/lib/core/services/api_service.dart)):
- Wraps `dart:http` with `get()`, `post()`, `put()`, `delete()`
- Auto-injects `Authorization: Bearer <token>` for authenticated requests

**StorageService** ([lib/core/services/storage_service.dart](client/flutter_app/lib/core/services/storage_service.dart)):
- `FlutterSecureStorage`: access token, refresh token (encrypted)
- `SharedPreferences`: userId (fast access)
- `clearAll()` for logout

### Feature Modules

#### Auth (`features/auth/`)

**AuthService** — `register()`, `login()`, `getProfile()`, `logout()`. All call REST API and persist tokens via StorageService. Demo fallback returns hardcoded user if API unavailable.

**AuthProvider** — ChangeNotifier: `_user`, `_isLoading`, `_error`. Methods: `login()`, `register()`, `loadUser()`, `logout()`, `clearError()`.

#### Home (`features/home/`)

**HomeScreen** — 4-tab `BottomNavigationBar`:

| Tab | Content |
|---|---|
| Home | Welcome greeting, quick action grid (List Item, Browse, Kiosk, My Rentals), category chips |
| Rentals | Active/past rentals: item title, status badge, price, days remaining. Pull-to-refresh. |
| Notifications | Notification list: title, message, date, read/unread indicator. Pull-to-refresh. |
| Profile | User avatar, name, email, verification badge, logout button |

#### Items (`features/items/`)

**ItemsScreen** — Browse with search bar. Item cards: thumbnail, title, category, availability, price/day, deposit. Pull-to-refresh.

**CreateItemScreen** — Form: title, description, category dropdown (8 options), condition dropdown (5 options), pricePerDay, securityDeposit, image URLs (comma-separated placeholder for image upload).

#### Kiosk (`features/kiosk/`)

**KioskScanScreen** — UI-only kiosk interaction screen with informational panel, camera preview placeholder, manual token input field, and "Validate Session Token" button.

---

## 9. Database Schema

**ORM:** Prisma 5.22
**Database:** MySQL 8.0
**File:** [server/node_server/prisma/schema.prisma](server/node_server/prisma/schema.prisma)

### Models

#### User
| Field | Type | Notes |
|---|---|---|
| id | String (UUID) | PK |
| email | String | Unique |
| password | String | Bcrypt hashed |
| studentId | String | Unique |
| firstName, lastName | String | |
| phoneNumber | String | |
| profileImage | String? | Supabase Storage URL |
| parentName, parentContact | String? | |
| isVerified | Boolean | Default: false |
| isActive | Boolean | Default: true |
| emailVerifiedAt | DateTime? | |
| refreshToken | Text? | Stored for invalidation |
| lastLogin | DateTime? | |

#### Item
| Field | Type | Notes |
|---|---|---|
| id | String (UUID) | PK |
| ownerId | String | FK → User |
| title, description | String | |
| category | Enum | SCHOOL_ATTIRE, ACADEMIC_TOOLS, ELECTRONICS, DEVELOPMENT_KITS, MEASUREMENT_TOOLS, AUDIO_VISUAL, SPORTS_EQUIPMENT, OTHER |
| condition | Enum | NEW, LIKE_NEW, GOOD, FAIR, ACCEPTABLE |
| pricePerDay | Float | |
| pricePerWeek, pricePerMonth | Float? | |
| securityDeposit | Float | |
| images | JSON | Array of Supabase Storage URLs |
| mlFeatures | JSON? | Pre-extracted ML feature cache |
| serialNumber | String? | For OCR matching |
| isAvailable, isActive | Boolean | |
| campusLocation | String? | |
| totalRentals, averageRating | Int / Float | Aggregates |

#### Rental
| Field | Type | Notes |
|---|---|---|
| id | String (UUID) | PK |
| itemId, renterId, ownerId | String | FKs |
| startDate, endDate | DateTime | |
| actualReturnDate | DateTime? | |
| status | Enum | PENDING → AWAITING_DEPOSIT → DEPOSITED → AWAITING_CLAIM → ACTIVE → AWAITING_RETURN → VERIFICATION → COMPLETED / CANCELLED / DISPUTED |
| totalPrice, securityDeposit | Float | |
| depositLockerId, claimLockerId, returnLockerId | String? | Assigned lockers |
| depositVerificationId, verificationId | String? | FK → Verification |
| verificationScore | Float? | |
| verificationStatus | Enum | PENDING, PROCESSING, COMPLETED, MANUAL_REVIEW, APPROVED, REJECTED |
| depositAttemptCount, returnAttemptCount | Int | Default: 0 |

#### Transaction
| Field | Type | Notes |
|---|---|---|
| id | String (UUID) | PK |
| rentalId, userId | String | FKs |
| type | Enum | RENTAL_PAYMENT, SECURITY_DEPOSIT, DEPOSIT_REFUND, LATE_FEE, DAMAGE_FEE |
| amount | Float | |
| status | Enum | PENDING, PROCESSING, COMPLETED, FAILED, REFUNDED |
| gcashReferenceNo, gcashTransactionId | String? | Unique |
| paymentMethod | String | Default: "GCash" |
| paymentDetails | JSON? | |
| paidAt | DateTime? | |

#### Verification
| Field | Type | Notes |
|---|---|---|
| id | String (UUID) | PK |
| originalImages, kioskImages | JSON | Arrays of Supabase Storage URLs |
| decision | Enum | APPROVED, PENDING, RETRY, REJECTED |
| confidenceScore | Float | 0–100 |
| attemptNumber | Int | Default: 1 |
| traditionalScore, siftScore, deepLearningScore | Float? | Per-method scores |
| ocrMatch | Boolean? | |
| ocrDetails | JSON? | |
| status | Enum | PENDING, PROCESSING, COMPLETED, MANUAL_REVIEW, APPROVED, REJECTED |
| reviewedBy | String? | Admin userId |
| reviewNotes | Text? | Admin notes or ML error |

#### Locker
| Field | Type | Notes |
|---|---|---|
| id | String (UUID) | PK |
| lockerNumber | String | Unique |
| kioskId | String | Hardware identifier |
| size | Enum | SMALL, MEDIUM, LARGE, EXTRA_LARGE |
| status | Enum | AVAILABLE, OCCUPIED, RESERVED, MAINTENANCE, OUT_OF_SERVICE |
| isOperational | Boolean | |
| currentRentalId | String? | |
| lastUsedAt | DateTime? | |

#### Notification
| Field | Type | Notes |
|---|---|---|
| id | String (UUID) | PK |
| userId | String | FK → User |
| title, message | String | |
| type | Enum | BOOKING_CONFIRMED, DEPOSIT_REMINDER, ITEM_READY_FOR_CLAIM, CLAIM_REMINDER, RENTAL_STARTED, RETURN_REMINDER, RETURN_OVERDUE, VERIFICATION_SUCCESS, VERIFICATION_FAILED, PAYMENT_RECEIVED, PAYMENT_FAILED, REVIEW_REQUEST, SYSTEM_ANNOUNCEMENT |
| relatedEntityId, relatedEntityType | String? | |
| isRead | Boolean | Default: false |
| readAt | DateTime? | |

#### Review
| Field | Type | Notes |
|---|---|---|
| id | String (UUID) | PK |
| itemId, authorId, recipientId | String | FKs |
| rating | Int | 1–5 |
| comment | Text? | |
| reviewType | Enum | ITEM, USER |

---

## 10. Key Workflows

### Owner Flow

```
1. LIST ITEM
   Owner creates listing via Flutter app
   → POST /items (title, description, category, condition, prices, images)
   → Images uploaded to Supabase via POST /upload/images first
   → Background: ML feature extraction cached to item.mlFeatures

2. RECEIVE RENTAL REQUEST
   Renter books item
   → POST /rentals → status: PENDING
   → Owner receives BOOKING_CONFIRMED notification

3. RENTER PAYS DEPOSIT
   → POST /payments (GCash)
   → POST /payments/confirm (webhook)
   → status: AWAITING_DEPOSIT

4. OWNER DEPOSITS ITEM AT KIOSK
   Node backend sends kiosk:command { action: "open_door", locker_id: X, door: "main_door" }
   Owner places item inside locker
   Node sends kiosk:command { action: "capture_image", locker_id: X }
   Pi captures frames → uploads to Supabase → emits kiosk:images back to server
   Backend calls ML service: original listing images vs kiosk captures
   → APPROVED: status → DEPOSITED, locker locked
   → PENDING: status → DEPOSITED + MANUAL_REVIEW flag
   → RETRY: locker released, owner repositions (up to 10 attempts)
   → REJECTED (10th attempt): rental CANCELLED, renter notified/refunded

5. RENTER CLAIMS ITEM
   Node sends kiosk:command { action: "capture_face", rental_id: X, user_id: Y }
   Pi captures face → Haar detect + ML verify → emits kiosk:face
   If verified: Node sends kiosk:command { action: "open_door", door: "main_door" }
   → status: ACTIVE, owner notified

6. RENTAL PERIOD ACTIVE
   Notifications: RETURN_REMINDER, RETURN_OVERDUE (if late)

7. RENTER RETURNS ITEM
   Node sends open_door + capture_image + capture_face commands via Socket.io
   Pi executes, emits kiosk:images + kiosk:face results
   Backend calls ML service: original images vs returned item
   → APPROVED: status → COMPLETED, payout released to owner
   → REJECTED: status → DISPUTED, admin investigates
```

### Verification Pipeline Detail

```
Kiosk Pi captures 3–5 images via camera_manager
    ↓
Images uploaded to Supabase Storage → URLs returned
    ↓
kiosk:images event emitted to Node backend
    ↓
kioskController builds multipart form:
  - original_images: from item.images (Supabase URLs, downloaded as Blobs)
  - kiosk_images: from emitted image URLs (downloaded as Blobs)
  - reference_features: item.mlFeatures (cached JSON, skips ResNet50 extraction)
  - attempt_number: rental.depositAttemptCount + 1
    ↓
POST http://ML_SERVICE_URL/api/v1/verify
    ↓
Python FastAPI (8 stages) → confidence score + decision
    ↓
Node applies policy (APPROVED / PENDING / RETRY / REJECTED)
    ↓
Verification record saved to MySQL
    ↓
Admin Console shows in /verifications queue
Admin can manually APPROVE or REJECT PENDING/MANUAL_REVIEW cases
```

---

## 11. Security Architecture

### Authentication

- **Access tokens**: Short-lived JWT (default 7d), stored in Flutter's `FlutterSecureStorage` (AES encrypted) and admin's `localStorage`
- **Refresh tokens**: Long-lived JWT (default 30d), stored encrypted in both app and MySQL DB
- **Token rotation**: `POST /auth/refresh` generates new access token; refresh token stored in DB allows server-side invalidation
- **Logout**: Clears refresh token from DB, preventing reuse even if token is intercepted

### Password Security

- Bcrypt hashing (bcryptjs) with salt rounds
- Password change requires verification of current password

### API Security

- **Helmet**: Sets Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, HSTS headers
- **CORS**: Restricted to configured `CLIENT_WEB_URL` and `CLIENT_MOBILE_URL`
- **Rate Limiting**: 100 requests per 15-minute window per IP address
- **Input Validation**: All routes validated with express-validator before hitting controllers
- **Prisma Parameterized Queries**: Prevents SQL injection
- **File Upload Guard**: Multer validates MIME type and size (10 MB max) before Supabase upload

### Kiosk Security

- **Face verification**: OpenCV Haar cascade local pre-check + ML service identity confirmation before locker access
- **Socket.io authentication**: Kiosk registers with `KIOSK_ID` on connect; server tracks active kiosks
- **Attempt tracking**: Max 10 ML verification attempts prevents brute-force deposit manipulation
- **Mutual verification**: Both deposit (protects renter) and return (protects owner) are verified independently
- **Mock mode**: `MOCK_GPIO` and `MOCK_CAMERA` flags for safe development without hardware

### Admin Security

- Separate admin token stored in `localStorage` (cleared on 401)
- Admin-only endpoints for user management and verification review
- Audit trail: All verifications stored with attempt numbers, scores, reviewer ID, and notes

---

## 12. Deployment — Render.com

**File:** [render.yaml](render.yaml)

The project deploys 4 services to Render.com (Singapore region) from a single config file:

| Service | Render Name | Type | Plan | Root |
|---|---|---|---|---|
| Node.js API | `engirent-api` | Web (Node) | Free | `server/node_server` |
| Admin Console | `engirent-admin` | Web (Node) | Free | `client/admin` |
| Public Website | `engirent-web` | Web (Node) | Free | `client/web` |
| ML Service | `engirent-ml` | Web (Docker) | Starter | `server/python_server/services/ml` |

**Production URLs:**
- API: `https://engirent-api.onrender.com`
- Admin: `https://engirent-admin.onrender.com`
- Web: `https://engirent-web.onrender.com`
- ML: `https://engirent-ml.onrender.com`

**Deployment notes:**
- API runs `npx prisma db push` as a pre-deploy command (schema sync without migrations)
- ML service deploys via Dockerfile (Docker runtime on Render starter plan)
- Secrets (`DATABASE_URL`, `JWT_SECRET`, `SUPABASE_*`) set manually in Render dashboard
- Kiosk Pi connects to production API via `SERVER_URL=https://engirent-api.onrender.com`

---

## 13. Strengths & Gaps

### Strengths

| Area | Detail |
|---|---|
| Complete hardware layer | Raspberry Pi kiosk controller is fully implemented with GPIO, actuators, cameras, face recognition, and WiFi provisioning |
| Clean architecture | Feature-based folders across all apps; controllers, middleware, and services are separated |
| End-to-end rental lifecycle | Complete flow from listing → payment → kiosk (Pi commands) → ML verification → completion |
| Hybrid ML pipeline | 8 complementary methods produce robust fraud detection; no single-point failure |
| Feature caching | Pre-extracted ML features reduce verification latency at kiosk time |
| Attempt tracking | Persistent retry counters survive server restarts; prevents infinite retries |
| Supabase Storage | Image hosting fully wired — `POST /upload` endpoints live, used by all image flows |
| Demo mode | Admin and Flutter clients have demo fallbacks for development without backend |
| Real-time updates | Socket.io serves both user notification push AND kiosk hardware command/response loop |
| Cloud deployment | `render.yaml` defines all 4 production services; Pi kiosk connects to production URLs |
| Docker-ready | ML service deploys via Docker on Render; Node API has multi-stage Dockerfile |
| Environment validation | Zod schema catches missing config at startup, not at runtime |
| Mock hardware mode | `MOCK_GPIO=true MOCK_CAMERA=true` allows full kiosk software testing without Pi |

### Gaps & Incomplete Items

| Area | Detail |
|---|---|
| GoRouter not wired | `go_router` package installed in Flutter but basic `routes:` map used; no deep linking or guard routes |
| Image upload placeholder | `CreateItemScreen` uses comma-separated URL text input; `image_picker` installed but not integrated with `POST /upload` |
| QR scanner placeholder | `KioskScanScreen` shows a static camera box; `qr_code_scanner` installed but not integrated |
| `get_it` not used | Service locator dependency installed but providers registered manually |
| `dio` not used | Advanced HTTP client installed but `dart:http` wrapper used |
| No test suite | No unit, widget, or integration tests found in any app |
| Reports use sample data | Admin `/reports` page uses hardcoded static data, no real API aggregation |
| Pagination not in Flutter | `ItemsScreen` loads all items with no page control |
| Local notifications not integrated | `flutter_local_notifications` installed but not hooked up to notification service |
| GCash integration mocked | `paymentController.ts` returns a mock payment URL; real GCash SDK not integrated |
| Face verification ML endpoint | `face_service.py` calls ML `/api/v1/verify-face` — this endpoint is not present in the FastAPI service (only `/verify` and `/extract-features` exist) |
| Node kiosk routes | `kioskRoutes.ts` and `kioskController.ts` exist for REST-based kiosk calls, but the actual hardware now communicates over Socket.io — the REST routes may be redundant or partially wired |
| Admin kiosk config UI | Admin panel SETUP.md references a "Kiosk page → Configure Timings" admin panel feature, but no `/kiosk` admin page is visible in the current admin app pages |

---

## 14. File Index

### Backend (server/node_server/)

| File | Description |
|---|---|
| [server/node_server/src/index.ts](server/node_server/src/index.ts) | Express app setup, Socket.io, middleware stack, route mounting |
| [server/node_server/src/config/env.ts](server/node_server/src/config/env.ts) | Zod environment variable schema validation |
| [server/node_server/src/config/database.ts](server/node_server/src/config/database.ts) | Prisma client singleton |
| [server/node_server/src/controllers/authController.ts](server/node_server/src/controllers/authController.ts) | Register, login, refresh, logout, profile CRUD |
| [server/node_server/src/controllers/itemController.ts](server/node_server/src/controllers/itemController.ts) | Item CRUD + background ML feature extraction |
| [server/node_server/src/controllers/rentalController.ts](server/node_server/src/controllers/rentalController.ts) | Rental lifecycle, status transitions, notifications |
| [server/node_server/src/controllers/paymentController.ts](server/node_server/src/controllers/paymentController.ts) | GCash payment creation, confirmation webhook, refunds |
| [server/node_server/src/controllers/kioskController.ts](server/node_server/src/controllers/kioskController.ts) | Kiosk REST endpoints (deposit/claim/return) + ML verification integration |
| [server/node_server/src/controllers/notificationController.ts](server/node_server/src/controllers/notificationController.ts) | Notification CRUD |
| [server/node_server/src/middleware/auth.ts](server/node_server/src/middleware/auth.ts) | JWT authenticate() and optionalAuth() middleware |
| [server/node_server/src/middleware/errorHandler.ts](server/node_server/src/middleware/errorHandler.ts) | Global error handler + 404 handler |
| [server/node_server/src/middleware/rateLimiter.ts](server/node_server/src/middleware/rateLimiter.ts) | IP-based rate limiter |
| [server/node_server/src/middleware/validation.ts](server/node_server/src/middleware/validation.ts) | express-validator chain runner |
| [server/node_server/src/middleware/upload.ts](server/node_server/src/middleware/upload.ts) | Multer memory-buffer upload middleware |
| [server/node_server/src/routes/index.ts](server/node_server/src/routes/index.ts) | Route aggregator |
| [server/node_server/src/routes/uploadRoutes.ts](server/node_server/src/routes/uploadRoutes.ts) | POST /upload/image and /upload/images |
| [server/node_server/src/services/storageService.ts](server/node_server/src/services/storageService.ts) | Supabase Storage: uploadFile, deleteFile, pathFromUrl |
| [server/node_server/prisma/schema.prisma](server/node_server/prisma/schema.prisma) | Complete MySQL database schema (8 models) |
| [server/node_server/schema.sql](server/node_server/schema.sql) | Raw SQL schema dump |
| [server/node_server/docker-compose.yml](server/node_server/docker-compose.yml) | MySQL + API Docker services |
| [server/node_server/Dockerfile](server/node_server/Dockerfile) | Multi-stage production build (Node 20) |

### ML Service (server/python_server/)

| File | Description |
|---|---|
| [server/python_server/services/ml/app/main.py](server/python_server/services/ml/app/main.py) | FastAPI app, CORS, router registration |
| [server/python_server/services/ml/app/config.py](server/python_server/services/ml/app/config.py) | ML service configuration |
| [server/python_server/services/ml/app/routers/verification.py](server/python_server/services/ml/app/routers/verification.py) | /verify, /extract-features, /health endpoints |
| [server/python_server/services/ml/app/models/schemas.py](server/python_server/services/ml/app/models/schemas.py) | Pydantic request/response models |
| [server/python_server/services/ml/app/comparison/hybrid.py](server/python_server/services/ml/app/comparison/hybrid.py) | HybridVerifier: weighted score aggregation |
| [server/python_server/services/ml/app/comparison/similarity.py](server/python_server/services/ml/app/comparison/similarity.py) | Similarity utility helpers |
| [server/python_server/services/ml/app/features/deep.py](server/python_server/services/ml/app/features/deep.py) | ResNet50 embedding extraction |
| [server/python_server/services/ml/app/features/sift.py](server/python_server/services/ml/app/features/sift.py) | SIFT + FLANN + RANSAC keypoint matching |
| [server/python_server/services/ml/app/features/traditional.py](server/python_server/services/ml/app/features/traditional.py) | Color, LBP texture, ORB features |
| [server/python_server/services/ml/app/utils/ocr.py](server/python_server/services/ml/app/utils/ocr.py) | Tesseract OCR for serial number matching |
| [server/python_server/services/ml/Dockerfile](server/python_server/services/ml/Dockerfile) | ML service Docker build |
| [server/python_server/services/ml/requirements.txt](server/python_server/services/ml/requirements.txt) | Python dependencies |

### Kiosk Controller (server/kiosk/)

| File | Description |
|---|---|
| [server/kiosk/main.py](server/kiosk/main.py) | Entry point: startup sequence, WiFi check, hardware init, UI, Socket.io loop |
| [server/kiosk/config.py](server/kiosk/config.py) | Env config: KIOSK_ID, SERVER_URL, GPIO pins, camera indices |
| [server/kiosk/kiosk_config.json](server/kiosk/kiosk_config.json) | Live timing parameters per locker (updated from admin) |
| [server/kiosk/diagnose.py](server/kiosk/diagnose.py) | Hardware diagnostic: camera detection, USB V4L2, GPIO test |
| [server/kiosk/hardware/gpio_controller.py](server/kiosk/hardware/gpio_controller.py) | SolenoidController: 12-relay gpiozero management |
| [server/kiosk/hardware/actuator_controller.py](server/kiosk/hardware/actuator_controller.py) | ActuatorController: L298N PWM direction control |
| [server/kiosk/hardware/camera_manager.py](server/kiosk/hardware/camera_manager.py) | CameraManager: CSI (picamera2) + USB (OpenCV) capture |
| [server/kiosk/services/socket_client.py](server/kiosk/services/socket_client.py) | Socket.io async client, event handlers, command dispatcher |
| [server/kiosk/services/face_service.py](server/kiosk/services/face_service.py) | Haar cascade face detection + ML service identity verify |
| [server/kiosk/services/image_uploader.py](server/kiosk/services/image_uploader.py) | Upload kiosk captures to Supabase Storage |
| [server/kiosk/kiosk_ui/server.py](server/kiosk/kiosk_ui/server.py) | Flask HDMI UI server (port 8080) |
| [server/kiosk/kiosk_ui/templates/index.html](server/kiosk/kiosk_ui/templates/index.html) | Kiosk display HTML |
| [server/kiosk/provisioning/wifi_manager.py](server/kiosk/provisioning/wifi_manager.py) | WiFi status check via nmcli |
| [server/kiosk/provisioning/ap_portal.py](server/kiosk/provisioning/ap_portal.py) | Captive portal for first-boot WiFi setup |
| [server/kiosk/systemd/engirent-kiosk.service](server/kiosk/systemd/engirent-kiosk.service) | Systemd auto-start for kiosk controller |
| [server/kiosk/systemd/engirent-kiosk-browser.service](server/kiosk/systemd/engirent-kiosk-browser.service) | Systemd auto-start for Chromium kiosk browser |
| [server/kiosk/SETUP.md](server/kiosk/SETUP.md) | Full hardware setup guide (wiring, OS, systemd, testing) |

### Admin Console (client/admin/)

| File | Description |
|---|---|
| [client/admin/src/app/layout.tsx](client/admin/src/app/layout.tsx) | Root layout, Manrope font, HeroUI providers |
| [client/admin/src/app/page.tsx](client/admin/src/app/page.tsx) | Auth guard redirect |
| [client/admin/src/app/login/page.tsx](client/admin/src/app/login/page.tsx) | Admin login with demo mode |
| [client/admin/src/app/dashboard/page.tsx](client/admin/src/app/dashboard/page.tsx) | Metrics dashboard |
| [client/admin/src/app/users/page.tsx](client/admin/src/app/users/page.tsx) | User management |
| [client/admin/src/app/items/page.tsx](client/admin/src/app/items/page.tsx) | Item inventory management |
| [client/admin/src/app/rentals/page.tsx](client/admin/src/app/rentals/page.tsx) | Rental operations view |
| [client/admin/src/app/verifications/page.tsx](client/admin/src/app/verifications/page.tsx) | AI verification queue + approve/reject |
| [client/admin/src/app/reports/page.tsx](client/admin/src/app/reports/page.tsx) | Analytics charts (sample data) |
| [client/admin/src/lib/api.ts](client/admin/src/lib/api.ts) | Axios instance, auth interceptors, demo adapter |
| [client/admin/src/components/layout/AdminLayout.tsx](client/admin/src/components/layout/AdminLayout.tsx) | Sidebar, header, mobile menu |
| [client/admin/src/components/charts/StatsCard.tsx](client/admin/src/components/charts/StatsCard.tsx) | Metric display card |

### Public Web App (client/web/)

| File | Description |
|---|---|
| [client/web/app/layout.tsx](client/web/app/layout.tsx) | Root layout, theme providers, navbar, footer |
| [client/web/app/page.tsx](client/web/app/page.tsx) | Home page: hero + feature grid |
| [client/web/app/about/page.tsx](client/web/app/about/page.tsx) | Project intent + team contact |
| [client/web/app/docs/page.tsx](client/web/app/docs/page.tsx) | Technical documentation (4 anchor sections) |
| [client/web/app/pricing/page.tsx](client/web/app/pricing/page.tsx) | 3-tier pricing cards |
| [client/web/app/blog/page.tsx](client/web/app/blog/page.tsx) | 3 project blog posts |
| [client/web/components/navbar.tsx](client/web/components/navbar.tsx) | Responsive navbar with theme switch |
| [client/web/config/site.ts](client/web/config/site.ts) | Site name, nav items, links config |

### Flutter App (client/flutter_app/)

| File | Description |
|---|---|
| [client/flutter_app/lib/main.dart](client/flutter_app/lib/main.dart) | App entry, routes, theme, MultiProvider |
| [client/flutter_app/pubspec.yaml](client/flutter_app/pubspec.yaml) | All Flutter dependencies |
| [client/flutter_app/lib/core/constants/app_constants.dart](client/flutter_app/lib/core/constants/app_constants.dart) | API URLs, storage keys, categories, statuses |
| [client/flutter_app/lib/core/services/api_service.dart](client/flutter_app/lib/core/services/api_service.dart) | HTTP wrapper with JWT injection |
| [client/flutter_app/lib/core/services/storage_service.dart](client/flutter_app/lib/core/services/storage_service.dart) | Secure token + preference storage |
| [client/flutter_app/lib/features/auth/models/auth_service.dart](client/flutter_app/lib/features/auth/models/auth_service.dart) | Login, register, profile, logout |
| [client/flutter_app/lib/features/auth/providers/auth_provider.dart](client/flutter_app/lib/features/auth/providers/auth_provider.dart) | ChangeNotifier auth state |
| [client/flutter_app/lib/features/home/screens/home_screen.dart](client/flutter_app/lib/features/home/screens/home_screen.dart) | 4-tab main dashboard |
| [client/flutter_app/lib/features/items/screens/items_screen.dart](client/flutter_app/lib/features/items/screens/items_screen.dart) | Item browse marketplace |
| [client/flutter_app/lib/features/items/screens/create_item_screen.dart](client/flutter_app/lib/features/items/screens/create_item_screen.dart) | Item listing form |
| [client/flutter_app/lib/features/kiosk/screens/kiosk_scan_screen.dart](client/flutter_app/lib/features/kiosk/screens/kiosk_scan_screen.dart) | QR kiosk validation UI |

### Root

| File | Description |
|---|---|
| [render.yaml](render.yaml) | Render.com cloud deployment config (4 services, Singapore region) |

---

*Generated by repository analysis on 2026-04-21.*
