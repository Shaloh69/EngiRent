# EngiRent Hub 🏫🔒

<div align="center">

![EngiRent Hub Logo](docs/assets/logo.png)

**A Smart Kiosk for Secure Student-to-Student Item Rentals**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.9+-blue.svg)](https://python.org/)
[![Flutter](https://img.shields.io/badge/Flutter-3.16+-02569B.svg)](https://flutter.dev/)
[![Next.js](https://img.shields.io/badge/Next.js-14+-black.svg)](https://nextjs.org/)

[Features](#features) • [Architecture](#architecture) • [Installation](#installation) • [Documentation](#documentation) • [Contributing](#contributing)

</div>

---

## 📖 Table of Contents

- [Overview](#overview)
- [Problem Statement](#problem-statement)
- [Solution](#solution)
- [Features](#features)
- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [API Documentation](#api-documentation)
- [Hardware Setup](#hardware-setup)
- [ML Model Training](#ml-model-training)
- [Testing](#testing)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)
- [Team](#team)
- [Acknowledgments](#acknowledgments)

---

## 🎯 Overview

**EngiRent Hub** is an innovative IoT-powered smart kiosk system designed to revolutionize student-to-student item rentals at the University of Cebu Lapu-Lapu and Mandaue (UCLM), College of Engineering. The platform combines web/mobile applications with physical automated lockers to provide a secure, convenient, and fully automated rental experience.

### 🎓 Academic Context

- **Institution**: University of Cebu Lapu-Lapu and Mandaue (UCLM)
- **Department**: College of Engineering
- **Program**: Bachelor of Science in Computer Engineering
- **Thesis Year**: 2025
- **Thesis Adviser**: Engr. Diego V. Abad Jr.

---

## 🚨 Problem Statement

Engineering students face significant challenges in accessing essential items:

1. **High Costs**: Expensive tools and equipment (laptops, tablets, scientific calculators, engineering drawing sets, oscilloscopes) that are only needed temporarily or for specific courses
2. **Uniform Requirements**: Lab gowns required for laboratory sessions, PE uniforms for physical education, school uniforms for special events - all purchased for limited use
3. **Project-Based Needs**: Arduino boards, Raspberry Pi kits, breadboards, and sensors needed only during project development periods
4. **Measurement Equipment**: Multimeters, calipers, and specialized tools that not all students can afford to purchase
5. **Electronics & Accessories**: Power banks, chargers, USB drives, headphones needed for daily academic activities
6. **Audio/Visual Equipment**: Cameras for documentation, presentation equipment for project defenses
7. **Informal Borrowing Risks**: Current peer-to-peer lending lacks security, accountability, and proper tracking
8. **Inconvenient Coordination**: Students must arrange face-to-face meetups, coordinate schedules, and rely on trust
9. **Safety Concerns**: Risk of scams, fraud, unreturned items, and disputes over item condition
10. **Limited Access**: Not all students can afford specialized equipment needed for specific courses or projects

### Survey Results (31 Engineering Students)

- **77.4%** need lab gowns for rental
- **74.2%** need scientific calculators
- **71.0%** need power banks/chargers
- **64.5%** need engineering drawing tools
- **38.7%** need laptops/tablets for academic use
- **35.5%** need Arduino/Raspberry Pi kits
- **35.5%** borrow items "sometimes"
- **32.3%** borrow items "rarely"
- **3.328/4.0** overall system acceptance score (Strongly Agree)

---

## ✨ Solution

EngiRent Hub provides a **secure, automated, and cashless** rental platform that:

### Core Value Propositions

1. **Zero Human Interaction**: Fully automated from listing to return
2. **Multi-Layer Security**: QR codes + facial recognition + AI item verification
3. **Cashless Transactions**: GCash payment with escrow protection
4. **Automated Accountability**: Built-in late fees, damage penalties, and rating system
5. **24/7 Availability**: Kiosk accessible anytime without supervision
6. **Smart Notifications**: Automated reminders for pickup, return, and deadlines
7. **AI-Powered Verification**: Prevents fraud by verifying items with computer vision

---

## 🎯 Features

### For Item Owners (Lenders)

- ✅ **List Items**: Upload photos, set prices, define availability schedules
- ✅ **Rental Approvals**: Accept or reject rental requests with renter profiles
- ✅ **Secure Deposit**: QR + facial authentication to deposit items in kiosks
- ✅ **Payment Protection**: Escrow system releases payment only after AI verification
- ✅ **Return Notifications**: Get alerts when items are returned
- ✅ **Damage Compensation**: Automatic penalties for damaged/missing items
- ✅ **Rating System**: Rate renters based on behavior and item care

### For Renters (Borrowers)

- ✅ **Browse Marketplace**: Filter items by category, price, ratings, availability
  - **School Attire**: Lab gowns, school uniforms, PE uniforms
  - **Academic Tools**: Scientific calculators, engineering drawing sets, periodic tables
  - **Electronics**: Laptops, tablets, power banks, chargers, USB drives
  - **Development Kits**: Arduino boards, Raspberry Pi kits, breadboards
  - **Measurement Tools**: Multimeters, oscilloscopes, calipers
  - **Audio/Visual**: Headphones, cameras, projectors
  - **Sports Equipment**: Items needed for PE classes
- ✅ **Request Rentals**: Choose duration, review costs, agree to terms
- ✅ **GCash Payment**: Secure cashless payment held in escrow
- ✅ **Automated Pickup**: Scan QR + face recognition to claim items from kiosk
- ✅ **Return Reminders**: Automated notifications before deadline
- ✅ **Late Fee Transparency**: Clear visibility of penalties before rental
- ✅ **In-App Chat**: Direct communication with owners during rental period

### For Administrators

- ✅ **Dashboard Analytics**: Usage statistics, popular items, transaction logs
- ✅ **Dispute Resolution**: Manual review of AI verification failures
- ✅ **User Management**: Account verification, flagging, suspension
- ✅ **System Monitoring**: Real-time kiosk status, locker availability
- ✅ **Financial Reports**: Payment tracking, revenue analytics, refund logs

### System Features

- 🔐 **Dual Biometric Authentication**: QR code scanning + facial recognition
- 🤖 **AI Item Verification**: YOLOv8-powered image recognition (up to 10 retry attempts)
- 🔔 **Smart Notifications**: Email/SMS/push notifications at critical stages
- 📦 **Automated Locker Management**: Solenoid locks controlled by microcontrollers
- 🚚 **Conveyor System**: Auto-moves unclaimed items to storage after 1 hour
- 💰 **Escrow Payment System**: GCash integration with secure fund holding
- ⏰ **Late Fee Automation**: Configurable penalties per hour/day overdue
- 🛡️ **Damage Detection**: AI compares item condition before/after rental
- 📊 **Transaction Logging**: Complete audit trail of all activities
- 🔒 **Data Encryption**: TLS/SSL for communication, encrypted face data storage

---

## 🏗️ System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       ENGIRENT HUB ECOSYSTEM                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐  │
│  │   Next.js    │◄────►│   Node.js    │◄────►│    MySQL     │  │
│  │   Web App    │      │   Backend    │      │   Database   │  │
│  └──────────────┘      └──────────────┘      └──────────────┘  │
│         │                      │                      ▲          │
│         │                      │                      │          │
│  ┌──────────────┐              │                      │          │
│  │   Flutter    │◄─────────────┘                      │          │
│  │  Mobile App  │                                     │          │
│  └──────────────┘                                     │          │
│         │                                             │          │
│         │                                             │          │
│         ▼                                             │          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              SMART KIOSK HARDWARE LAYER              │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │  • Raspberry Pi 4 (Main Controller)                     │   │
│  │  • ESP32 (Locker Controllers)                            │   │
│  │  • Touchscreen Display (React UI)                        │   │
│  │  • QR Code Scanner                                       │   │
│  │  • Facial Recognition Camera                             │   │
│  │  • AI Item Cameras (per locker)                          │   │
│  │  • Solenoid Locks                                        │   │
│  │  • Stepper Motor (Conveyor)                              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │           PYTHON ML SERVICE (YOLOv8)                    │   │
│  │  • Object Detection                                      │   │
│  │  • Feature Extraction                                    │   │
│  │  • Similarity Matching                                   │   │
│  │  • Confidence Scoring                                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

### Component Communication Flow

```
User (Web/Mobile) → Next.js/Flutter → Node.js API → MySQL Database
                                      ↓
                                  Raspberry Pi Controller
                                      ↓
                           ┌──────────┴──────────┐
                           │                     │
                    ESP32 Controllers      Python ML Service
                           │                     │
                    Solenoid Locks        YOLOv8 Verification
                    QR Scanner              Image Processing
                    Face Camera
```

---

## 🛠️ Tech Stack

### Frontend

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Next.js** | 14.x | Web application (SSR, API routes) |
| **React** | 18.x | UI components, kiosk touchscreen |
| **Flutter** | 3.16+ | Cross-platform mobile app (iOS/Android) |
| **TypeScript** | 5.x | Type-safe development |
| **Tailwind CSS** | 3.x | Utility-first styling |
| **Zustand** | 4.x | State management |
| **React Query** | 5.x | Server state management |
| **Socket.io Client** | 4.x | Real-time updates |

### Backend

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Node.js** | 18.x LTS | Runtime environment |
| **Express.js** | 4.x | REST API framework |
| **MySQL** | 8.x | Relational database |
| **Prisma** | 5.x | ORM and database migrations |
| **Socket.io** | 4.x | WebSocket server for real-time communication |
| **JWT** | 9.x | Authentication tokens |
| **Bcrypt** | 5.x | Password hashing |
| **Multer** | 1.x | File upload handling |
| **AWS SDK** | 3.x | S3 for image storage |

### AI/ML Service

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Python** | 3.9+ | ML runtime |
| **YOLOv8** | Latest | Object detection model |
| **OpenCV** | 4.x | Image processing |
| **NumPy** | 1.24+ | Numerical operations |
| **Pillow** | 10.x | Image manipulation |
| **FastAPI** | 0.104+ | ML service API |
| **TensorFlow** | 2.14+ | Deep learning (optional) |
| **scikit-learn** | 1.3+ | ML utilities |

### Hardware/IoT

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Raspberry Pi OS** | Bullseye | Operating system |
| **Python** | 3.9+ | Hardware control scripts |
| **Flask** | 3.x | Hardware API server |
| **GPIO** | RPi.GPIO | Pin control |
| **ESP32** | IDF 5.x | Locker microcontrollers |
| **Arduino IDE** | 2.x | ESP32 programming |
| **MQTT** | 5.x | IoT messaging protocol |

### Payment Integration

| Technology | Version | Purpose |
|-----------|---------|---------|
| **GCash API** | Latest | Payment processing |
| **Xendit** | 2.x | Payment gateway SDK (alternative) |

### DevOps & Deployment

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Docker** | 24.x | Containerization |
| **Docker Compose** | 2.x | Multi-container orchestration |
| **Nginx** | 1.24+ | Reverse proxy |
| **PM2** | 5.x | Node.js process manager |
| **GitHub Actions** | - | CI/CD pipelines |
| **AWS EC2** | - | Cloud hosting |
| **Cloudflare** | - | CDN and DDoS protection |

### Development Tools

| Tool | Purpose |
|------|---------|
| **Git** | Version control |
| **ESLint** | JavaScript linting |
| **Prettier** | Code formatting |
| **Postman** | API testing |
| **VS Code** | IDE |
| **Fritzing** | Circuit diagrams |

---

## 📁 Project Structure

```
engirent-hub/
├── 📱 apps/
│   ├── mobile/                    # Flutter mobile app
│   │   ├── android/
│   │   ├── ios/
│   │   ├── lib/
│   │   │   ├── main.dart
│   │   │   ├── screens/
│   │   │   ├── widgets/
│   │   │   ├── services/
│   │   │   ├── models/
│   │   │   └── utils/
│   │   ├── assets/
│   │   ├── pubspec.yaml
│   │   └── README.md
│   │
│   ├── web/                       # Next.js web app
│   │   ├── public/
│   │   ├── src/
│   │   │   ├── app/               # App router (Next.js 14)
│   │   │   ├── components/
│   │   │   ├── lib/
│   │   │   ├── hooks/
│   │   │   ├── store/             # Zustand stores
│   │   │   └── styles/
│   │   ├── next.config.js
│   │   ├── package.json
│   │   └── README.md
│   │
│   └── kiosk/                     # Kiosk touchscreen UI (React)
│       ├── src/
│       │   ├── App.tsx
│       │   ├── screens/
│       │   ├── components/
│       │   └── utils/
│       ├── package.json
│       └── README.md
│
├── 🖥️ backend/                    # Node.js backend
│   ├── src/
│   │   ├── config/               # Configuration files
│   │   ├── controllers/          # Request handlers
│   │   ├── middleware/           # Express middleware
│   │   ├── models/               # Database models (Prisma)
│   │   ├── routes/               # API routes
│   │   ├── services/             # Business logic
│   │   ├── utils/                # Helper functions
│   │   ├── validators/           # Request validation
│   │   └── app.ts                # Express app setup
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── tests/
│   ├── package.json
│   └── README.md
│
├── 🤖 ml-service/                 # Python ML service
│   ├── src/
│   │   ├── main.py               # FastAPI server
│   │   ├── models/               # YOLOv8 model files
│   │   ├── services/
│   │   │   ├── detection.py
│   │   │   ├── verification.py
│   │   │   └── training.py
│   │   ├── utils/
│   │   │   ├── image_processing.py
│   │   │   └── feature_extraction.py
│   │   └── config.py
│   ├── datasets/                 # Training datasets
│   ├── tests/
│   ├── requirements.txt
│   └── README.md
│
├── 🔌 hardware/                   # Raspberry Pi & ESP32 scripts
│   ├── raspberry-pi/
│   │   ├── main.py               # Main controller
│   │   ├── locker_controller.py
│   │   ├── qr_scanner.py
│   │   ├── face_recognition.py
│   │   ├── conveyor_controller.py
│   │   ├── api_server.py         # Flask API
│   │   ├── requirements.txt
│   │   └── README.md
│   │
│   └── esp32/
│       ├── locker_firmware/      # Arduino sketch
│       │   ├── locker_firmware.ino
│       │   ├── mqtt_client.cpp
│       │   └── config.h
│       ├── schematics/           # Circuit diagrams
│       └── README.md
│
├── 📚 docs/                       # Documentation
│   ├── api/                      # API documentation
│   ├── architecture/             # System design docs
│   ├── hardware/                 # Hardware setup guides
│   ├── user-guides/              # User manuals
│   └── assets/                   # Images, diagrams
│
├── 🧪 tests/                      # Integration tests
│   ├── e2e/
│   └── integration/
│
├── 🐳 docker/                     # Docker configurations
│   ├── backend.Dockerfile
│   ├── ml-service.Dockerfile
│   ├── web.Dockerfile
│   └── nginx.conf
│
├── 🔧 scripts/                    # Utility scripts
│   ├── setup.sh
│   ├── deploy.sh
│   ├── seed-db.js
│   └── backup.sh
│
├── .github/
│   └── workflows/                # CI/CD pipelines
│       ├── backend-tests.yml
│       ├── deploy.yml
│       └── ml-tests.yml
│
├── docker-compose.yml            # Multi-container setup
├── .gitignore
├── LICENSE
└── README.md                     # This file
```

---

## ✅ Prerequisites

Before you begin, ensure you have the following installed:

### Software Requirements

- **Node.js**: v18.x or higher ([Download](https://nodejs.org/))
- **Python**: 3.9 or higher ([Download](https://python.org/))
- **MySQL**: 8.0 or higher ([Download](https://mysql.com/))
- **Flutter**: 3.16 or higher ([Install Guide](https://flutter.dev/docs/get-started/install))
- **Docker** (optional but recommended): Latest version ([Download](https://docker.com/))
- **Git**: Latest version ([Download](https://git-scm.com/))

### Hardware Requirements (for full kiosk setup)

- **Raspberry Pi 4** (4GB+ RAM recommended)
- **ESP32 Development Boards** (quantity depends on locker count)
- **Touchscreen Display** (10-15" capacitive)
- **USB Webcam** (for facial recognition)
- **Small Cameras** (for item verification, 1 per locker)
- **QR Code Scanner Module**
- **12V Solenoid Locks** (1 per locker compartment)
- **Stepper Motor** (for conveyor system)
- **Power Supply** (5V for Raspberry Pi, 12V for locks)
- **Relay Modules** (for lock control)
- **Jumper Wires, Breadboard, etc.**

### Accounts & API Keys

- **GCash Business Account** (for payment processing)
- **AWS Account** (for S3 image storage) or alternative cloud storage
- **SendGrid/Mailgun** (for email notifications)
- **Twilio** (optional, for SMS notifications)

---

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/engirent-hub.git
cd engirent-hub
```

### 2. Install Backend Dependencies

```bash
cd backend
npm install
```

Create `.env` file in `backend/`:

```env
# Database
DATABASE_URL="mysql://user:password@localhost:3306/engirent_hub"

# JWT
JWT_SECRET="your-super-secret-jwt-key-change-this"
JWT_EXPIRES_IN="7d"

# AWS S3
AWS_ACCESS_KEY_ID="your-aws-access-key"
AWS_SECRET_ACCESS_KEY="your-aws-secret-key"
AWS_REGION="ap-southeast-1"
AWS_S3_BUCKET="engirent-hub-images"

# GCash API
GCASH_API_KEY="your-gcash-api-key"
GCASH_API_SECRET="your-gcash-secret"
GCASH_MERCHANT_ID="your-merchant-id"

# Email
SENDGRID_API_KEY="your-sendgrid-api-key"
FROM_EMAIL="noreply@engirenthub.com"

# Server
PORT=5000
NODE_ENV="development"

# ML Service
ML_SERVICE_URL="http://localhost:8000"

# Hardware
RASPBERRY_PI_URL="http://192.168.1.100:5001"
```

Run database migrations:

```bash
npx prisma migrate dev
npx prisma generate
```

Seed database (optional):

```bash
node scripts/seed-db.js
```

### 3. Install ML Service Dependencies

```bash
cd ../ml-service
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create `.env` file in `ml-service/`:

```env
MODEL_PATH="./src/models/yolov8n.pt"
CONFIDENCE_THRESHOLD=0.85
MAX_RETRY_ATTEMPTS=10
IMAGE_SIZE=640
```

Download YOLOv8 model:

```bash
cd src/models
wget https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.pt
```

### 4. Install Web App Dependencies

```bash
cd ../../apps/web
npm install
```

Create `.env.local`:

```env
NEXT_PUBLIC_API_URL="http://localhost:5000/api"
NEXT_PUBLIC_SOCKET_URL="http://localhost:5000"
NEXT_PUBLIC_GCASH_PUBLIC_KEY="your-public-key"
```

### 5. Install Mobile App Dependencies

```bash
cd ../mobile
flutter pub get
```

Create `lib/config/env.dart`:

```dart
class Environment {
  static const String apiUrl = 'http://localhost:5000/api';
  static const String socketUrl = 'http://localhost:5000';
  static const String gcashPublicKey = 'your-public-key';
}
```

### 6. Setup Raspberry Pi (Hardware)

SSH into Raspberry Pi:

```bash
ssh pi@raspberrypi.local
```

Install dependencies:

```bash
sudo apt update
sudo apt install python3-pip python3-opencv
cd ~/engirent-hub/hardware/raspberry-pi
pip3 install -r requirements.txt
```

Create `config.py`:

```python
API_URL = "http://your-backend-url.com/api"
API_KEY = "your-hardware-api-key"
MQTT_BROKER = "localhost"
MQTT_PORT = 1883
```

### 7. Flash ESP32 Firmware

Open `hardware/esp32/locker_firmware/locker_firmware.ino` in Arduino IDE.

Configure WiFi and MQTT in `config.h`:

```cpp
const char* ssid = "YourWiFiSSID";
const char* password = "YourWiFiPassword";
const char* mqtt_server = "raspberrypi.local";
```

Upload to each ESP32 board.

---

## ⚙️ Configuration

### Database Schema

The system uses MySQL with Prisma ORM. Key tables:

- **users**: Student accounts (email, password, face_data, parent_info)
- **items**: Listed rental items (owner_id, name, price, category, images)
- **rentals**: Rental transactions (item_id, renter_id, start_date, end_date, status)
- **transactions**: Payment records (rental_id, amount, gcash_reference, status)
- **notifications**: User notifications (user_id, type, message, read_status)
- **lockers**: Physical locker info (locker_number, size, status, current_item_id)
- **verifications**: AI verification logs (rental_id, confidence_score, images)

See `backend/prisma/schema.prisma` for full schema.

### API Endpoints

Main routes:

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `GET /api/items` - Browse available items
- `POST /api/items` - List new item (owner)
- `POST /api/rentals` - Request rental
- `POST /api/payments/gcash` - Process GCash payment
- `POST /api/kiosk/deposit` - Deposit item at kiosk
- `POST /api/kiosk/claim` - Claim item from kiosk
- `POST /api/kiosk/return` - Return item to kiosk
- `POST /api/ml/verify` - AI item verification
- `GET /api/notifications` - Get user notifications

Full API documentation: [docs/api/README.md](docs/api/README.md)

---

## 🏃 Running the Application

### Development Mode (Separate Terminals)

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```
Runs on `http://localhost:5000`

**Terminal 2 - ML Service:**
```bash
cd ml-service
source venv/bin/activate
uvicorn src.main:app --reload --port 8000
```
Runs on `http://localhost:8000`

**Terminal 3 - Web App:**
```bash
cd apps/web
npm run dev
```
Runs on `http://localhost:3000`

**Terminal 4 - Mobile App:**
```bash
cd apps/mobile
flutter run
```
Opens in emulator/connected device

**Terminal 5 - Raspberry Pi (SSH):**
```bash
cd ~/engirent-hub/hardware/raspberry-pi
python3 main.py
```

### Production Mode (Docker Compose)

```bash
docker-compose up -d
```

Services:
- Web: `http://localhost:3000`
- Backend: `http://localhost:5000`
- ML Service: `http://localhost:8000`
- MySQL: `localhost:3306`
- Nginx (reverse proxy): `http://localhost:80`

Stop services:
```bash
docker-compose down
```

---

## 📡 API Documentation

### Authentication

All protected endpoints require JWT token in header:
```
Authorization: Bearer <token>
```

### Example: Request Rental

**Endpoint:** `POST /api/rentals`

**Request Body:**
```json
{
  "item_id": "uuid-of-item",
  "start_date": "2025-02-10T09:00:00Z",
  "end_date": "2025-02-12T17:00:00Z",
  "duration_hours": 56,
  "rental_cost": 150.00
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "rental_id": "uuid-of-rental",
    "status": "PENDING_APPROVAL",
    "owner_notified": true,
    "message": "Rental request sent to owner"
  }
}
```

Full API docs with Postman collection: [docs/api/](docs/api/)

---

## 🔌 Hardware Setup

### Raspberry Pi Wiring

**GPIO Pin Assignments:**

| Component | GPIO Pin | Notes |
|-----------|----------|-------|
| QR Scanner (USB) | USB Port | Auto-detected |
| Face Camera (USB) | USB Port | Auto-detected |
| Touchscreen | HDMI + USB | Touch via USB |
| ESP32 Communication | UART (GPIO 14/15) | Serial |
| Conveyor Motor (via driver) | GPIO 17, 18, 27, 22 | Stepper motor pins |
| Emergency Button | GPIO 23 | Pull-up resistor |

**ESP32 (per locker):**

| Component | ESP32 Pin | Notes |
|-----------|-----------|-------|
| Solenoid Lock (+) | GPIO 5 via Relay | 12V supply |
| Solenoid Lock (-) | GND via Relay | Common ground |
| Camera Trigger | GPIO 18 | TTL signal |
| Status LED | GPIO 2 | Built-in LED |

### Hardware Assembly Guide

See detailed guide: [docs/hardware/ASSEMBLY.md](docs/hardware/ASSEMBLY.md)

Includes:
- Circuit diagrams (Fritzing)
- 3D-printed enclosure files
- Power supply calculations
- Safety considerations

---

## 🤖 ML Model Training

### Dataset Preparation

1. **Collect Images**: Photograph each item category from multiple angles (minimum 100 images per category)

2. **Organize Dataset**:
```
ml-service/datasets/
├── train/
│   ├── lab_gown/
│   ├── calculator/
│   ├── drawing_tools/
│   └── power_bank/
└── val/
    ├── lab_gown/
    ├── calculator/
    ├── drawing_tools/
    └── power_bank/
```

3. **Preprocess Images**:
```bash
cd ml-service
python src/services/training.py --preprocess --input datasets/raw --output datasets/processed
```

### Train YOLOv8 Model

```bash
python src/services/training.py --train \
  --data datasets/data.yaml \
  --epochs 100 \
  --batch-size 16 \
  --img-size 640 \
  --weights yolov8n.pt
```

Training results saved to `ml-service/runs/train/`

### Evaluate Model

```bash
python src/services/training.py --eval \
  --model runs/train/exp/weights/best.pt \
  --data datasets/data.yaml
```

### Deploy Trained Model

Replace `ml-service/src/models/yolov8n.pt` with your trained model:

```bash
cp runs/train/exp/weights/best.pt src/models/yolov8_custom.pt
```

Update `.env`:
```env
MODEL_PATH="./src/models/yolov8_custom.pt"
```

Detailed training guide: [docs/ml/TRAINING.md](docs/ml/TRAINING.md)

---

## 🧪 Testing

### Backend Tests

```bash
cd backend
npm test                    # Run all tests
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests
npm run test:coverage      # Generate coverage report
```

### ML Service Tests

```bash
cd ml-service
pytest tests/              # Run all tests
pytest tests/test_verification.py  # Specific test
pytest --cov=src tests/    # With coverage
```

### End-to-End Tests

```bash
cd tests/e2e
npm install
npx playwright test        # Run E2E tests
```

### Mobile App Tests

```bash
cd apps/mobile
flutter test              # Unit tests
flutter test integration_test/  # Integration tests
```

---

## 🚢 Deployment

### Production Checklist

- [ ] Update all `.env` files with production values
- [ ] Change JWT secrets to strong random strings
- [ ] Enable HTTPS with SSL certificates (Let's Encrypt)
- [ ] Configure firewall rules (allow only 80, 443, SSH)
- [ ] Set up database backups (daily automated)
- [ ] Configure log rotation
- [ ] Set up monitoring (PM2, CloudWatch, etc.)
- [ ] Test payment integration in production
- [ ] Verify email/SMS notifications
- [ ] Test hardware connectivity
- [ ] Enable rate limiting on API
- [ ] Configure CORS for production domains
- [ ] Run security audit (`npm audit`, `snyk`)

### Deploy to AWS EC2

1. **Launch EC2 Instance** (Ubuntu 22.04 LTS, t3.medium or higher)

2. **Install Docker & Docker Compose**:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

3. **Clone Repository**:
```bash
git clone https://github.com/your-username/engirent-hub.git
cd engirent-hub
```

4. **Configure Environment**:
```bash
cp .env.example .env
nano .env  # Edit with production values
```

5. **Build & Deploy**:
```bash
docker-compose -f docker-compose.prod.yml up -d --build
```

6. **Setup Nginx Reverse Proxy**:
```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo certbot --nginx -d engirenthub.com -d www.engirenthub.com
```

7. **Monitor Logs**:
```bash
docker-compose logs -f backend
docker-compose logs -f ml-service
```

### Continuous Deployment (GitHub Actions)

Push to `main` branch triggers automatic deployment:

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to EC2
        run: |
          ssh ${{ secrets.EC2_USER }}@${{ secrets.EC2_HOST }} \
          'cd /var/www/engirent-hub && git pull && docker-compose up -d --build'
```

Full deployment guide: [docs/deployment/PRODUCTION.md](docs/deployment/PRODUCTION.md)

---

## 🤝 Contributing

We welcome contributions from the community! Here's how you can help:

### Development Workflow

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes**
4. **Write tests** for new features
5. **Commit your changes**: `git commit -m 'Add amazing feature'`
6. **Push to branch**: `git push origin feature/amazing-feature`
7. **Open a Pull Request**

### Code Style

- **JavaScript/TypeScript**: Follow Airbnb style guide, enforced by ESLint
- **Python**: Follow PEP 8, enforced by Black formatter
- **Flutter/Dart**: Follow official Dart style guide

### Commit Message Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add user profile page
fix: resolve payment escrow bug
docs: update API documentation
chore: upgrade dependencies
```

### Reporting Bugs

Open an issue on GitHub with:
- Clear description
- Steps to reproduce
- Expected vs actual behavior
- Screenshots (if applicable)
- Environment details (OS, browser, versions)

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2025 EngiRent Hub Development Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
```

---

## 👥 Team

### Developers

| Name | Role | GitHub | Email |
|------|------|--------|-------|
| **Ian M. Luna** | Full-Stack Developer | [@ianluna](https://github.com/ianluna) | ian.luna@uclm.edu.ph |
| **Mc Jerrel M. Abala** | Hardware Engineer | [@mcjerrel](https://github.com/mcjerrel) | mcjerrel.abala@uclm.edu.ph |
| **Allan John D. Mondejar** | ML Engineer | [@allanmondejar](https://github.com/allanmondejar) | allan.mondejar@uclm.edu.ph |

### Academic Supervision

- **Thesis Adviser**: Engr. Diego V. Abad Jr.
- **Department**: College of Engineering, UCLM
- **Institution**: University of Cebu Lapu-Lapu and Mandaue

---

## 🙏 Acknowledgments

We would like to express our gratitude to:

- **Engr. Diego V. Abad Jr.** - For guidance and mentorship throughout this thesis project
- **Dr. Roland B. Fernandez** - Dean of College of Engineering, for project endorsement
- **UCLM Engineering Students** - For participating in surveys and providing feedback
- **UCLM Administration** - For allowing kiosk deployment on campus
- **Open Source Community** - For the amazing tools and libraries used in this project

### Technologies & Frameworks

Special thanks to the teams behind:
- [Next.js](https://nextjs.org/) - React framework
- [Flutter](https://flutter.dev/) - Mobile framework
- [Node.js](https://nodejs.org/) - JavaScript runtime
- [YOLOv8](https://github.com/ultralytics/ultralytics) - Object detection model
- [Raspberry Pi Foundation](https://www.raspberrypi.org/) - Single-board computers
- [Prisma](https://www.prisma.io/) - Database ORM

---

## 📞 Support & Contact

### Issues & Bug Reports
- GitHub Issues: [https://github.com/your-username/engirent-hub/issues](https://github.com/your-username/engirent-hub/issues)

### Documentation
- Full Documentation: [docs/](docs/)
- API Reference: [docs/api/](docs/api/)
- User Guide: [docs/user-guides/](docs/user-guides/)

### Community
- Discord Server: [Join our Discord](https://discord.gg/engirenthub)
- Email: support@engirenthub.com

---

## 🗺️ Roadmap

### Phase 1: MVP ✅ (Completed)
- [x] User authentication system
- [x] Item listing and browsing
- [x] Rental request workflow
- [x] GCash payment integration
- [x] Basic kiosk hardware setup
- [x] QR + facial recognition
- [x] AI item verification (YOLOv8)

### Phase 2: Campus Deployment 🚀 (In Progress)
- [ ] Deploy kiosk at UCLM Engineering Department (9th Floor)
- [ ] Beta testing with 50 users
- [ ] Performance monitoring and optimization
- [ ] User feedback collection
- [ ] Bug fixes and improvements

### Phase 3: Feature Expansion 🔮 (Planned)
- [ ] Mobile app release (iOS/Android)
- [ ] In-app chat with file sharing
- [ ] Rating and review system
- [ ] Push notifications
- [ ] Admin dashboard analytics
- [ ] Multi-locker support (10+ compartments)

### Phase 4: Scale & Growth 🌟 (Future)
- [ ] Expand to other UCLM departments
- [ ] Integration with student ID cards (NFC)
- [ ] Blockchain transaction logging
- [ ] Insurance/damage protection plans
- [ ] Network across multiple UC campuses
- [ ] AI-powered price recommendations
- [ ] Sustainability impact metrics

---

## 📊 Project Status

[![Build Status](https://github.com/your-username/engirent-hub/workflows/CI/badge.svg)](https://github.com/your-username/engirent-hub/actions)
[![Coverage](https://codecov.io/gh/your-username/engirent-hub/branch/main/graph/badge.svg)](https://codecov.io/gh/your-username/engirent-hub)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Current Version**: v1.0.0-beta  
**Last Updated**: February 2025  
**Status**: Active Development

---

<div align="center">

**Built with ❤️ by the EngiRent Hub Team**

[Website](https://engirenthub.com) • [Documentation](docs/) • [Report Bug](https://github.com/your-username/engirent-hub/issues) • [Request Feature](https://github.com/your-username/engirent-hub/issues)

</div>
