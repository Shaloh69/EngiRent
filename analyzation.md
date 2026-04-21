# EngiRent Hub — Full Repository Analysis

**Date:** 2026-04-21  
**Repository:** EngiRent (monorepo)  
**Institution:** University of Cebu Lapu-Lapu and Mandaue (UCLM), College of Engineering  
**Type:** Engineering Thesis Project  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Structure](#2-project-structure)
3. [Technology Stack](#3-technology-stack)
4. [Backend — Node.js/Express API](#4-backend--nodejs-express-api)
5. [AI/ML Verification Service](#5-aiml-verification-service)
6. [Raspberry Pi Kiosk Controller](#6-raspberry-pi-kiosk-controller)
7. [Admin Console — Next.js](#7-admin-console--nextjs)
8. [Public Web App — Next.js](#8-public-web-app--nextjs)
9. [Flutter Mobile App](#9-flutter-mobile-app)
10. [Database Schema](#10-database-schema)
11. [API Endpoints](#11-api-endpoints)
12. [Authentication & Authorization](#12-authentication--authorization)
13. [Key Workflows](#13-key-workflows)
14. [Security Architecture](#14-security-architecture)
15. [Deployment — Render.com](#15-deployment--rendercom)
16. [Item Categories](#16-item-categories)
17. [Environment Variables](#17-environment-variables)
18. [Strengths](#18-strengths)
19. [Gaps & Incomplete Items](#19-gaps--incomplete-items)

---

## 1. Executive Summary

**EngiRent Hub** is an IoT-powered smart kiosk system enabling secure, peer-to-peer equipment rentals among engineering students at UCLM. The platform automates the full rental lifecycle — listing, booking, escrow payment, physical exchange via smart lockers, AI-powered item verification, and dispute resolution — replacing informal borrowing with structured, software-enforced workflows.

### Core Problem Solved

Engineering students informally lend and borrow expensive equipment (calculators, Arduino kits, measurement tools, etc.) with no accountability, fraud protection, or payment security. EngiRent Hub introduces:

- **Escrow-controlled payments** (PayMongo, held until verified return)
- **Smart locker kiosks** (automated, unattended item exchange via Raspberry Pi 5)
- **AI verification** at both deposit and return (prevents fraud by both parties)
- **Admin oversight** with manual review capability for edge cases

---

## 2. Project Structure

```
EngiRent/ (monorepo)
├── client/
│   ├── admin/              Next.js 15.5 admin console (port 3001)
│   ├── web/                Next.js 15.5 public website (port 3000)
│   └── flutter_app/        Flutter 3.9.2+ mobile app (iOS/Android)
│
├── server/
│   ├── node_server/        Node.js/Express REST API (port 5000)
│   │   └── prisma/         MySQL 8.0 schema + migrations
│   ├── python_server/
│   │   └── services/ml/    FastAPI ML verification service (port 8001)
│   └── kiosk/              Raspberry Pi 5 kiosk controller (Python)
│
├── render.yaml             Cloud deployment config (Render.com)
├── README.md               Comprehensive system guide (39KB)
├── analyzation.md          This file — full repository analysis
├── AI_SYSTEM_DOCUMENTATION.md   Deep dive into ML pipeline (64KB)
├── AI_VERIFICATION_GUIDE.md     ML workflow guide (19KB)
├── EngiRent_Hub_Analysis.md     Project analysis (27KB)
└── ITEM_CATEGORIES.md           8 item categories with survey data (12KB)
```

---

## 3. Technology Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Mobile App | Flutter (Dart) | SDK 3.9.2+ | iOS/Android student-facing app |
| Admin Console | Next.js + TypeScript | 15.5 / React 19 | Operations dashboard |
| Public Website | Next.js + TypeScript | 15.5 / React 18 | Marketing & documentation |
| Backend API | Node.js + Express | 18.x LTS | REST API, business logic |
| Database | MySQL | 8.0 | Relational data store |
| ORM | Prisma | 5.22 | Type-safe DB access |
| Real-time | Socket.io | 4.8.1 | Notifications + kiosk commands |
| ML Service | Python + FastAPI | 3.9+ / 0.115 | AI item verification |
| CV Libraries | OpenCV + scikit-image | 4.10 | Image processing |
| Deep Learning | PyTorch + ResNet50 | 2.5 | Semantic embeddings |
| OCR | Tesseract | — | Serial number extraction |
| Hardware | Raspberry Pi 5 | — | Kiosk controller |
| Storage | Supabase Storage | — | Image hosting (S3-compatible) |
| Auth | JWT + Bcrypt | — | Token-based authentication |
| Payment | PayMongo | — | Escrow payment processing |
| UI (web) | HeroUI + Tailwind CSS | 2.6 / 4.1 | Component library |
| State (web) | Zustand | — | Client-side state |
| State (mobile) | Provider | — | Flutter state management |
| Charts | Recharts | — | Admin analytics dashboards |
| Deployment | Render.com + Docker | — | Cloud hosting |

---

## 4. Backend — Node.js/Express API

**Location:** `server/node_server/`  
**Port:** 5000  
**Base Path:** `/api/v1`  
**Entry:** `src/index.ts`

### Middleware Stack

| Middleware | Purpose |
|---|---|
| Helmet | Security headers (CSP, X-Frame-Options, HSTS) |
| CORS | Restricted to configured client origins |
| Rate Limiter | 100 req / 15 min per IP (in-memory) |
| JWT Auth | `authenticate()` + `optionalAuth()` guards |
| Multer | File upload (memory buffer, 10MB max, MIME validation) |
| express-validator | Input validation before controllers |
| Global Error Handler | Centralized error formatting |

### Controllers

| Controller | Lines | Responsibilities |
|---|---|---|
| `authController.ts` | 329 | Register, login, refresh, logout, profile CRUD, password change |
| `itemController.ts` | 436 | Item CRUD + background ML feature extraction trigger |
| `rentalController.ts` | 430 | Rental lifecycle, status transitions, notifications |
| `paymentController.ts` | 426 | PayMongo payment creation, webhook handling, refunds |
| `kioskController.ts` | 271 | Deposit/claim/return, ML verification routing |
| `notificationController.ts` | 151 | Notification CRUD with read status tracking |
| `adminController.ts` | 654 | User management, verification review, system analytics |

### Background Jobs

When an item is created (`POST /items`), a background job immediately calls the ML service to pre-extract and cache visual features into `item.mlFeatures` (JSON). This prevents expensive ResNet50 inference at kiosk time — the verification call uses pre-cached `reference_features` instead.

---

## 5. AI/ML Verification Service

**Location:** `server/python_server/services/ml/`  
**Port:** 8001  
**Framework:** FastAPI (async)

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/verify` | Full hybrid verification pipeline |
| `POST` | `/api/v1/extract-features` | Pre-extract features for caching |
| `GET` | `/api/v1/health` | Service health + capability flags |

### 8-Stage Hybrid Pipeline

| Stage | Method | Weight |
|---|---|---|
| 1 | Image Quality Gate — blur, brightness, coverage checks | Gate only |
| 2 | Perceptual Hash (pHash) — quick visual similarity filter | 10% |
| 3 | Traditional CV — color histogram + LBP texture + ORB keypoints | 20% |
| 4 | SIFT + FLANN + RANSAC — keypoint matching + geometric validation | 20% |
| 5 | SSIM — structural similarity index (pixel-level) | (part of traditional) |
| 6 | ResNet50 Deep Learning — CNN semantic embeddings | 40% |
| 7 | OCR Serial Number Matching — Tesseract text extraction | 10% |
| 8 | Hybrid Score — weighted aggregation of all methods | Final decision |

### Image Pre-processing

1. Gray-world white balance correction
2. CLAHE contrast normalization
3. Aspect-ratio-preserving resize to 640×640
4. GrabCut background removal (listing images) / White threshold (kiosk captures)

### Decision Thresholds

| Score | Decision | Effect |
|---|---|---|
| ≥ 85% | `APPROVED` | Rental proceeds, locker locked |
| 60–84% | `PENDING` | Proceeds + flagged for manual admin review |
| < 60% (attempt < 10) | `RETRY` | Locker opened, user repositions item |
| < 60% (attempt ≥ 10) | `REJECTED` | Rental cancelled, renter refunded |

### Feature Caching Strategy

- Item creation → background ML call → extracted features cached in `item.mlFeatures` (JSON in DB)
- At kiosk deposit/return → `reference_features` sent directly → skips expensive re-extraction
- Reduces verification latency significantly for repeat interactions

---

## 6. Raspberry Pi Kiosk Controller

**Location:** `server/kiosk/`  
**Language:** Python 3 (asyncio + gpiozero + socketio)  
**Hardware:** Raspberry Pi 5 (4GB+) with 4 lockers

### Hardware Components (per unit)

| Component | Count | Purpose |
|---|---|---|
| Raspberry Pi 5 | 1 | Main controller |
| 5V 4-channel relay modules | 3 | 12 solenoid control channels |
| 12V solenoid locks | 12 | 3 per locker (main_door, trapdoor, bottom_door) |
| L298N dual H-bridge drivers | 2 | 4 linear actuator channels |
| 12V linear actuators | 4 | Trapdoor push/pull mechanism |
| Raspberry Pi Camera Module 3 | 2 | CSI0, CSI1 ports |
| USB webcams | 3 | Lockers 3/4 capture + face camera |
| HDMI touchscreen | 1 | 7–10" kiosk UI display |

### Locker Mechanical Design (3-door system)

| Door | Name | Purpose |
|---|---|---|
| Top | `main_door` | Owner inserts item / renter retrieves item |
| Middle | `trapdoor` | Internal drop mechanism (penalty/automated drop) |
| Bottom | `bottom_door` | Renter retrieval access (alternate path) |

### Startup Sequence

1. Load `.env`, initialize logging
2. Check WiFi → if not connected, start AP `"EngiRent-Kiosk-Setup"` (captive portal)
3. Initialize hardware (relays, actuators, cameras)
4. Start Flask UI server on port 8080 → launch Chromium in kiosk mode
5. Connect Socket.io client to backend → emit `kiosk:register` → wait for commands

### Socket.io Protocol

**Emits TO backend:**

| Event | Payload |
|---|---|
| `kiosk:register` | `{ kiosk_id }` |
| `kiosk:status` | Hardware status object |
| `kiosk:images` | Captured image URLs (Supabase) |
| `kiosk:face` | Face verification result |
| `kiosk:error` | Error details |

**Receives FROM backend:**

| Event | Payload |
|---|---|
| `kiosk:command` | `{ action, locker_id, params }` |
| `kiosk:config` | Updated timing/hardware config |

**Supported Actions:**

`open_door`, `drop_item`, `capture_image`, `capture_face`, `lock_all`, `actuator_extend`, `actuator_retract`

### Development Mode

Set `MOCK_GPIO=true MOCK_CAMERA=true` to run full kiosk simulation without physical hardware. All GPIO calls and camera operations are mocked.

---

## 7. Admin Console — Next.js

**Location:** `client/admin/`  
**Port:** 3001  
**Stack:** Next.js 15.5, React 19, TypeScript, HeroUI 2.6, Tailwind CSS 4.1, Zustand, Recharts

### Pages

| Route | Purpose |
|---|---|
| `/` | Auth guard — redirects to dashboard or login |
| `/login` | Email/password login + demo mode toggle |
| `/dashboard` | Metrics, revenue chart, recent rentals |
| `/users` | User list, search, activate/deactivate |
| `/items` | Inventory browser, filter, view/delete |
| `/rentals` | Rental list, filter by status |
| `/verifications` | AI verification queue, confidence scores, approve/reject modal |
| `/reports` | Analytics — revenue, rental counts, category breakdown |

### Demo Mode

Set `NEXT_PUBLIC_DEMO_MODE=true` to enable in-memory state with sample data. All mutations are mocked locally — no backend required. Used for presentations and development.

### Key Components

- `AdminLayout` — Sticky header (notifications, user dropdown), sidebar navigation, mobile hamburger
- `StatsCard` — Metric card with icon and optional trend percentage
- Charts (Recharts): `LineChart` (revenue over time), `BarChart` (rentals, categories)

---

## 8. Public Web App — Next.js

**Location:** `client/web/`  
**Port:** 3000  
**Stack:** Next.js 15.5, React 18, TypeScript, HeroUI, Tailwind CSS

### Pages

| Route | Purpose |
|---|---|
| `/` | Hero section + feature grid (Booking, Kiosk, AI Verification, Escrow) |
| `/about` | Project intent, team, university, contact |
| `/docs` | 4 technical sections (Owner Flow, Renter Flow, Verification, Security) |
| `/pricing` | 3 tiers (Student Basic, Kiosk Transaction, Admin Operations) |
| `/blog` | 3 project posts |

### Components

- `Navbar` — Logo, nav items, theme switcher (light/dark)
- `Primitives` — Styled heading/subtitle components for consistent typography

---

## 9. Flutter Mobile App

**Location:** `client/flutter_app/`  
**SDK:** Flutter 3.9.2+  
**State Management:** Provider (ChangeNotifier)  
**HTTP:** `dart:http` wrapper via `ApiService`

### Routes (6 named routes)

| Route | Screen |
|---|---|
| `/login` | `LoginScreen` (entry point) |
| `/register` | `RegisterScreen` |
| `/home` | `HomeScreen` (4-tab dashboard) |
| `/items` | `ItemsScreen` (marketplace browse) |
| `/items/search` | `ItemsScreen` (search variant) |
| `/items/create` | `CreateItemScreen` |
| `/kiosk/scan` | `KioskScanScreen` (placeholder) |

### Core Architecture Layers

| Layer | Files | Purpose |
|---|---|---|
| Constants | `api_constants.dart`, `app_constants.dart` | API URLs, storage keys, enums |
| Models | `UserModel`, `ItemModel`, `RentalModel`, `NotificationModel` | API data structures |
| Services | `ApiService`, `StorageService` | REST wrapper + secure token storage |
| Providers | Feature-specific ChangeNotifiers | State management per feature |
| Screens | Per-route UI screens | Feature views |

### Key Dependencies (40+ packages)

| Category | Packages |
|---|---|
| UI | google_fonts, flutter_svg, cached_network_image, shimmer, badges, flutter_rating_bar |
| State | provider, get_it (installed, not wired) |
| HTTP | http (active), dio (installed, unused) |
| Storage | shared_preferences, flutter_secure_storage |
| Navigation | go_router (installed, not integrated), named routes active |
| Images | image_picker, image_cropper (installed, not connected) |
| QR | qr_code_scanner, qr_flutter (installed, not functional) |
| Notifications | flutter_local_notifications (installed, not hooked) |
| Date/Time | intl, timeago |
| Utilities | url_launcher, permission_handler, connectivity_plus |

### Features (Implemented)

- Auth — register, login, profile, logout via REST API
- Home — 4-tab dashboard (home, rentals, notifications, profile)
- Items — Browse marketplace, search, create listing (URL-based images)
- Basic kiosk scan screen (static UI)

---

## 10. Database Schema

**ORM:** Prisma 5.22 | **Database:** MySQL 8.0  
**Schema:** `server/node_server/prisma/schema.prisma`

### Models

#### User
| Field | Type | Notes |
|---|---|---|
| id | String | UUID, primary key |
| email | String | Unique |
| password | String | Bcrypt hash |
| studentId | String | Unique, UCLM ID |
| firstName / lastName | String | — |
| phone | String? | Optional |
| profileImage | String? | Supabase URL |
| parentName / parentContact | String? | Emergency contact |
| isVerified | Boolean | Admin-verified status |
| isActive | Boolean | Account enabled flag |
| refreshToken | String? | Stored for server-side invalidation |
| lastLogin | DateTime? | Audit timestamp |

#### Item
| Field | Type | Notes |
|---|---|---|
| id | String | UUID |
| ownerId | String | FK → User |
| title / description | String | Listing content |
| category | ItemCategory | Enum (8 values) |
| condition | ItemCondition | Enum (5 values) |
| pricePerDay / Week / Month | Decimal | Rental rates |
| securityDeposit | Decimal | Held in escrow |
| images | Json | Array of Supabase URLs |
| mlFeatures | Json? | Cached ResNet50 embeddings |
| serialNumber | String? | For OCR verification |
| isAvailable / isActive | Boolean | Listing flags |
| campusLocation | String? | Where item is held |
| totalRentals / averageRating | Int / Float | Computed stats |

#### Rental
| Field | Type | Notes |
|---|---|---|
| id | String | UUID |
| itemId / renterId / ownerId | String | FKs |
| startDate / endDate | DateTime | Rental window |
| actualReturnDate | DateTime? | Set on completion |
| status | RentalStatus | Enum (10 states) |
| totalPrice / securityDeposit | Decimal | Financial amounts |
| depositLockerId / claimLockerId / returnLockerId | String? | Locker assignments |
| depositVerificationId / verificationId | String? | FK → Verification |
| depositAttemptCount / returnAttemptCount | Int | Retry tracking |

#### Transaction
| Field | Type | Notes |
|---|---|---|
| id | String | UUID |
| rentalId / userId | String | FKs |
| type | TransactionType | RENTAL_PAYMENT, SECURITY_DEPOSIT, etc. |
| amount | Decimal | — |
| status | TransactionStatus | PENDING → COMPLETED / FAILED / REFUNDED |
| paymentReferenceNo | String? | PayMongo reference |
| paymongoPaymentId / paymongoCheckoutId | String? | PayMongo IDs |
| paymentMethod / paymentDetails | String? / Json | — |

#### Verification
| Field | Type | Notes |
|---|---|---|
| id | String | UUID |
| originalImages / kioskImages | Json | URL arrays |
| decision | VerificationDecision | APPROVED / PENDING / RETRY / REJECTED |
| confidenceScore | Float | 0.0–1.0 |
| attemptNumber | Int | Which attempt this was |
| traditionalScore / siftScore / deepLearningScore | Float | Per-method scores |
| ocrMatch | Boolean | Serial match result |
| ocrDetails | Json? | OCR text details |
| status | VerificationStatus | Processing state |
| reviewedBy / reviewNotes | String? | Manual review fields |

#### Locker
| Field | Type | Notes |
|---|---|---|
| id | String | UUID |
| lockerNumber | Int | Unique within kiosk |
| kioskId | String | Which kiosk unit |
| size | LockerSize | SMALL / MEDIUM / LARGE / EXTRA_LARGE |
| status | LockerStatus | AVAILABLE / OCCUPIED / RESERVED / MAINTENANCE |
| isOperational | Boolean | Hardware health flag |
| currentRentalId | String? | FK → Rental |
| lastUsedAt | DateTime? | Audit |

#### KioskConfig
| Field | Type | Notes |
|---|---|---|
| id | String | UUID |
| kioskId | String | Unique, one config per kiosk |
| config | Json | Timing & hardware settings |
| updatedBy | String? | Admin who last changed it |

#### Notification
| Field | Type | Notes |
|---|---|---|
| id | String | UUID |
| userId | String | FK → User |
| title / message | String | Display content |
| type | NotificationType | Enum (12 values) |
| relatedEntityId / Type | String? | Linked rental/item/etc. |
| isRead / readAt | Boolean / DateTime? | Read tracking |

#### Review
| Field | Type | Notes |
|---|---|---|
| id | String | UUID |
| itemId / authorId / recipientId | String | FKs |
| rating | Int | 1–5 stars |
| comment | String? | Optional text |
| reviewType | ReviewType | ITEM / USER |

### Enums

| Enum | Values |
|---|---|
| `ItemCategory` | SCHOOL_ATTIRE, ACADEMIC_TOOLS, ELECTRONICS, DEVELOPMENT_KITS, MEASUREMENT_TOOLS, AUDIO_VISUAL, SPORTS_EQUIPMENT, OTHER |
| `ItemCondition` | NEW, LIKE_NEW, GOOD, FAIR, ACCEPTABLE |
| `RentalStatus` | PENDING → AWAITING_DEPOSIT → DEPOSITED → AWAITING_CLAIM → ACTIVE → AWAITING_RETURN → VERIFICATION → COMPLETED (or CANCELLED / DISPUTED) |
| `VerificationDecision` | APPROVED, PENDING, RETRY, REJECTED |
| `VerificationStatus` | PENDING, PROCESSING, COMPLETED, MANUAL_REVIEW, APPROVED, REJECTED |
| `TransactionType` | RENTAL_PAYMENT, SECURITY_DEPOSIT, DEPOSIT_REFUND, LATE_FEE, DAMAGE_FEE |
| `TransactionStatus` | PENDING, PROCESSING, COMPLETED, FAILED, REFUNDED |
| `NotificationType` | BOOKING_CONFIRMED, DEPOSIT_REMINDER, ITEM_READY_FOR_CLAIM, ITEM_CLAIMED, RETURN_REMINDER, ITEM_RETURNED, VERIFICATION_PASSED, VERIFICATION_FAILED, RENTAL_COMPLETED, RENTAL_CANCELLED, RENTAL_DISPUTED, PAYMENT_RECEIVED |
| `LockerSize` | SMALL, MEDIUM, LARGE, EXTRA_LARGE |
| `LockerStatus` | AVAILABLE, OCCUPIED, RESERVED, MAINTENANCE, OUT_OF_SERVICE |

---

## 11. API Endpoints

**Base URL:** `/api/v1` (port 5000)

### Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Register new student account |
| POST | `/auth/login` | — | Login, returns access + refresh tokens |
| POST | `/auth/refresh` | — | Exchange refresh token for new access token |
| POST | `/auth/logout` | JWT | Invalidate refresh token server-side |
| GET | `/auth/profile` | JWT | Get authenticated user's profile |
| PUT | `/auth/profile` | JWT | Update profile (name, phone, parent contact, image) |
| PUT | `/auth/password` | JWT | Change password (requires current password) |

### Items

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/items` | JWT | Create item listing (triggers background ML extraction) |
| GET | `/items` | Optional | List items: category, search, minPrice, maxPrice, condition, isAvailable, campusLocation, page, limit |
| GET | `/items/my-items` | JWT | Current user's listed items |
| GET | `/items/:id` | Optional | Item detail with owner info and reviews |
| PUT | `/items/:id` | JWT | Update item (owner only) |
| DELETE | `/items/:id` | JWT | Soft-delete item (blocked if active rentals exist) |

### Rentals

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/rentals` | JWT | Create rental request, auto-calculate price |
| GET | `/rentals` | JWT | List: type (rented/owned), status, pagination |
| GET | `/rentals/:id` | JWT | Detail with item, users, transactions, verifications |
| PATCH | `/rentals/:id/status` | JWT | Update status with locker assignments |
| POST | `/rentals/:id/cancel` | JWT | Cancel if PENDING or AWAITING_DEPOSIT |

### Payments

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/payments` | JWT | Create PayMongo payment transaction |
| POST | `/payments/confirm` | — | Webhook callback to confirm payment |
| GET | `/payments` | JWT | List user transactions (filterable by status/type) |
| POST | `/payments/:transactionId/refund` | JWT | Process refund + notify user |

### Kiosk

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/kiosk/deposit` | JWT | Owner deposits item → triggers ML verification |
| POST | `/kiosk/claim` | JWT | Renter claims item from locker |
| POST | `/kiosk/return` | JWT | Renter returns item → triggers ML verification |
| GET | `/kiosk/lockers` | JWT | List available lockers (filterable by size) |

### Upload

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/upload/image` | JWT | Upload single image → Supabase Storage, returns URL |
| POST | `/upload/images` | JWT | Upload up to 10 images → returns URL array |

### Notifications

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/notifications` | JWT | Get user's notifications with `unreadCount` |
| PATCH | `/notifications/:id/read` | JWT | Mark single notification read |
| PATCH | `/notifications/read-all` | JWT | Mark all notifications read |
| DELETE | `/notifications/:id` | JWT | Delete notification |

### Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/users` | Admin JWT | List all users |
| PATCH | `/admin/users/:id/status` | Admin JWT | Activate/deactivate user |
| GET | `/admin/verifications` | Admin JWT | Verification queue with scores |
| PATCH | `/admin/verifications/:id/review` | Admin JWT | Manually approve/reject verification |
| GET | `/admin/kiosk-config/:kioskId` | Admin JWT | Get kiosk timing config |
| PUT | `/admin/kiosk-config/:kioskId` | Admin JWT | Update kiosk config |
| GET | `/admin/dashboard` | Admin JWT | Analytics metrics (users, items, rentals, revenue) |

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Docker/Render health check |

---

## 12. Authentication & Authorization

### Token System

| Token Type | Lifetime | Storage | Purpose |
|---|---|---|---|
| Access Token | 7 days | Flutter: `FlutterSecureStorage` (AES) / Admin: `localStorage` | API authorization |
| Refresh Token | 30 days | Flutter: `FlutterSecureStorage` / DB: `user.refreshToken` | Token renewal |

### Token Rotation

- `POST /auth/refresh` generates a new access token
- Refresh token stored in DB enables server-side invalidation (logout blacklists it)
- Even if a refresh token is intercepted, `POST /auth/logout` prevents reuse

### Password Security

- Bcrypt hashing via `bcryptjs` (configurable salt rounds)
- Password change requires verification of current password before accepting new one

### Admin Authorization

- Separate admin JWT stored in `localStorage` (admin console)
- 401 responses clear admin token automatically → redirect to login

### Rate Limiting

- 100 requests per 15-minute window per IP address
- In-memory rate limiter (resets on server restart)

---

## 13. Key Workflows

### 1. Owner Listing Flow

1. Owner uploads 3+ photos → `POST /upload/images` → Supabase Storage URLs returned
2. Owner creates listing → `POST /items` with image URLs, prices, category, condition
3. **Background job triggered:** ML service pre-extracts visual features → cached in `item.mlFeatures`

### 2. Rental Request & Payment

1. Renter books item → `POST /rentals` → status: `PENDING`
2. Owner receives `BOOKING_CONFIRMED` notification
3. Renter pays via PayMongo → `POST /payments` → `POST /payments/confirm` (webhook)
4. Status advances to `AWAITING_DEPOSIT`

### 3. Owner Deposits Item at Kiosk

1. Backend sends Socket.io `kiosk:command { action: "open_door", locker_id: X, door: "main_door" }`
2. Pi energizes solenoid relay → door unlocks
3. Owner places item inside locker, door closes
4. Backend sends `kiosk:command { action: "capture_image", locker_id: X }`
5. Pi captures frames → uploads to Supabase → emits `kiosk:images` with URLs
6. Backend calls ML service: original listing images vs kiosk captures
   - **APPROVED (≥85%):** Status → `DEPOSITED`, locker locked
   - **PENDING (60–84%):** Status → `DEPOSITED` + `MANUAL_REVIEW` flag for admin
   - **RETRY (<60%, attempt<10):** Locker reopens, owner repositions item
   - **REJECTED (10th attempt):** Rental → `CANCELLED`, renter refunded

### 4. Renter Claims Item

1. Backend sends `kiosk:command { action: "capture_face", rental_id: X, user_id: Y }`
2. Pi captures face → OpenCV Haar cascade detects → ML service verifies identity
3. If verified: Backend sends `kiosk:command { action: "open_door", door: "main_door" }`
4. Renter takes item, door closes
5. Status → `ACTIVE`, owner notified

### 5. Renter Returns Item

1. Renter goes to kiosk, places item back
2. Backend sends `open_door` + `capture_image` + `capture_face` commands sequentially
3. Pi executes each → emits `kiosk:images` + `kiosk:face` results
4. Backend calls ML service: original listing images vs returned item images
   - **APPROVED:** Status → `COMPLETED`, security deposit refunded, payment released to owner
   - **PENDING:** Flagged for admin manual review
   - **REJECTED:** Status → `DISPUTED`, admin investigates damage/fraud

### 6. Admin Review Flow

1. Admin opens `/verifications` page in admin console
2. Views verification with confidence score breakdown (traditional, SIFT, deep learning, OCR)
3. Reviews original listing images vs kiosk images side-by-side
4. Manually approves or rejects → `PATCH /admin/verifications/:id/review`
5. System notifies both parties of admin decision

---

## 14. Security Architecture

### API Layer

| Control | Implementation |
|---|---|
| Security headers | Helmet middleware (CSP, X-Frame-Options, X-Content-Type-Options, HSTS) |
| CORS | Restricted to `CLIENT_WEB_URL` and `CLIENT_MOBILE_URL` |
| Rate limiting | 100 req / 15 min per IP (in-memory) |
| Input validation | express-validator on all endpoints before controller logic |
| SQL injection | Prisma parameterized queries (no raw SQL) |
| File uploads | Multer MIME type + size validation before Supabase upload |

### Kiosk Layer

| Control | Implementation |
|---|---|
| Identity verification | OpenCV Haar cascade face detection + ML service identity confirmation |
| Attempt tracking | Max 10 ML verification attempts prevents brute-force repositioning |
| Mutual verification | Both deposit (protects renter) and return (protects owner) are verified |
| Socket authentication | Kiosk registers with unique `KIOSK_ID` on connect |
| Hardware isolation | Mock mode (`MOCK_GPIO`, `MOCK_CAMERA`) separates test from production |

### Data Layer

| Control | Implementation |
|---|---|
| Transport | TLS/SSL for all communications (Render.com terminates SSL) |
| Images | Supabase Storage (encrypted at rest, signed URLs) |
| Tokens | JWT signed with secrets (min 32 chars), stored encrypted in Flutter |
| Passwords | Bcrypt hash, never logged or exposed |

---

## 15. Deployment — Render.com

**File:** `render.yaml`  
**Region:** Singapore (closest to Philippines)

### 4 Production Services

| Service | Type | Plan | Location |
|---|---|---|---|
| `engirent-api` | Node.js Web | Free | `server/node_server/` |
| `engirent-admin` | Next.js Web | Free | `client/admin/` |
| `engirent-web` | Next.js Web | Free | `client/web/` |
| `engirent-ml` | Docker | Starter | `server/python_server/services/ml/` |

### Production URLs

| Service | URL |
|---|---|
| API | `https://engirent-api.onrender.com` |
| Admin Console | `https://engirent-admin.onrender.com` |
| Public Website | `https://engirent-web.onrender.com` |
| ML Service | `https://engirent-ml.onrender.com` |

### engirent-api (Node.js)

- **Build:** `npm install --production=false && npm run build`
- **Start:** `npm start`
- **Pre-deploy hook:** `npx prisma db push`
- **Health check:** `GET /api/v1/health`
- **Required secrets:** `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### engirent-ml (Docker)

- **Dockerfile:** `server/python_server/services/ml/Dockerfile`
- **Base:** Python 3.9+
- **Framework:** FastAPI + uvicorn
- **Health check:** `GET /`

### Docker Compose (Local Development)

**File:** `server/node_server/docker-compose.yml`

| Service | Image | Port | Purpose |
|---|---|---|---|
| `engirent-mysql` | MySQL 8.0 | 3306 | Local database |
| `engirent-api` | Node 20 multi-stage | 5000 | Local API |

### Node.js Dockerfile (Multi-stage)

- **Stage 1:** Install deps, Prisma generate, TypeScript compile
- **Stage 2:** Production deps only + compiled JS
- **Health check:** `GET /api/v1/health`

### Kiosk Deployment

- Raspberry Pi 5 connects to production API via `SERVER_URL=https://engirent-api.onrender.com`
- Images uploaded directly to Supabase Storage (bypasses API)
- Socket.io persistent WebSocket connection to backend

---

## 16. Item Categories

Based on UCLM engineering student survey (31 respondents, 2025):

| Category | Key Items | Survey Demand |
|---|---|---|
| School Attire | Lab gowns, PE uniforms, school uniforms | 77.4% (lab gowns) |
| Academic Tools | Scientific calculators, engineering drawing tools, periodic tables | 74.2% (calculators) |
| Electronics | Power banks, laptops, tablets, chargers, USB drives | 70.97% (power banks — highest overall) |
| Development Kits | Arduino boards, Raspberry Pi kits, breadboards, sensors | 35.48% (Arduino) |
| Measurement Tools | Multimeters, oscilloscopes, calipers | — |
| Audio/Visual | Cameras, headphones, projectors | — |
| Sports Equipment | PE class items | — |
| Other | Miscellaneous | — |

---

## 17. Environment Variables

### Backend (`server/node_server/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | MySQL connection string |
| `JWT_SECRET` | Yes | — | Access token signing key (min 32 chars) |
| `JWT_REFRESH_SECRET` | Yes | — | Refresh token signing key (min 32 chars) |
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | Supabase admin key |
| `ML_SERVICE_URL` | No | `http://localhost:8001` | ML service endpoint |
| `CLIENT_WEB_URL` | No | — | CORS allowed origin (web) |
| `CLIENT_MOBILE_URL` | No | — | CORS allowed origin (mobile) |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate limit window (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Max requests per window |

### ML Service (`server/python_server/services/ml/.env`)

| Variable | Description |
|---|---|
| `MODEL_PATH` | Path to ML model file |
| `CONFIDENCE_THRESHOLD` | Minimum verification confidence (default: 0.85) |
| `MAX_RETRY_ATTEMPTS` | Max kiosk verification attempts (default: 10) |

### Kiosk (`server/kiosk/.env`)

| Variable | Description |
|---|---|
| `KIOSK_ID` | Unique identifier for this kiosk unit |
| `SERVER_URL` | Backend API URL |
| `SUPABASE_URL` | For direct image uploads |
| `SUPABASE_SERVICE_ROLE_KEY` | Image upload authentication |
| `MOCK_GPIO` | `true` to disable real GPIO (development) |
| `MOCK_CAMERA` | `true` to disable real cameras (development) |
| GPIO pin assignments | Per solenoid, actuator, and camera channel |

---

## 18. Strengths

| Area | Detail |
|---|---|
| Complete hardware layer | Raspberry Pi 5 kiosk fully implemented — GPIO, actuators, cameras, face recognition, WiFi provisioning |
| Clean architecture | Feature-based folder structure, controllers/middleware/services separation |
| End-to-end lifecycle | Full flow from listing → payment → kiosk → ML verification → completion |
| Hybrid ML pipeline | 8 complementary methods for robust fraud detection, not a single-point-of-failure |
| Feature caching | Pre-extracted ML features reduce verification latency at kiosk time |
| Attempt tracking | Persistent retry counters survive server restarts (stored in DB) |
| Supabase Storage | Image hosting fully wired with upload endpoints live |
| Demo mode | Admin console has demo fallback for presentations without backend |
| Real-time architecture | Socket.io serves both user notification push AND kiosk hardware command/response loop |
| Cloud deployment | `render.yaml` defines all 4 production services declaratively |
| Docker-ready | ML service deploys via Docker, Node API has multi-stage build |
| Environment validation | Zod schema catches missing config at startup (fail-fast) |
| Mock hardware mode | `MOCK_GPIO=true MOCK_CAMERA=true` enables full kiosk testing without Pi hardware |
| Security headers | Helmet, CORS restrictions, rate limiting, parameterized queries — all wired |

---

## 19. Gaps & Incomplete Items

### Flutter Mobile App

| Gap | Detail |
|---|---|
| GoRouter not integrated | Installed but basic named routes map is used — no deep linking or auth guards |
| Image upload not connected | `CreateItemScreen` uses text input for URLs; `image_picker` installed but not wired to `POST /upload` |
| QR scanner placeholder | `KioskScanScreen` shows static UI; `qr_code_scanner` installed but not functional |
| `get_it` service locator unused | Installed but providers registered manually via `Provider` widgets |
| `dio` HTTP client unused | Advanced HTTP client installed, `dart:http` wrapper active instead |
| Local notifications not hooked | `flutter_local_notifications` installed but not integrated with notification API |
| No pagination | `ItemsScreen` loads all items; no page/scroll-based pagination |

### Backend

| Gap | Detail |
|---|---|
| Face verification endpoint missing | `face_service.py` on the Pi calls `/api/v1/verify-face` which doesn't exist in FastAPI — only `/verify` and `/extract-features` are defined |
| GCash not integrated | Old documentation references GCash; actual integration is PayMongo only |
| Admin kiosk config UI missing | Endpoint documented (`PUT /admin/kiosk-config/:kioskId`) but no admin frontend page for it |
| Node kiosk REST routes partially wired | `kioskRoutes.ts` exists but actual hardware communication uses Socket.io now |

### Testing

| Gap | Detail |
|---|---|
| No test suite | Zero unit, widget, or integration tests found across any service |
| Admin reports use sample data | `/reports` page has hardcoded data; no real API aggregation endpoint |

### Deployment

| Gap | Detail |
|---|---|
| Free tier cold starts | Render free tier services sleep after 15 min inactivity — first request after idle takes 30–60s |
| In-memory rate limiter | Rate limiting resets on process restart and doesn't work across multiple instances |
