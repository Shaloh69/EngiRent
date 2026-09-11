/**
 * EngiRent process diagrams — the source of every PNG in docs/diagrams/.
 *
 * Every state, endpoint, threshold and timing below was read out of the
 * repository on 2026-09-12, not out of the specification documents:
 *   prisma/schema.prisma        the enumerations
 *   src/routes/                 the 93 endpoints
 *   src/index.ts                the rental transitions, with line numbers
 *   ml/app/routers/verification.py:170-174   the 85 / 60 / retry bands
 *   server/kiosk/kiosk_config.json           the per-bay door timings
 */

export const CLASSDEFS = `
  classDef ok fill:#0C2E1C,stroke:#45DC80,color:#D6F7E2
  classDef bad fill:#33151B,stroke:#FF8A95,color:#FFE0E3
  classDef wait fill:#0B2E3A,stroke:#33B6D1,color:#D9F2F8
  classDef warn fill:#3A2A0C,stroke:#F5B85C,color:#FBEBD0
  classDef hw fill:#241A33,stroke:#A98BD6,color:#E8DEF7`;

export const diagrams = [
  {
    file: "00-system-map",
    num: "00",
    lane: "Topology",
    title: "System map",
    purpose:
      "Four client surfaces, two services and a locker bank. Nothing runs on a developer's machine: the services live on one Windows host reached over Tailscale, and the bank is a Raspberry Pi 5 in a corridor.",
    source:
      "src/index.ts:160 · src/routes/index.ts · kiosk_config.json · services/mlVerificationService.ts",
    code: `flowchart LR
  subgraph CL["Client surfaces"]
    direction TB
    FL["Flutter app<br/>24 student screens"]
    AD["Admin console<br/>Next.js 15 + Mantine 7"]
    WB["Public website<br/>Next.js"]
  end
  subgraph SV["Server host — desktop-gklhcri"]
    direction TB
    API["Node / Express API<br/>port 5000, mounted at /api/v1"]
    ML["Python ML service<br/>port 8001"]
    DB[("MySQL 'engirent'<br/>127.0.0.1:3307")]
  end
  subgraph KB["Locker bank — Raspberry Pi 5"]
    direction TB
    UI["Kiosk UI<br/>React, 1080x1920 portrait"]
    SC["socket_client.py<br/>hardware supervisor"]
    HW["8 solenoids · 4 linear actuators<br/>active-LOW relays"]
    CAM["4 USB cameras<br/>one per bay, stable by-path"]
  end
  FL -->|"REST + socket.io"| API
  AD -->|"REST + socket.io + SSE"| API
  WB -->|"REST"| API
  API <--> DB
  API -->|"server-side only —<br/>the API key never reaches a client"| ML
  API <-->|"socket.io, kiosk room"| SC
  SC --> UI
  SC --> HW
  SC --> CAM
  class ML wait
  class HW,CAM hw`,
  },

  {
    file: "01-account-and-identity",
    num: "01",
    lane: "Student",
    title: "Account and identity",
    purpose:
      "A student cannot list or rent until a human has looked at their student ID. The face registered here is the same face the locker checks later.",
    source: "src/routes/authRoutes.ts · adminRoutes.ts POST /id-verifications/:id · enum UserRole",
    code: `flowchart TD
  A(["Student opens the app"]) --> B["Register<br/>POST /auth/register"]
  B --> C["Log in — access + refresh tokens<br/>POST /auth/login"]
  C --> D["Complete the profile<br/>POST /auth/profile/complete"]
  D --> E["Upload the student ID photo<br/>POST /auth/id-photo"]
  E --> F["Register the face<br/>POST /auth/register-face"]
  F --> G{{"Waits in the administrator's queue<br/>GET /admin/id-verifications?status=PENDING"}}
  G -->|"APPROVE"| H["isVerified = true<br/>socket event: verification:approved"]
  G -->|"REJECT + a reason"| I["verificationStatus = REJECTED<br/>the reason is shown; resubmit"]
  I --> E
  H --> J(["May now list items and rent them"])
  class H,J ok
  class I bad
  class G wait`,
  },

  {
    file: "02-listing-an-item",
    num: "02",
    lane: "Student · as owner",
    title: "Listing an item",
    purpose:
      "The photographs uploaded here become the reference set the machine-vision comparison scores a deposited item against. Their quality is evidence, not decoration.",
    source: "src/routes/itemRoutes.ts · uploadRoutes.ts · enum ItemCategory · ItemCondition",
    code: `flowchart TD
  A(["Verified owner"]) --> B["Fill in the listing<br/>title · category · condition · daily rate · deposit"]
  B --> C["Upload photographs<br/>POST /upload/images"]
  C --> D["Create the item<br/>POST /items"]
  D --> E["Reference features extracted<br/>stored on item.mlFeatures"]
  E --> F(["Listed and discoverable<br/>GET /items"])
  F --> G["Owner maintains it<br/>PUT /items/:id · DELETE /items/:id"]
  F --> H{{"Administrator moderation<br/>PATCH /admin/items/:id · /items/bulk"}}
  H -->|"hidden or edited"| I["Removed from discovery"]
  F --> J["Renters see availability<br/>GET /items/:id/booked-dates"]
  class F ok
  class H wait`,
  },

  {
    file: "03-rental-lifecycle",
    num: "03",
    lane: "Owner · Renter · Administrator",
    title: "The rental lifecycle, end to end",
    purpose:
      "The whole point of the system is that these two students never meet. Everything below happens through the locker bank and the administrator's queues.",
    source:
      "src/index.ts:485-860 kiosk:images · adminController.ts:853 · kioskRoutes.ts · rentalSettlementService.ts",
    code: `flowchart TD
  subgraph R1["Request"]
    A(["Renter picks dates"]) --> B["POST /rentals<br/>rental is PENDING"]
  end
  subgraph R2["Money — manual, GCash"]
    B --> C["Two payments raised<br/>RENTAL_PAYMENT + SECURITY_DEPOSIT"]
    C --> D["Renter sends the money and taps<br/>'I have sent it' — transaction PENDING"]
    D --> E{{"Administrator checks the money arrived<br/>POST /admin/transactions/:id/decide-payment"}}
  end
  subgraph R3["Deposit — the owner's trip to the bank"]
    E -->|"both APPROVED"| F["rental becomes AWAITING_DEPOSIT"]
    F --> G["Owner requests a bay<br/>POST /kiosk/deposit"]
    G --> H["Owner face-verified at the panel"]
    H --> I["Door drives open · owner places the item · cameras capture"]
    I --> J{{"Item verification — sheet 08"}}
    J -->|"below 60, attempts remain"| I
    J -->|"REJECTED"| K(["rental CANCELLED<br/>bay returns to AVAILABLE"])
    J -->|"85 or above, or 60-84 held for review"| L["rental DEPOSITED<br/>bay becomes OCCUPIED"]
  end
  subgraph R4["Collection"]
    L --> M["Renter scans the kiosk QR and is face-verified"]
    M --> N["Door opens · renter collects"]
    N --> O["rental ACTIVE<br/>bay returns to AVAILABLE"]
  end
  subgraph R5["Return"]
    O --> P["Renter returns the item to a bay<br/>POST /kiosk/return"]
    P --> Q{{"Item verification again"}}
    Q -->|"below 60, attempts remain"| P
    Q -->|"REJECTED"| S(["rental DISPUTED — sheet 11"])
    Q -->|"passes"| T["rental VERIFICATION"]
    T --> U["Owner collects from the bay"]
    U --> V(["rental COMPLETED<br/>deposit released · reviews invited"])
  end
  class V,L,O ok
  class K,S bad
  class E,J,Q wait`,
  },

  {
    file: "04-rental-state-machine",
    num: "04",
    lane: "Server",
    title: "Rental state machine",
    purpose:
      "Eight states, and every transition below is a line of code rather than an intention. This is the contract every surface renders against.",
    source: "prisma/schema.prisma enum RentalStatus · rental status writes across src/",
    code: `stateDiagram-v2
  direction TB
  [*] --> PENDING
  PENDING --> AWAITING_DEPOSIT : both payments approved
  PENDING --> CANCELLED : renter or owner cancels
  AWAITING_DEPOSIT --> AWAITING_DEPOSIT : RETRY, door reopens
  AWAITING_DEPOSIT --> DEPOSITED : deposit verified
  AWAITING_DEPOSIT --> CANCELLED : deposit REJECTED
  DEPOSITED --> ACTIVE : renter collects
  ACTIVE --> ACTIVE : RETRY on return
  ACTIVE --> VERIFICATION : return verified
  ACTIVE --> DISPUTED : return REJECTED
  VERIFICATION --> COMPLETED : auto-complete or admin
  DISPUTED --> COMPLETED : administrator settles
  COMPLETED --> [*]
  CANCELLED --> [*]`,
  },

  {
    file: "05-payments-and-deposit",
    num: "05",
    lane: "Money",
    title: "Payments and the deposit",
    purpose:
      "Money moves by GCash transfer with an administrator confirming receipt. The gateway integration exists on sandbox keys; the manual path is the one in service, and the app says so.",
    source: "paymentRoutes.ts · adminController.ts:820-853 · enum TransactionType · TransactionStatus",
    code: `flowchart TD
  A["POST /payments<br/>type: RENTAL_PAYMENT or SECURITY_DEPOSIT"] --> B["Response carries<br/>status AWAITING_CONFIRMATION · paymentUrl null · mode MANUAL"]
  B --> C["Instructions sheet:<br/>amount · GCash number · a copyable reference"]
  C --> D["'I have sent it'<br/>transaction becomes PENDING"]
  D --> E{{"Administrator verifies receipt<br/>POST /admin/transactions/:id/decide-payment"}}
  E -->|"APPROVE"| F["transaction COMPLETED<br/>socket: payment:approved"]
  E -->|"reject"| G["transaction FAILED<br/>the renter is told why"]
  F --> H{"Both the rent and the deposit approved?"}
  H -->|"no"| I["rental stays PENDING"]
  H -->|"yes"| J(["rental advances to AWAITING_DEPOSIT"])
  J -.->|"at settlement"| K["DEPOSIT_REFUND back to the renter<br/>OWNER_PAYOUT to the owner"]
  K --> L["POST /admin/transactions/:id/refund"]
  class F,J ok
  class G bad
  class E wait`,
  },

  {
    file: "06-locker-handoff",
    num: "06",
    lane: "Kiosk + phone",
    title: "The locker handoff, across two screens",
    purpose:
      "One interface spread over a wall panel and a phone. The panel leads; the phone does the part that needs a camera pointed at a face.",
    source:
      "kiosk_ui_react/src/useKioskState.ts · components/screens/*.tsx (11) · flutter kiosk_scan_screen.dart",
    code: `flowchart TD
  subgraph K["Kiosk panel — 1080x1920, portrait"]
    direction TB
    K1["idle — attract loop"]
    K2["main — rotating QR<br/>90 second token, single use"]
    K3["face — 'Check your phone'"]
    K4["verifying — an alive waiting state"]
    K5["working — door_open · dropping · capturing"]
    K6["success — 'Bay NN is open'"]
    K7["error — recoverable, with a way out"]
  end
  subgraph P["Phone — Flutter"]
    direction TB
    P1["kiosk_scan_screen — viewfinder"]
    P2["session opens<br/>POST /kiosk/session/start"]
    P3["face_verify_screen<br/>framing · captured · uploading"]
    P4["120s countdown from the server's<br/>absolute expiresAt · attempt N of 4"]
    P5["outcome, in place — the screen<br/>underneath is not disturbed"]
  end
  K1 -->|"touch"| K2
  K2 -.->|"student scans"| P1
  P1 --> P2
  P2 ==>|"kiosk_session_started"| K3
  K3 --> P3
  P3 --> P4
  P4 ==>|"verdict"| K4
  K4 -->|"pass"| K5
  K5 --> K6
  K6 -.->|"5s auto-return"| K1
  K4 -->|"fail closed"| K7
  P4 --> P5
  class K6 ok
  class K7 bad`,
  },

  {
    file: "07-face-verification",
    num: "07",
    lane: "Trust boundary",
    title: "Face verification, and who the kiosk waits for",
    purpose:
      "Identity is never taken from the client. The rental's own status decides whose face is required, so a renter cannot present themselves as the owner by editing a request.",
    source: "services/faceVerificationService.ts:74-110 · kioskSessionStore.ts · kiosk/tests/test_qr_token.py",
    code: `flowchart TD
  A["Phone scans the panel's QR"] --> B{"The kiosk validates the token itself"}
  B -->|"not the token currently live in its own process,<br/>or older than 90s, or already used"| C(["Refused"])
  B -->|"accepted"| D["Session opens in the server-side store<br/>POST /kiosk/session/start"]
  D --> E{"resolveFaceSubject reads the rental's status"}
  E -->|"AWAITING_DEPOSIT"| F["The subject is the OWNER<br/>they are the one depositing"]
  E -->|"any other status"| G["The subject is the RENTER"]
  F --> H["Phone uploads the capture<br/>POST /kiosk/verify-face"]
  G --> H
  H --> I["Node calls the ML service<br/>the API key never reaches a client"]
  I --> J{"Match?"}
  J -->|"yes"| K(["Door command issued"])
  J -->|"no, or the model is unreachable"| L(["Fails CLOSED — the door stays shut"])
  class K ok
  class C,L bad
  class B,E wait`,
  },

  {
    file: "08-item-verification",
    num: "08",
    lane: "Machine vision",
    title: "Item verification",
    purpose:
      "Five signals combined into one score, three bands deciding what happens next. The real question is not 'is this a calculator' but 'is this THAT calculator'.",
    source:
      "ml/app/routers/verification.py:170-174 · ml/app/config.py threshold_verified 85 · services/verificationEvidence.ts",
    code: `flowchart TD
  A["Bay cameras capture frames"] --> B["kiosk:images reaches the API"]
  B --> C["Reference photos and kiosk frames downloaded"]
  C --> D{"Did every download succeed?"}
  D -->|"no"| E["unavailable = true<br/>reason: reference_images_unavailable<br/>or kiosk_images_unavailable"]
  C --> F["POST /api/v1/verify to the ML service"]
  F --> G{"Did the service answer?"}
  G -->|"threw"| H["unavailable = true<br/>reason: ml_unreachable"]
  G -->|"answered"| I["Five signals combined:<br/>colour · shape · texture · ORB<br/>SIFT keypoints · ResNet50 · serial OCR"]
  I --> J{"Confidence"}
  J -->|"85 and above"| K(["APPROVED — proceeds automatically"])
  J -->|"60 to 84"| L(["PENDING — held for a human"])
  J -->|"below 60"| M{"Attempts remaining, up to 10?"}
  M -->|"yes"| N(["RETRY — the door reopens"])
  M -->|"no"| O(["REJECTED"])
  E --> P["Fails closed to PENDING<br/>a human must look"]
  H --> P
  P --> Q["Row written with the reason recorded<br/>excluded from any calibration set"]
  class K ok
  class O bad
  class L,P,Q wait
  class N warn`,
  },

  {
    file: "09-locker-bay-states",
    num: "09",
    lane: "Hardware",
    title: "Locker bay states",
    purpose:
      "Each bay drives two solenoid doors and one linear actuator through active-LOW relays. Bay 2's door is 5 s where every other bay is 15 s — it is the bay that catches synchronisation bugs.",
    source: "server/kiosk/kiosk_config.json — read only, never edited · enum LockerStatus",
    code: `stateDiagram-v2
  direction LR
  [*] --> AVAILABLE
  AVAILABLE --> RESERVED : assigned to a deposit
  RESERVED --> OCCUPIED : item deposited and verified
  OCCUPIED --> AVAILABLE : renter collects, or a return is settled
  AVAILABLE --> MAINTENANCE : taken out by an administrator
  MAINTENANCE --> AVAILABLE : returned to service
  AVAILABLE --> OUT_OF_SERVICE : fault
  OUT_OF_SERVICE --> AVAILABLE : repaired`,
  },

  {
    file: "10-administrator",
    num: "10",
    lane: "Administrator",
    title: "The administrator's day",
    purpose:
      "Role separation is enforced on the server; the console's own gating is a convenience on top of it, never the boundary. Everything here is a queue someone has to drain.",
    source: "src/routes/adminRoutes.ts — 34 endpoints · enum UserRole: STUDENT · ADMIN · REVIEWER",
    code: `flowchart LR
  A(["Sign in — role ADMIN or REVIEWER<br/>checked server-side"]) --> B["Dashboard<br/>GET /admin/stats"]
  B --> C["Student IDs<br/>GET /admin/id-verifications"]
  B --> D["Payments<br/>GET /admin/transactions"]
  B --> E["Item verifications held at 60-84<br/>GET /admin/verifications"]
  B --> F["Disputes<br/>GET /admin/rentals"]
  B --> G["Locker bank<br/>GET /admin/kiosks/lockers"]
  B --> H["Listings and reports<br/>GET /admin/items/:id · /reports"]
  C --> C1["POST /admin/id-verifications/:id"]
  D --> D1["POST /admin/transactions/:id/decide-payment"]
  E --> E1["PATCH /admin/verifications/:id"]
  F --> F1["POST /admin/rentals/:id/settle"]
  G --> G1["Release a stuck bay<br/>POST /admin/kiosks/lockers/:id/release"]
  G --> G2["Live health over SSE<br/>GET /admin/kiosks/events"]
  H --> H1["PATCH /admin/items/:id · /items/bulk"]
  B --> I["Audit trail<br/>GET /admin/audit-log"]
  class C,D,E,F wait`,
  },

  {
    file: "11-disputes-and-settlement",
    num: "11",
    lane: "Administrator · Owner · Renter",
    title: "Disputes and settlement",
    purpose:
      "A dispute is the one queue where a student's money is held until a person acts, which is why it is the queue with a live signal attached to it.",
    source: "src/index.ts:745-800 · rentalSettlementService.ts · POST /admin/rentals/:id/settle",
    code: `flowchart TD
  A["Return scores REJECTED"] --> B["rental DISPUTED<br/>bay is freed regardless"]
  B --> C["Owner notified · renter emailed"]
  B --> D["admin:dispute_opened broadcast to the console"]
  D --> E["Administrator reads the evidence<br/>reference photos vs bay frames · the conversation"]
  E --> F{"Decision"}
  F -->|"the item is fine"| G["Deposit released in full<br/>DEPOSIT_REFUND"]
  F -->|"damaged or wrong"| H["DAMAGE_FEE deducted<br/>the remainder refunded"]
  F -->|"late"| I["LATE_FEE applied"]
  G --> J(["POST /admin/rentals/:id/settle<br/>rental COMPLETED"])
  H --> J
  I --> J
  J --> K["Both parties may review each other<br/>POST /reviews"]
  class J,K ok
  class A,B bad
  class E,F wait`,
  },

  {
    file: "12-notifications",
    num: "12",
    lane: "Cross-cutting",
    title: "Notifications and the real-time layer",
    purpose:
      "Three transports, each with a different job. Confusing them is how a screen ends up showing stale state with total confidence.",
    source: "enum NotificationType · notificationRoutes.ts · GET /admin/kiosks/events",
    code: `flowchart LR
  A["A state change on the server"] --> B["Row written to Notification<br/>GET /notifications"]
  A --> C["socket.io to the user's own room<br/>user:ID"]
  A --> D["Email, for the ones that matter<br/>verification failed · payment"]
  A --> E["SSE to the console<br/>GET /admin/kiosks/events"]
  C --> F["Phone: a toast, and a refetch on reconnect"]
  E --> G["Console: a LIVE badge and kiosk health"]
  B --> H["Both: the durable list, read later"]
  class C,E wait`,
  },
  {
    file: "14-physical-layer-and-dead-ends",
    num: "14",
    lane: "Hardware · the questions the happy path does not answer",
    title: "The physical layer, and where an item gets stuck",
    purpose:
      "Each bay has two solenoid doors and one linear actuator. The server drives exactly one of the three. This sheet is the audit of what the hardware can do, what is actually commanded, and the four states in which a real item ends up physically unreachable.",
    source:
      "kiosk/config.py:79-136 · hardware/gpio_controller.py:19 · hardware/actuator_controller.py:113 · services/socket_client.py:303-315 · node src/index.ts · services/faceVerificationService.ts:214-330 · adminController.ts:1121",
    code: `flowchart TB
  subgraph HW["What every bay physically has — config.py, kiosk_config.json"]
    direction LR
    H1["main_door<br/>TOP insertion door<br/>solenoid · 15s, bay 2 is 5s"]
    H2["linear actuator<br/>extend pushes the item in,<br/>retract returns the platform<br/>17-23s per bay"]
    H3["bottom_door<br/>RETRIEVAL door at the base<br/>solenoid · 15s, bay 2 is 5s"]
  end

  subgraph DRIVEN["What the server actually commands"]
    direction LR
    D1["open_door, door = main_door<br/>all SIX call sites"]
    D2["capture_image"]
    D3["verification_done · flow_error<br/>await_phone_verification · face_failed"]
  end

  subgraph DEAD["Built on the Pi, NEVER commanded by the server"]
    direction LR
    N1["drop_item — the actuator.<br/>place_item has exactly ONE caller,<br/>and nothing sends the command"]
    N2["open_door, door = bottom_door.<br/>Wired to BCM 6/7/8/9, calibrated,<br/>and Node only ever sends main_door"]
    N3["actuator_extend · actuator_retract"]
  end

  subgraph STUCK["Where a real item ends up physically unreachable"]
    direction TB
    S1["D-67a · Deposit REJECTED<br/>rental CANCELLED, bay set AVAILABLE,<br/>NO door reopened — the owner's item is<br/>sealed in a bay the database calls empty"]
    S2["D-67b · Return REJECTED<br/>rental DISPUTED, bay set AVAILABLE,<br/>NO door reopened — same, with a disputed item"]
    S3["D-68 · Return ACCEPTED, status VERIFICATION<br/>bay set OCCUPIED. The owner scans and<br/>resolveKioskFlow returns action 'none'.<br/>No owner-retrieval flow exists at all"]
    S4["D-71 · DEPOSITED and never collected<br/>The nightly cron only looks at ACTIVE past endDate.<br/>Late COLLECTION is not modelled anywhere"]
  end

  ESC["The only physical recovery that exists:<br/>POST /admin/kiosks/:kioskId/command<br/>It CAN send drop_item, bottom_door and the actuator —<br/>but it is a raw hardware command, rental-unaware,<br/>and there is no UI for it"]

  H1 --> D1
  H2 -.->|"never reached"| N1
  H3 -.->|"never reached"| N2
  DRIVEN --> STUCK
  S1 --> ESC
  S2 --> ESC
  S3 --> ESC
  S4 --> ESC

  class H1,H2,H3 hw
  class D1,D2,D3 ok
  class N1,N2,N3 warn
  class S1,S2,S3,S4 bad
  class ESC wait`,
  },
];

/* ───────────────────────────────────────────────────────────────────────────
   The master sheet. Every process from 00 to 12 in one drawing, laid out as
   the journey actually runs: identity gates supply, supply and money gate the
   bank, and the bank gates settlement. The administrator's queues are drawn
   once, on the right, with dotted lines to each point where a person is the
   thing standing between a student and their deposit.
   ─────────────────────────────────────────────────────────────────────────── */
export const master = {
  file: "13-everything",
  num: "13",
  lane: "All processes · sheets 00-12 in one",
  title: "EngiRent, end to end",
  purpose:
    "Every process in the system on one sheet. Read left to right: a student becomes verified, an owner lists, a renter pays, the bank mediates the handoff twice, and a human settles what the machine would not. Dotted lines mark the five points where a person is the bottleneck.",
  source:
    "prisma/schema.prisma · src/routes/ (93 endpoints) · src/index.ts · ml/app/routers/verification.py:170-174 · kiosk_config.json — all read 2026-09-12",
  code: `flowchart TB

  subgraph IDN["01 · Identity — nobody transacts until a human checks an ID"]
    direction LR
    I1["Register · log in<br/>POST /auth/register · /login"] --> I2["Complete profile<br/>ID photo · register face"]
    I2 --> I3{{"Administrator ID queue"}}
    I3 -->|"reject + reason"| I2
    I3 -->|"approve"| I4(["Verified student"])
  end

  subgraph SUP["02 · Supply — the owner lists"]
    direction LR
    S1["Create the listing<br/>POST /items"] --> S2["Photographs become the<br/>reference set · item.mlFeatures"]
    S2 --> S3(["Listed · GET /items"])
    S3 -.-> S4{{"Moderation<br/>PATCH /admin/items/:id"}}
  end

  subgraph MON["03 + 05 · Request and money — manual GCash"]
    direction LR
    R1["Renter picks dates<br/>POST /rentals · PENDING"] --> R2["Rent + security deposit raised<br/>two transactions, both PENDING"]
    R2 --> R3{{"Administrator confirms<br/>the money arrived"}}
    R3 -->|"either not approved"| R4["stays PENDING"]
    R3 -->|"both APPROVED"| R5["AWAITING_DEPOSIT"]
    R1 -->|"cancel"| RC(["CANCELLED"])
  end

  subgraph BNK["06-09 · The locker bank — deposit"]
    direction LR
    D1["Panel idle → rotating QR<br/>90s token, single use"] --> D2["Phone scans · session opens<br/>POST /kiosk/session/start"]
    D2 --> D3{"resolveFaceSubject reads<br/>the rental's status"}
    D3 -->|"AWAITING_DEPOSIT"| D4["subject = the OWNER"]
    D4 --> D5{"Face matches?<br/>Node calls the model"}
    D5 -->|"no, or the model is unreachable"| D6(["FAILS CLOSED<br/>the door stays shut"])
    D5 -->|"yes"| D7["Door drives open · item placed<br/>bay camera captures"]
    D7 --> D8{"Item verification"}
    D8 -->|"below 60 · up to 10 attempts"| D7
    D8 -->|"REJECTED"| D9(["CANCELLED<br/>bay AVAILABLE"])
    D8 -->|"85 and above"| D10["DEPOSITED<br/>bay OCCUPIED"]
    D8 -->|"60 to 84"| D11["DEPOSITED, held for review"]
    D8 -->|"images or model unavailable"| D12["unavailable + reason recorded<br/>no evidence, not a no-match"]
    D12 --> D11
  end

  subgraph COL["06-07 · Collection — the renter's trip"]
    direction LR
    C1["Renter scans the QR<br/>subject = the RENTER"] --> C2{"Face matches?"}
    C2 -->|"no"| C3(["Door stays shut"])
    C2 -->|"yes"| C4["Door opens · renter collects"]
    C4 --> C5(["ACTIVE<br/>bay returns to AVAILABLE"])
  end

  subgraph RET["03 + 08 · Return"]
    direction LR
    T1["Renter returns the item<br/>POST /kiosk/return"] --> T2{"Item verification again"}
    T2 -->|"below 60 · attempts remain"| T1
    T2 -->|"passes"| T3["VERIFICATION"]
    T2 -->|"REJECTED"| T4(["DISPUTED"])
    T3 --> T5["Owner collects from the bay"]
  end

  subgraph FIN["11 + 05 · Settlement and after"]
    direction LR
    F2{{"Administrator settles<br/>POST /admin/rentals/:id/settle"}}
    F2 -->|"item is fine"| F3["Deposit released in full"]
    F2 -->|"damaged / wrong / late"| F4["DAMAGE_FEE or LATE_FEE deducted<br/>remainder refunded"]
    F3 --> F5(["COMPLETED<br/>OWNER_PAYOUT · deposit refunded"])
    F4 --> F5
    F5 --> F6["Both parties review each other<br/>POST /reviews"]
  end

  subgraph XCT["12 · Every transition emits, on four transports"]
    direction LR
    N1["Notification row · the durable list"]
    N2["socket.io to user:ID · a toast"]
    N3["Email for the ones that matter"]
    N4["SSE to the console · kiosk health"]
  end

  I4 --> S1
  I4 --> R1
  S3 --> R1
  R5 --> D1
  D10 --> C1
  D11 --> C1
  C5 --> T1
  T5 --> F2
  T4 --> F2
  D9 -.-> N1
  F5 -.-> N1
  C5 -.-> N1

  class I4,S3,C5,F5,D10 ok
  class D6,D9,C3,T4,RC bad
  class I3,R3,F2,S4,D11,D12 wait
  class D3,D5,C2,D8,T2 wait`,
};

export const all = [...diagrams, master];
