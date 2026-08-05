# EngiRent Hub: Complete System Analysis & Process Flow

> ⚠️ **Partially superseded.** The process-flow diagrams here are still useful, but this document
> predates implementation and names **YOLOv8** (real system: 8-stage hybrid CV — see
> `AI_SYSTEM_DOCUMENTATION.md`), **GCash API** (real: PayMongo), and **AWS S3** (real: Supabase
> Storage). It also assumes an escrow "payment released to owner" step that is **not implemented**
> in code (see `AUDIT.md`, findings C4/H1). Treat the flows as intent, `analyzation.md` as reality.

## Executive Summary

**EngiRent Hub** is a Smart Kiosk system for secure student-to-student item rentals at the University of Cebu Lapu-Lapu and Mandaue (UCLM), College of Engineering. The system automates the borrowing/lending process through IoT-enabled lockers, biometric authentication (QR codes + facial recognition), AI-powered item verification, automated notifications, and cashless GCash payments.

---

## 1. COMPLETE PROCESS FLOW DIAGRAMS

### 1.1 HIGH-LEVEL SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────┐
│                    ENGIRENT HUB ECOSYSTEM                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐      ┌───────────┐ │
│  │   Web/Mobile │◄────►│   Backend    │◄────►│  Database │ │
│  │     App      │      │    Server    │      │  (MySQL)  │ │
│  └──────────────┘      └──────────────┘      └───────────┘ │
│         │                      │                             │
│         │                      │                             │
│         ▼                      ▼                             │
│  ┌──────────────────────────────────────────────────┐       │
│  │           SMART KIOSK HARDWARE                   │       │
│  ├──────────────────────────────────────────────────┤       │
│  │  • Touchscreen Interface                         │       │
│  │  • QR Code Scanner                               │       │
│  │  • Facial Recognition Camera (Front)             │       │
│  │  • AI Item Verification Camera (Inside Lockers)  │       │
│  │  • Solenoid Locks (Per Compartment)              │       │
│  │  • Conveyor System (Unclaimed Items Storage)     │       │
│  │  • ESP32/Raspberry Pi Controllers                │       │
│  └──────────────────────────────────────────────────┘       │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

### 1.2 DETAILED PROCESS FLOW: OWNER LISTING ITEM

```
START (Owner wants to list an item)
  │
  ├─► 1. LOGIN/REGISTER
  │     │
  │     ├─► Enter institutional email & password
  │     ├─► System verifies credentials
  │     └─► Access Dashboard
  │
  ├─► 2. LIST NEW ITEM
  │     │
  │     ├─► Upload item photos (multiple angles)
  │     ├─► Enter item details:
  │     │     • Item name
  │     │     • Category (Lab Gown, Calculator, Drawing Tools, etc.)
  │     │     • Rental price (per hour/day)
  │     │     • Availability schedule
  │     │     • Condition notes
  │     │     • Deposit required (if any)
  │     │
  │     ├─► System processes images for AI training
  │     └─► Item listed as "AVAILABLE"
  │
  └─► 3. WAIT FOR RENTAL REQUEST
        │
        └─► Notification received when renter requests item
              │
              ├─► Review renter profile
              ├─► Approve or Reject request
              │
              └─► If APPROVED:
                    │
                    ├─► 4. DEPOSIT ITEM AT KIOSK
                    │     │
                    │     ├─► Go to physical kiosk location
                    │     ├─► Scan QR code on touchscreen
                    │     ├─► Perform facial recognition
                    │     ├─► System assigns locker compartment
                    │     ├─► Locker opens automatically
                    │     │
                    │     ├─► Place item inside compartment
                    │     │
                    │     ├─► AI Camera verifies item
                    │     │     │
                    │     │     ├─► Match? → Payment released to owner
                    │     │     │            Notification sent to renter
                    │     │     │
                    │     │     └─► No match? → Retry (up to 10 attempts)
                    │     │                      If all fail → Transaction cancelled
                    │     │                                     Renter refunded
                    │     │
                    │     └─► Close locker door
                    │
                    └─► 5. TRACK RENTAL PERIOD
                          │
                          ├─► Receive notifications:
                          │     • Item claimed by renter
                          │     • Return deadline approaching
                          │     • Item returned
                          │
                          └─► 6. RETRIEVE RETURNED ITEM
                                │
                                ├─► Go to kiosk when notified
                                ├─► Scan QR + facial recognition
                                ├─► Retrieve item from compartment
                                ├─► Review item condition
                                │
                                └─► Transaction complete
                                      │
                                      └─► Rate renter (optional)

END
```

---

### 1.3 DETAILED PROCESS FLOW: RENTER BORROWING ITEM

```
START (Renter needs an item)
  │
  ├─► 1. LOGIN/REGISTER
  │     │
  │     ├─► Enter institutional email & password
  │     ├─► Provide parent/guardian information
  │     ├─► Upload student ID photo
  │     ├─► Enroll facial recognition
  │     └─► Access Dashboard
  │
  ├─► 2. BROWSE AVAILABLE ITEMS
  │     │
  │     ├─► Filter by category:
  │     │     • Lab Gowns
  │     │     • Scientific Calculators
  │     │     • Engineering Drawing Tools
  │     │     • Power Banks/Chargers
  │     │     • Laptops/Electronics
  │     │     • Sports Equipment
  │     │
  │     ├─► View item details:
  │     │     • Photos
  │     │     • Rental price
  │     │     • Availability schedule
  │     │     • Owner ratings
  │     │     • Condition notes
  │     │
  │     └─► Select item
  │
  ├─► 3. REQUEST RENTAL
  │     │
  │     ├─► Choose rental duration (hours/days)
  │     ├─► Review total cost (rental + potential late fees)
  │     ├─► Agree to Terms & Conditions
  │     │     • Return on time or pay late fee
  │     │     • Return in same condition or pay damage fee
  │     │     • Maximum rental period limits
  │     │
  │     └─► Submit rental request
  │           │
  │           └─► Owner receives notification
  │
  ├─► 4. PAYMENT (After owner approval)
  │     │
  │     ├─► Payment via GCash
  │     ├─► System holds payment (escrow)
  │     └─► Wait for owner to deposit item
  │           │
  │           └─► Receive notification: "Item ready for pickup"
  │
  ├─► 5. CLAIM ITEM AT KIOSK
  │     │
  │     ├─► Go to physical kiosk within 1 hour
  │     │     (or item moved to delayed pickup storage)
  │     │
  │     ├─► Scan QR code on touchscreen
  │     ├─► Perform facial recognition
  │     ├─► System verifies identity
  │     │
  │     ├─► Assigned locker opens automatically
  │     ├─► Retrieve item
  │     ├─► Verify item condition
  │     │     (AI camera records item state)
  │     │
  │     └─► Close locker door
  │
  ├─► 6. USE ITEM DURING RENTAL PERIOD
  │     │
  │     ├─► Receive automated reminders:
  │     │     • 24 hours before return
  │     │     • 6 hours before return
  │     │     • 1 hour before return
  │     │     • Return deadline passed (late fees apply)
  │     │
  │     └─► Optional: Chat with owner if issues arise
  │
  └─► 7. RETURN ITEM AT KIOSK
        │
        ├─► Go to kiosk before deadline
        ├─► Scan QR code
        ├─► Perform facial recognition
        ├─► System assigns return compartment
        ├─► Locker opens
        │
        ├─► Place item inside
        │
        ├─► AI Camera verifies item condition
        │     │
        │     ├─► Same condition? → Transaction complete
        │     │                     Owner notified
        │     │                     Payment released to owner
        │     │                     Rate owner (optional)
        │     │
        │     └─► Damaged/Missing? → Damage penalty charged
        │                             Owner notified
        │                             Dispute resolution initiated
        │
        └─► Close locker door

END
```

---

### 1.4 DETAILED PROCESS FLOW: KIOSK TOUCHSCREEN INTERACTION

```
┌─────────────────────────────────────────┐
│     KIOSK TOUCHSCREEN WORKFLOW          │
└─────────────────────────────────────────┘

START: User approaches kiosk
  │
  ├─► WELCOME SCREEN
  │     │
  │     └─► "Press to Continue" button
  │           │
  │           └─► Tap to proceed
  │
  ├─► ROLE SELECTION
  │     │
  │     ├─► "I am an OWNER (depositing/retrieving)"
  │     └─► "I am a RENTER (claiming/returning)"
  │
  ├─► LOGIN SCREEN
  │     │
  │     ├─► Enter credentials OR
  │     └─► Scan QR code (generated from mobile app)
  │
  ├─► FACIAL RECOGNITION
  │     │
  │     ├─► Camera activates
  │     ├─► "Please look at the camera"
  │     ├─► System processes face
  │     │
  │     ├─► Match? → Proceed
  │     └─► No match? → Retry (3 attempts) → Lock account
  │
  ├─► ACTION SELECTION
  │     │
  │     ├─► Owner options:
  │     │     • Deposit approved item
  │     │     • Retrieve returned item
  │     │
  │     └─► Renter options:
  │           • Claim rented item
  │           • Return rented item
  │
  ├─► PAYMENT VERIFICATION (if applicable)
  │     │
  │     └─► Display GCash QR code
  │           │
  │           ├─► User scans with GCash app
  │           ├─► System verifies payment
  │           └─► Payment confirmed
  │
  ├─► LOCKER ASSIGNMENT
  │     │
  │     ├─► System selects available compartment
  │     ├─► Display locker number on screen
  │     └─► "Locker #5 opening now..."
  │
  ├─► LOCKER OPENS
  │     │
  │     ├─► Solenoid lock releases
  │     ├─► User places/retrieves item
  │     │
  │     └─► AI Camera activates
  │           │
  │           ├─► Verify item matches listing (10 attempts)
  │           │     │
  │           │     ├─► Success: "Item verified ✓"
  │           │     └─► Failure: "Verification failed. Try again."
  │           │
  │           └─► User closes door
  │                 │
  │                 └─► System locks compartment
  │
  ├─► CONFIRMATION SCREEN
  │     │
  │     ├─► "Transaction successful!"
  │     ├─► Display transaction details
  │     └─► "You may now leave"
  │
  └─► RETURN TO WELCOME SCREEN

END
```

---

### 1.5 AI ITEM VERIFICATION PROCESS FLOW

```
┌──────────────────────────────────────────────┐
│     AI-POWERED ITEM VERIFICATION FLOW        │
└──────────────────────────────────────────────┘

TRIGGER: Item placed in locker compartment
  │
  ├─► 1. AI CAMERA ACTIVATION
  │     │
  │     ├─► Camera inside compartment activates
  │     ├─► Capture multiple photos (different angles)
  │     └─► Send images to ML model
  │
  ├─► 2. IMAGE PREPROCESSING
  │     │
  │     ├─► Resize images to uniform dimensions
  │     ├─► Adjust brightness/contrast
  │     ├─► Normalize colors
  │     └─► Remove background noise
  │
  ├─► 3. FEATURE EXTRACTION
  │     │
  │     ├─► YOLOv8 model processes images
  │     ├─► Identify object boundaries
  │     ├─► Extract features:
  │     │     • Shape
  │     │     • Color
  │     │     • Size
  │     │     • Brand/text (OCR)
  │     │     • Material texture
  │     │
  │     └─► Generate feature vector
  │
  ├─► 4. COMPARISON WITH LISTING
  │     │
  │     ├─► Retrieve original listing images from database
  │     ├─► Extract features from original images
  │     │
  │     ├─► Calculate similarity score:
  │     │     • Visual similarity (80% weight)
  │     │     • Metadata match (20% weight)
  │     │
  │     └─► Generate confidence percentage
  │
  ├─► 5. VERIFICATION DECISION
  │     │
  │     ├─► Confidence ≥ 85%? → ITEM VERIFIED ✓
  │     │                        • Release payment
  │     │                        • Send notifications
  │     │                        • Update transaction status
  │     │
  │     ├─► Confidence 60-84%? → MANUAL REVIEW REQUIRED
  │     │                         • Admin notification
  │     │                         • Hold payment
  │     │                         • User contacted
  │     │
  │     └─► Confidence < 60%? → VERIFICATION FAILED ✗
  │                             • Increment retry counter
  │                             • User prompted to reposition item
  │                             │
  │                             └─► Retry < 10? → Return to Step 1
  │                                   │
  │                                   └─► Retry = 10? → TRANSACTION CANCELLED
  │                                                       • Refund initiated
  │                                                       • Item returned to owner
  │                                                       • Both parties notified
  │
  └─► 6. LOG VERIFICATION RESULTS
        │
        ├─► Store verification images
        ├─► Record confidence scores
        ├─► Update ML model training data
        └─► Generate audit trail

END
```

---

### 1.6 NOTIFICATION SYSTEM FLOW

```
┌───────────────────────────────────────┐
│     AUTOMATED NOTIFICATION SYSTEM     │
└───────────────────────────────────────┘

NOTIFICATION TRIGGERS:
│
├─► 1. RENTAL REQUEST SUBMITTED
│     │
│     └─► To OWNER:
│           • "New rental request from [Renter Name]"
│           • "Item: [Item Name]"
│           • "Duration: [X hours/days]"
│           • "Approve or Reject?"
│
├─► 2. RENTAL APPROVED BY OWNER
│     │
│     ├─► To RENTER:
│     │     • "Your request was approved!"
│     │     • "Please complete payment"
│     │     • "GCash QR code attached"
│     │
│     └─► To OWNER:
│           • "Payment received"
│           • "Please deposit item at kiosk"
│
├─► 3. ITEM DEPOSITED AT KIOSK
│     │
│     ├─► To RENTER:
│     │     • "Item ready for pickup!"
│     │     • "Locker location: [Floor 9, Kiosk #1]"
│     │     • "Claim within 1 hour"
│     │
│     └─► To OWNER:
│           • "Item successfully deposited"
│           • "Payment released to your account"
│
├─► 4. ITEM NOT CLAIMED (1 hour passed)
│     │
│     ├─► To RENTER:
│     │     • "Item moved to delayed pickup storage"
│     │     • "Visit kiosk to claim"
│     │
│     └─► To OWNER:
│           • "Item not claimed on time"
│           • "Moved to storage locker"
│
├─► 5. RENTAL PERIOD REMINDERS
│     │
│     └─► To RENTER (automated intervals):
│           • 24 hours before: "Reminder: Return [Item] by [Date/Time]"
│           • 6 hours before: "Return deadline approaching"
│           • 1 hour before: "Final reminder: Return in 1 hour"
│           • Overdue: "LATE! Late fee: ₱[Amount] per hour"
│
├─► 6. ITEM RETURNED AT KIOSK
│     │
│     ├─► To OWNER:
│     │     • "Item returned by [Renter]"
│     │     • "Verification: [Passed/Issues Detected]"
│     │     • "Please retrieve within 24 hours"
│     │
│     └─► To RENTER:
│           • "Return successful!"
│           • "Rate your experience"
│
├─► 7. VERIFICATION FAILED
│     │
│     ├─► To RENTER:
│     │     • "Item verification failed"
│     │     • "Reason: [Damage/Wrong item]"
│     │     • "Penalty: ₱[Amount]"
│     │
│     └─► To OWNER:
│           • "Returned item has issues"
│           • "Please review and report"
│
└─► 8. DISPUTE INITIATED
      │
      ├─► To BOTH PARTIES:
      │     • "Dispute opened"
      │     • "Admin reviewing case"
      │     • "Case ID: [XXX]"
      │
      └─► To ADMIN:
            • "New dispute requires review"
            • "Evidence: [Photos/Logs]"

END
```

---

## 2. REAL-WORLD COMPARABLE PLATFORMS

### 2.1 PRIMARY COMPARISON: **Shopee (E-commerce + Logistics)**

**Similarities:**
| EngiRent Hub Feature | Shopee Equivalent |
|---------------------|-------------------|
| Item Listing | Product Listing (Seller Dashboard) |
| Browse & Search | Shopee Homepage/Search |
| Payment Escrow | Shopee Guarantee (holds payment) |
| Item Verification | Shopee Check (QR code parcel verification) |
| Ratings & Reviews | Buyer/Seller Rating System |
| Chat Feature | Shopee Chat (in-app messaging) |
| Automated Notifications | Order status updates, delivery tracking |
| Cashless Payment | ShopeePay, GCash integration |
| Dispute Resolution | Shopee Return/Refund Center |

**Key Differences:**
- **Physical Lockers**: EngiRent uses automated kiosks; Shopee uses delivery riders
- **Peer-to-Peer**: EngiRent is student-to-student; Shopee is business-to-consumer
- **Biometric Security**: EngiRent uses face + QR; Shopee uses OTP + app login
- **AI Verification**: EngiRent verifies items with AI cameras; Shopee relies on buyer inspection

---

### 2.2 SECONDARY COMPARISONS

#### **Amazon Hub Locker (USA)**
- **What it is**: Automated parcel lockers for Amazon deliveries
- **How it's similar**:
  - Users get unique QR/PIN code via email
  - Scan code at kiosk to open assigned locker
  - Time-limited pickup (3 days)
  - Automated notifications
- **How it differs**:
  - One-way (delivery only, not peer-to-peer rentals)
  - No AI verification
  - Corporate-managed, not student-to-student

#### **Grab/Lalamove Parcel Lockers (Philippines)**
- **What it is**: Self-service lockers for package drop-off/pickup
- **How it's similar**:
  - QR code authentication
  - Automated locker access
  - Mobile app integration
  - GCash payment support
- **How it differs**:
  - Courier service, not rental marketplace
  - No facial recognition
  - No rental period management

#### **Fat Llama (UK) - Peer-to-Peer Rental Platform**
- **What it is**: App for renting items from neighbors (cameras, tools, equipment)
- **How it's similar**:
  - Peer-to-peer item rentals
  - Escrow payment system
  - User ratings/reviews
  - Insurance for items
  - In-app messaging
- **How it differs**:
  - No physical kiosks (manual handoff)
  - No AI verification
  - Broader geographic range (not campus-specific)

#### **Popbox (Indonesia) - Smart Locker Network**
- **What it is**: Automated parcel lockers for e-commerce deliveries
- **How it's similar**:
  - QR code access
  - Automated locker system
  - Mobile app notifications
  - Strategic locations (malls, campuses)
- **How it differs**:
  - Delivery service only
  - No rental marketplace
  - No biometric authentication

---

### 2.3 UNIQUE VALUE PROPOSITION OF ENGIRENT HUB

**What makes EngiRent different from these platforms:**

1. **Campus-Specific**: Designed exclusively for UCLM engineering students
2. **Dual Authentication**: QR code + facial recognition (higher security)
3. **AI Item Verification**: Camera inside lockers validates items automatically
4. **Rental-Focused**: Not delivery, not sales—pure peer-to-peer rentals
5. **Academic Context**: Targets student needs (lab gowns, calculators, drawing tools)
6. **Zero Human Interaction**: Fully automated from listing to return
7. **Integrated Penalty System**: Automatic late fees and damage charges
8. **Parent/Guardian Info**: Additional accountability for students
9. **Conveyor for Unclaimed Items**: Automatic storage management
10. **On-Campus Convenience**: No need to meet in person or coordinate schedules

---

## 3. TECHNICAL STACK SUMMARY

### 3.1 Frontend
- **Web App**: Next.js / React.js
- **Mobile App**: Flutter (cross-platform iOS/Android)
- **Kiosk Interface**: Touchscreen UI (React/Electron)

### 3.2 Backend
- **Server**: Node.js with Express.js
- **Database**: MySQL (user data, transactions, item listings)
- **AI/ML**: Python with YOLOv8 (item recognition)
- **Cloud Storage**: AWS S3 / Google Cloud Storage (images)

### 3.3 Hardware
- **Microcontroller**: ESP32 / Raspberry Pi 4
- **Locks**: 12V Solenoid Locks
- **Cameras**: 
  - Front: USB webcam (facial recognition)
  - Inside lockers: Small cameras (item verification)
- **Scanner**: QR code scanner module
- **Conveyor**: Stepper motor system
- **Display**: 10-15" capacitive touchscreen

### 3.4 Security
- **Authentication**: JWT tokens, bcrypt password hashing
- **Biometrics**: FaceNet / DeepFace (facial recognition)
- **Payment**: GCash API integration (escrow system)
- **Encryption**: TLS/SSL for data transmission

---

## 4. KEY CHALLENGES & SOLUTIONS

| Challenge | Solution |
|-----------|----------|
| **False AI Verification** | Train model with 500+ images per item category; implement confidence thresholds |
| **Locker Size Variety** | Modular compartments (small/medium/large) for different item types |
| **Network Downtime** | Offline mode: Local storage on ESP32, sync when online |
| **User Abuse** | Parent/guardian info, ID verification, rating system, penalty charges |
| **Item Damage Disputes** | Before/after photos, admin review panel, timestamp logs |
| **Privacy Concerns** | Encrypted face data, auto-delete after transaction, compliance with Data Privacy Act |

---

## 5. SUCCESS METRICS

### Phase 1 (Prototype Testing)
- ✅ QR + Face authentication: 95%+ accuracy
- ✅ AI item verification: 85%+ confidence
- ✅ Locker open/close: <3 seconds response time
- ✅ User satisfaction: 3.3+ weighted mean (achieved: 3.328)

### Phase 2 (Campus Deployment)
- 🎯 100+ registered users in first month
- 🎯 200+ successful rentals in first semester
- 🎯 <5% transaction failure rate
- 🎯 <10% dispute rate

### Phase 3 (Expansion)
- 🎯 Multiple kiosks across UCLM campus
- 🎯 Integration with other departments (not just engineering)
- 🎯 Partnership with campus bookstore/student services

---

## 6. FUTURE ENHANCEMENTS

1. **Mobile App Expansion**: Full-featured iOS/Android app (not just web-based)
2. **NFC Support**: Tap student ID card instead of QR code
3. **Smart Contracts**: Blockchain-based transaction immutability
4. **Insurance Integration**: Damage protection plans for high-value items
5. **Analytics Dashboard**: Usage patterns, popular items, peak hours
6. **Social Features**: Item wishlists, group rentals, collaborative borrowing
7. **Multi-Campus Network**: Expand to other UC campuses (Banilad, Main, etc.)
8. **Sustainability Metrics**: Track environmental impact (items shared vs. purchased)

---

## CONCLUSION

**EngiRent Hub** is essentially a **"Shopee + Amazon Locker + Fat Llama"** hybrid designed specifically for campus life. It combines:
- **Shopee's marketplace model** (listing, browsing, escrow payments, ratings)
- **Amazon Locker's automation** (kiosk-based retrieval, QR codes)
- **Fat Llama's peer-to-peer rentals** (student-to-student sharing)

But with unique advantages:
- ✅ **Biometric security** (face + QR)
- ✅ **AI verification** (prevents fraud)
- ✅ **Zero human interaction** (fully automated)
- ✅ **Campus-optimized** (targets student needs)

This system addresses real pain points for engineering students—expensive tools, infrequent use of lab equipment, trust issues in informal borrowing—by creating a secure, convenient, and accountable platform that operates 24/7 without human supervision.
