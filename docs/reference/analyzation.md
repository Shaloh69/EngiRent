# EngiRent Hub — Full Repository Analysis

**Last Updated:** 2026-04-24  
**Repository:** EngiRent (monorepo)  
**Institution:** University of Cebu Lapu-Lapu and Mandaue (UCLM), College of Engineering  
**Type:** Engineering Thesis Project  
**Active Contributors:** Shem Joshua M. Dumpor, adriancabil19-create

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
18. [Recent Changes (Post-2026-04-21)](#18-recent-changes-post-2026-04-21)
19. [Strengths](#19-strengths)
20. [Gaps & Incomplete Items](#20-gaps--incomplete-items)

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
| Backend API | Node.js + Express | 20.x | REST API, business logic |
| Database | MySQL | 8.0 (Aiven cloud) | Relational data store |
| ORM | Prisma | 5.22 | Type-safe DB access |
| Real-time | Socket.io | 4.8.1 | Notifications + kiosk commands |
| ML Service | Python + FastAPI | 3.12 / 0.115 | AI item verification |
| CV Libraries | OpenCV + scikit-image | 4.10 | Image processing |
| Deep Learning | PyTorch + ResNet50 | 2.5 (CPU-only on Render) | Semantic embeddings |
| OCR | Tesseract | — | Serial number extraction |
| Hardware | Raspberry Pi 5 | Pi OS Trixie 64-bit | Kiosk controller |
| GPIO Library | lgpio (direct) | — | GPIO control (replaces gpiozero) |
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
| Rate Limiter | 100 req / 15 min per IP (in-memory, skips /admin routes) |
| JWT Auth | `authenticate()` + `optionalAuth()` guards |
| Multer | File upload (memory buffer, 10MB max, MIME validation) |
| express-validator | Input validation before controllers |
| Global Error Handler | Centralized error formatting + Prisma error translation |

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

### Socket.io Events (server/kiosk protocol)

| Direction | Event | Description |
|---|---|---|
| ← Pi | `kiosk:register` | Pi announces online, receives stored config |
| ← Pi | `kiosk:status` | Locker door state updates |
| ← Pi | `kiosk:images` | Captured image URLs → triggers ML verification |
| ← Pi | `kiosk:face` | Face verification result → advances rental state |
| ← Pi | `kiosk:log` | Pi log lines forwarded to Render server logs |
| ← Pi | `kiosk:ack` | Command execution result (ok / error) |
| → Pi | `kiosk:command` | `{ action, locker_id, params }` |
| → Pi | `kiosk:config` | Updated timing/hardware config from admin |

### Background Jobs

When an item is created (`POST /items`), `setImmediate` triggers the ML service to pre-extract and cache visual features into `item.mlFeatures` (JSON). This prevents expensive ResNet50 inference at kiosk deposit/return time.

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
- Significantly reduces verification latency for repeat interactions

---

## 6. Raspberry Pi Kiosk Controller

**Location:** `server/kiosk/`  
**Language:** Python 3.13 (asyncio + lgpio + socketio)  
**Hardware:** Raspberry Pi 5 (Pi OS Trixie 64-bit)

### Hardware Components

| Component | Count | Purpose |
|---|---|---|
| Raspberry Pi 5 (4GB+) | 1 | Main controller |
| SRD-05VDC-SL-C 4-ch relay board | 3 | 12 channels: 4 main doors + 4 bottom doors + 4 actuator channels (L1/L2) |
| SRD-12VDC-SL-C 1-ch relay module | 4 | 4 actuator channels (L3/L4 extend + retract) |
| 12V solenoid locks | 8 | 2 per locker (main_door + bottom_door) |
| 12V linear actuators | 4 | Item placement mechanism (relay polarity reversal) |
| USB webcams | 5 | 4 locker cameras (index 0–3) + 1 face recognition camera (index 4) |
| HDMI touchscreen | 1 | 7–10" local kiosk UI display |

> **Note:** Trapdoor door removed from design. CSI cameras removed; all 5 cameras are now USB.

### GPIO Pin Map (current — `config.py`)

| Locker | Signal | BCM Pin | Physical Pin | Module |
|---|---|---|---|---|
| 1 | Main Door Solenoid | GPIO 2 | Pin 3 | 4-ch SRD-05V board #1 |
| 2 | Main Door Solenoid | GPIO 3 | Pin 5 | 4-ch SRD-05V board #1 |
| 3 | Main Door Solenoid | GPIO 4 | Pin 7 | 4-ch SRD-05V board #1 |
| 4 | Main Door Solenoid | GPIO 5 | Pin 29 | 4-ch SRD-05V board #1 |
| 1 | Bottom Door Solenoid | GPIO 6 | Pin 31 | 4-ch SRD-05V board #2 |
| 2 | Bottom Door Solenoid | GPIO 7 | Pin 26 | 4-ch SRD-05V board #2 |
| 3 | Bottom Door Solenoid | GPIO 8 | Pin 24 | 4-ch SRD-05V board #2 |
| 4 | Bottom Door Solenoid | GPIO 9 | Pin 21 | 4-ch SRD-05V board #2 |
| 1 | Actuator Extend | GPIO 10 | Pin 19 | 4-ch SRD-05V board #3 |
| 1 | Actuator Retract | GPIO 11 | Pin 23 | 4-ch SRD-05V board #3 |
| 2 | Actuator Extend | GPIO 12 | Pin 32 | 4-ch SRD-05V board #3 |
| 2 | Actuator Retract | GPIO 13 | Pin 33 | 4-ch SRD-05V board #3 |
| 3 | Actuator Extend | GPIO 14 | Pin 8 | 1-ch SRD-12V module |
| 3 | Actuator Retract | GPIO 15 | Pin 22 | 1-ch SRD-12V module |
| 4 | Actuator Extend | GPIO 16 | Pin 36 | 1-ch SRD-12V module |
| 4 | Actuator Retract | GPIO 17 | Pin 11 | 1-ch SRD-12V module |

> All relay channels are **active-LOW** by default (energised = GPIO LOW = solenoid unlocked / actuator driven).  
> Set `RELAY_ACTIVE_LEVEL=active_high` in `.env` to invert.

### Locker Mechanical Design (2-door system)

| Door | Name | Purpose |
|---|---|---|
| Top | `main_door` | Owner inserts item / renter retrieves item |
| Bottom | `bottom_door` | Alternative renter retrieval access |

### Actuator Control Logic

Polarity reversal via two relay channels per actuator:

| State | Extend Relay | Retract Relay | Effect |
|---|---|---|---|
| EXTEND | ON | OFF | Platform pushes item into locker |
| RETRACT | OFF | ON | Platform returns to home position |
| STOP | OFF | OFF | No movement, relays de-energised |

### GPIO Driver Change

Both `gpio_controller.py` and `actuator_controller.py` now use **lgpio directly** (no gpiozero wrapper):
- `lgpio.gpiochip_open(GPIO_CHIP)` — claim chip handle at init
- `lgpio.gpio_claim_output(handle, pin, initial)` — claim pin as output
- `lgpio.gpio_write(handle, pin, value)` — write pin state
- `lgpio.gpio_free(handle, pin)` — release pin on cleanup
- GPIO chip auto-detected by scanning `pinctrl-rp1` label (Pi 5 kernel-agnostic)

### GPIO Chip Auto-Detection

`config.py` scans up to 16 gpiochip devices looking for the one with label `pinctrl-rp1` (Pi 5 RP1 header chip). Fallback to first openable chip. Handles both pre- and post-kernel-6.6.45 Pi 5 kernels.

### Camera Assignment

| Index | Camera | Used For |
|---|---|---|
| 0 | USB cam → Locker 1 | Item capture, locker 1 |
| 1 | USB cam → Locker 2 | Item capture, locker 2 |
| 2 | USB cam → Locker 3 | Item capture, locker 3 |
| 3 | USB cam → Locker 4 | Item capture, locker 4 |
| 4 | USB cam → Face | Identity verification |

USB cameras captured via GStreamer pipeline (apt OpenCV 4.10 on Trixie — V4L2 broken, GStreamer working):
```
v4l2src device=/dev/videoX ! video/x-raw,framerate=15/1 ! videoscale !
video/x-raw,width=W,height=H ! videoconvert ! video/x-raw,format=BGR !
appsink max-buffers=1 drop=true sync=false
```

### Startup Sequence

1. Load `.env`, initialize logging (terminal + `/var/log/engirent-kiosk.log`)
2. Check WiFi → if not connected, start AP `"EngiRent-Kiosk-Setup"` (captive portal, blocks until reboot)
3. Initialize hardware (SolenoidController, ActuatorController, CameraManager)
4. Start Flask UI server on port 8080 → Chromium launches in kiosk mode on HDMI
5. Connect Socket.io client to `SERVER_URL` → emit `kiosk:register` → wait for commands

### Socket.io Protocol (Pi side)

**Emits TO backend:**

| Event | Payload |
|---|---|
| `kiosk:register` | `{ kiosk_id, locker_count: 4, version }` |
| `kiosk:status` | `{ kiosk_id, ui_state, config }` |
| `kiosk:images` | `{ kiosk_id, locker_id, image_urls, rental_id }` |
| `kiosk:face` | `{ kiosk_id, rental_id, user_id, detected, verified, confidence }` |
| `kiosk:ack` | `{ kiosk_id, command_id, action, status: "ok"/"error" }` |
| `kiosk:log` | `{ kiosk_id, level, module, message, ts }` |

**Receives FROM backend:**

| Event | Payload |
|---|---|
| `kiosk:command` | `{ action, locker_id, door, rental_id, ... }` |
| `kiosk:config` | Updated timing + solenoid pin configuration JSON |

**Supported Actions:**

`open_door`, `drop_item`, `capture_image`, `capture_face`, `lock_all`, `actuator_extend`, `actuator_retract`

### Development Mode

`MOCK_GPIO=true MOCK_CAMERA=true` — runs full kiosk simulation without physical hardware.

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
| `/kiosk` | Per-locker door status, manual door commands, actuator extend/retract, timing config |

### Kiosk Page (updated)

The `/kiosk` page now reflects the 2-door design (trapdoor fully removed):

- **Door status chips:** `Main ●` and `Bot ●` per locker (no Trap chip)
- **Manual controls:** `Open Main`, `Open Bottom`, `Extend`, `Retract` buttons
- **Timing inputs per locker:**
  - Main Door Open (seconds)
  - Bottom Door Open (seconds)
  - Actuator Extend (seconds)
  - Actuator Retract (seconds)
- **Global commands:** `Lock All Doors`, `Test Face Capture`
- **Real-time status:** SSE stream from `/admin/kiosks/events` updates locker states live

### Demo Mode

`NEXT_PUBLIC_DEMO_MODE=true` — in-memory state with sample data, all mutations mocked locally. Default in non-production environments.

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

---

## 10. Database Schema

**ORM:** Prisma 5.22 | **Database:** MySQL 8.0 (Aiven Cloud)  
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
| GET | `/admin/kiosks` | Admin JWT | List kiosks with status |
| GET | `/admin/kiosks/:id/config` | Admin JWT | Get kiosk timing config |
| PUT | `/admin/kiosks/:id/config` | Admin JWT | Update kiosk config (pushed to Pi via Socket.io) |
| GET | `/admin/kiosks/events` | Admin JWT | SSE stream for real-time kiosk status |
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
- Refresh token stored in DB enables server-side invalidation
- `POST /auth/logout` blacklists the refresh token

### Admin Authorization

- Separate admin JWT stored in `localStorage` (admin console)
- 401 responses clear admin token automatically → redirect to login

### Rate Limiting

- 100 requests per 15-minute window per IP
- Skips `/admin` routes
- In-memory (resets on restart)

---

## 13. Key Workflows

### 1. Owner Listing Flow

1. Owner uploads 3+ photos → `POST /upload/images` → Supabase Storage URLs returned
2. Owner creates listing → `POST /items` with image URLs, prices, category, condition
3. **Background job triggered:** ML service pre-extracts visual features → cached in `item.mlFeatures`

### 2. Rental Request & Payment

1. Renter books item → `POST /rentals` → status: `PENDING`
2. Owner receives `BOOKING_CONFIRMED` notification
3. Renter pays via PayMongo → `POST /payments` → webhook confirms → `POST /payments/confirm`
4. Status advances to `AWAITING_DEPOSIT`

### 3. Owner Deposits Item at Kiosk

1. Server sends `kiosk:command { action: "open_door", locker_id: X, door: "main_door" }`
2. Pi energizes solenoid relay → door unlocks for `main_door_open_seconds`
3. Owner places item inside, door auto-locks
4. Server sends `kiosk:command { action: "capture_image", locker_id: X }`
5. Pi captures frames → uploads to Supabase → emits `kiosk:images` with URLs
6. Server calls ML service: original listing images vs kiosk captures
   - **APPROVED (≥85%):** Status → `DEPOSITED`, locker locked
   - **PENDING (60–84%):** Status → `DEPOSITED` + `MANUAL_REVIEW` flag
   - **RETRY (<60%, attempt<10):** Locker reopens, owner repositions item
   - **REJECTED (10th attempt):** Rental → `CANCELLED`, renter refunded

### 4. Renter Claims Item

1. Server sends `kiosk:command { action: "capture_face", rental_id, user_id }`
2. Pi captures face → OpenCV Haar cascade detects → ML service verifies identity
3. If verified: `kiosk:command { action: "open_door", door: "main_door" }`
4. Renter takes item, door auto-locks
5. Status → `ACTIVE`, owner notified

### 5. Renter Returns Item

1. Renter goes to kiosk, places item back via `main_door`
2. Server sends `open_door` + `capture_image` + `capture_face` sequentially
3. Pi executes → emits `kiosk:images` + `kiosk:face`
4. ML service compares: original listing images vs returned item images
   - **APPROVED:** Status → `COMPLETED`, security deposit refunded, payment released to owner
   - **PENDING:** Flagged for admin manual review
   - **REJECTED:** Status → `DISPUTED`, admin investigates

### 6. Admin Review Flow

1. Admin opens `/verifications` page
2. Views confidence score breakdown (traditional, SIFT, deep learning, OCR)
3. Reviews original vs kiosk images side-by-side
4. Manually approves or rejects → `PATCH /admin/verifications/:id/review`
5. System notifies both parties

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
| Images | Supabase Storage (encrypted at rest) |
| Tokens | JWT signed with secrets (min 32 chars), stored encrypted in Flutter |
| Passwords | Bcrypt hash, never logged or exposed |

---

## 15. Deployment — Render.com

**File:** `render.yaml`  
**Region:** Singapore (closest to Philippines)

### 4 Production Services

| Service | Type | Location |
|---|---|---|
| `engirent-api` | Node.js Web | `server/node_server/` |
| `engirent-admin` | Next.js Web | `client/admin/` |
| `engirent-web` | Next.js Web | `client/web/` |
| `engirent-ml` | Docker | `server/python_server/services/ml/` |

### Production URLs

| Service | URL |
|---|---|
| API | `https://engirent-api.onrender.com` |
| Admin Console | `https://engirent-admin.onrender.com` |
| Public Website | `https://engirent-web.onrender.com` |
| ML Service | `https://engirent-ml.onrender.com` |

### engirent-api (Node.js)

- **Node version:** 20 Alpine
- **Build:** `npm install --production=false && npm run build`
- **Start:** `npm start`
- **Pre-deploy hook:** `npx prisma db push`
- **Health check:** `GET /api/v1/health`
- **Prisma:** `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]`
- **Alpine fix:** `apk add openssl` in both builder and production stages

### engirent-ml (Docker)

- **Base:** Python 3.12-slim
- **PyTorch:** CPU-only wheels from `download.pytorch.org/whl/cpu` (keeps image <200MB)
- **System libs:** `libglib2.0-0, libgl1, tesseract-ocr`
- **EXPOSE:** 8001

### Docker Compose (Local Development)

**File:** `server/node_server/docker-compose.yml`

| Service | Image | Port |
|---|---|---|
| `engirent-mysql` | MySQL 8.0 | 3306 |
| `engirent-api` | Node 20 multi-stage | 5000 |

### Kiosk Deployment (Raspberry Pi 5)

- Connects to production API via `SERVER_URL=https://engirent-api.onrender.com`
- Images uploaded directly to Supabase Storage (bypasses API server)
- Socket.io persistent WebSocket connection to backend
- Auto-start via systemd service (`engirent-kiosk.service`)
- WiFi provisioning AP on first boot if no network configured

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
| `DATABASE_URL` | Yes | — | Aiven MySQL connection string (no surrounding quotes!) |
| `JWT_SECRET` | Yes | — | Access token signing key (min 32 chars) |
| `JWT_REFRESH_SECRET` | Yes | — | Refresh token signing key (min 32 chars) |
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | Supabase admin key |
| `ML_SERVICE_URL` | No | `http://localhost:8001` | ML service endpoint |
| `CLIENT_WEB_URL` | No | — | CORS allowed origin (web) |
| `CLIENT_MOBILE_URL` | No | — | CORS allowed origin (mobile) |
| `PAYMONGO_SECRET_KEY` | Yes | — | PayMongo payments |
| `PAYMONGO_WEBHOOK_SECRET` | Yes | — | PayMongo webhook validation |

### Kiosk (`server/kiosk/.env`)

| Variable | Description |
|---|---|
| `KIOSK_ID` | Unique identifier (default: `kiosk-1`) |
| `SERVER_URL` | Backend URL (`https://engirent-api.onrender.com`) |
| `SUPABASE_URL` | For direct image uploads |
| `SUPABASE_SERVICE_ROLE_KEY` | Image upload authentication |
| `MOCK_GPIO` | `true` to disable real GPIO (development) |
| `MOCK_CAMERA` | `true` to disable real cameras (development) |
| `RELAY_ACTIVE_LEVEL` | `active_low` (default) or `active_high` |

---

## 18. Recent Changes (Post-2026-04-21)

### Commits since last analysis (most recent first)

| Date | Author | Commit | Files Changed |
|---|---|---|---|
| 2026-04-23 | adriancabil19 | `b0ead51` — 123set | `config.py`, `setup.sh` |
| 2026-04-23 | adriancabil19 | `849cf2c` — 2er21 | `config.py` |
| 2026-04-23 | adriancabil19 | `72d9be1` — 2 | `setup.sh` |
| 2026-04-23 | adriancabil19 | `5ae7ab1` — fix new | `SETUP.md`, `actuator_controller.py`, `gpio_controller.py`, `setup.sh` |
| 2026-04-23 | adriancabil19 | `2f9c99f` — new set | `setup.sh` |
| 2026-04-23 | adriancabil19 | `8de9010` — 34567 | `setup.sh` |
| 2026-04-22 | adriancabil19 | `862e53f` — jing | `node_server/tsconfig.json` |
| 2026-04-22 | adriancabil19 | `124662a` — set | `SETUP.md`, `setup.sh` |

### Summary of what changed

**`server/kiosk/config.py`** — GPIO pin map completely rewritten:
- Removed all previous pins (GPIO 17, 22, 24, 5 etc.)
- New compact sequential layout: main doors GPIO 2–5, bottom doors GPIO 6–9, actuators GPIO 10–17
- All cameras changed to USB type (no more CSI)
- GPIO chip detection logic improved: now scans by `pinctrl-rp1` label across all 16 chip numbers

**`server/kiosk/hardware/gpio_controller.py`** — Library changed from gpiozero to **lgpio direct**:
- Removed gpiozero `OutputDevice` dependency
- New `_LgpioOutput` class wraps `lgpio.gpio_claim_output` / `lgpio.gpio_write` / `lgpio.gpio_free`
- Single `lgpio` handle shared across all solenoid pins (opened at `__init__`, closed at `cleanup`)
- `reinitialize()` method removed (simplified design)

**`server/kiosk/hardware/actuator_controller.py`** — Same lgpio migration:
- Removed gpiozero `OutputDevice` dependency
- New `_LgpioRelay` class wraps lgpio calls
- Single shared `lgpio` handle
- Core polarity-reversal logic preserved (extend/retract/stop)

**`server/kiosk/SETUP.md`** — Expanded significantly (668 → ~1000+ lines):
- Updated wiring diagrams for new GPIO pins
- Added setup instructions for new relay hardware (SRD-05VDC-SL-C 4-ch boards + SRD-12VDC-SL-C 1-ch modules)

**`server/kiosk/setup.sh`** — Major expansion (automated Pi setup script):
- Now handles: package installation, venv creation, .env scaffold, systemd service, boot config fixes
- Includes `camera_auto_detect=0` fix (prevents GPIO 4 conflict)
- Chromium kiosk mode launch configuration

**`server/node_server/tsconfig.json`** — Minor fix (removed strict/redundant options)

**`client/admin/src/app/kiosk/page.tsx`** (Shem — this session):
- Removed trapdoor door: interface, DEMO_STATE, door chips, manual buttons, timing inputs
- Updated `LockerTiming` interface: removed `trapdoor_unlock_seconds`, `actuator_push_seconds`, `actuator_pull_seconds`, `actuator_speed_percent`; added `actuator_extend_seconds`, `actuator_retract_seconds`
- Door arrays changed from `["main", "trapdoor", "bottom"]` to `["main", "bottom"]`
- Timing grid changed from 6 inputs to 4 inputs per locker

---

## 19. Strengths

| Area | Detail |
|---|---|
| Complete hardware layer | Pi 5 kiosk fully implemented — lgpio GPIO, relay actuators, USB cameras, face recognition, WiFi provisioning |
| Clean architecture | Feature-based folder structure, controllers/middleware/services separation |
| End-to-end lifecycle | Full flow from listing → payment → kiosk → ML verification → completion |
| Hybrid ML pipeline | 8 complementary methods for robust fraud detection |
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

## 20. Gaps & Incomplete Items

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
| Face verify endpoint mismatch | `face_service.py` on Pi calls ML `/api/v1/verify-face` — only `/verify` and `/extract-features` defined in FastAPI |
| Admin reports use sample data | `/reports` page has hardcoded data; no real API aggregation endpoint |
| In-memory rate limiter | Resets on restart, doesn't work across multiple instances |

### Kiosk

| Gap | Detail |
|---|---|
| `kiosk_config.json` stale | Still has `actuator_speed_percent` from old design — not used by new lgpio actuator controller |
| GPIO 2 / GPIO 3 I2C conflict | BCM 2 = SDA, BCM 3 = SCL — these are I2C pins and may conflict if any I2C device is on the bus |
| Relay module driver circuit | SRD-12VDC-SL-C has 12V coil; needs on-board transistor driver to be triggered safely from 3.3V Pi GPIO |

### Deployment

| Gap | Detail |
|---|---|
| Free tier cold starts | Render free tier services sleep after 15 min inactivity — first request after idle takes 30–60s |
| Database not seeded on Render | `prisma/seed.ts` has admin credentials and locker records but seed has not been run against Aiven MySQL in production |
| Pi `.env` SERVER_URL default | Defaults to `http://localhost:5000` — must be updated to `https://engirent-api.onrender.com` on the Pi |
