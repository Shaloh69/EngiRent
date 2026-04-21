import {
  PrismaClient,
  UserRole,
  LockerSize,
  LockerStatus,
  ItemCategory,
  ItemCondition,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  process.stdout.write(`${msg}\n`);
}

async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

// ── Admin user ────────────────────────────────────────────────────────────────

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL ?? "admin@engirent.edu.ph";
  const password = process.env.ADMIN_PASSWORD ?? "EngiRent@2025!";
  const studentId = process.env.ADMIN_STUDENT_ID ?? "ADMIN-001";

  const hashed = await hashPassword(password);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      role: UserRole.ADMIN,
      isVerified: true,
      isActive: true,
    },
    create: {
      email,
      password: hashed,
      studentId,
      firstName: "EngiRent",
      lastName: "Admin",
      phoneNumber: "09000000000",
      role: UserRole.ADMIN,
      isVerified: true,
      isActive: true,
    },
  });

  log(`  ✓ Admin       ${admin.email}  (pw: ${password})`);
  return admin;
}

// ── Sample students ───────────────────────────────────────────────────────────

const STUDENT_PASSWORD = "Student@2025!";

const STUDENTS = [
  {
    email: "ian.luna@uclm.edu.ph",
    studentId: "2021-00001",
    firstName: "Ian",
    lastName: "Luna",
    phoneNumber: "09111111111",
  },
  {
    email: "allan.mondejar@uclm.edu.ph",
    studentId: "2021-00002",
    firstName: "Allan",
    lastName: "Mondejar",
    phoneNumber: "09222222222",
  },
  {
    email: "mcjerrel.abala@uclm.edu.ph",
    studentId: "2021-00003",
    firstName: "Mcjerrel",
    lastName: "Abala",
    phoneNumber: "09333333333",
  },
];

async function seedStudents() {
  const hashed = await hashPassword(STUDENT_PASSWORD);
  const created = [];

  for (const s of STUDENTS) {
    const user = await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: {
        ...s,
        password: hashed,
        role: UserRole.STUDENT,
        isVerified: true,
        isActive: true,
      },
    });
    log(`  ✓ Student     ${user.email}`);
    created.push(user);
  }

  return created;
}

// ── Lockers ───────────────────────────────────────────────────────────────────

const KIOSK_ID = "KIOSK-001";

const LOCKERS = [
  { lockerNumber: "1", size: LockerSize.MEDIUM },
  { lockerNumber: "2", size: LockerSize.MEDIUM },
  { lockerNumber: "3", size: LockerSize.LARGE },
  { lockerNumber: "4", size: LockerSize.SMALL },
];

async function seedLockers() {
  for (const l of LOCKERS) {
    const locker = await prisma.locker.upsert({
      where: { lockerNumber: l.lockerNumber },
      update: {},
      create: {
        lockerNumber: l.lockerNumber,
        kioskId: KIOSK_ID,
        size: l.size,
        status: LockerStatus.AVAILABLE,
        isOperational: true,
      },
    });
    log(`  ✓ Locker #${locker.lockerNumber}  (${locker.size})`);
  }
}

// ── Kiosk config ──────────────────────────────────────────────────────────────

async function seedKioskConfig() {
  const config = await prisma.kioskConfig.upsert({
    where: { kioskId: KIOSK_ID },
    update: {},
    create: {
      kioskId: KIOSK_ID,
      config: {
        door_open_duration_ms: 5000,
        actuator_extend_duration_ms: 3000,
        actuator_retract_duration_ms: 3000,
        capture_delay_ms: 1500,
        num_capture_frames: 3,
        face_detection_timeout_ms: 15000,
        solenoid_pins: {
          locker_1: { main_door: 17, trapdoor: 27, bottom_door: 22 },
          locker_2: { main_door: 23, trapdoor: 24, bottom_door: 25 },
          locker_3: { main_door: 5, trapdoor: 6, bottom_door: 13 },
          locker_4: { main_door: 19, trapdoor: 26, bottom_door: 21 },
        },
        actuator_pins: {
          locker_1: { extend: 16, retract: 20 },
          locker_2: { extend: 12, retract: 7 },
          locker_3: { extend: 8, retract: 11 },
          locker_4: { extend: 9, retract: 10 },
        },
        camera_indices: {
          item_camera_1: 0,
          item_camera_2: 1,
          face_camera: 2,
        },
      },
    },
  });

  log(`  ✓ KioskConfig ${config.kioskId}`);
}

// ── Sample items ──────────────────────────────────────────────────────────────

async function seedItems(ownerIds: string[]) {
  if (ownerIds.length === 0) return;

  const items = [
    {
      ownerId: ownerIds[0],
      title: "Casio FX-991ES Plus Scientific Calculator",
      description:
        "Brand new scientific calculator, perfect for Engineering Math and Physics. 417 functions, natural display, solar+battery.",
      category: ItemCategory.ACADEMIC_TOOLS,
      condition: ItemCondition.LIKE_NEW,
      pricePerDay: 25,
      pricePerWeek: 120,
      pricePerMonth: 400,
      securityDeposit: 500,
      campusLocation: "UCLM Lapu-Lapu Campus",
      images: [
        "https://placehold.co/600x400?text=Calculator+Front",
        "https://placehold.co/600x400?text=Calculator+Back",
      ],
    },
    {
      ownerId: ownerIds[1] ?? ownerIds[0],
      title: "Arduino Uno R3 Starter Kit",
      description:
        "Complete Arduino Uno R3 kit with breadboard, jumper wires, resistors, LEDs, and sensors. Great for ECE lab projects.",
      category: ItemCategory.DEVELOPMENT_KITS,
      condition: ItemCondition.GOOD,
      pricePerDay: 50,
      pricePerWeek: 250,
      pricePerMonth: 800,
      securityDeposit: 1200,
      campusLocation: "UCLM Lapu-Lapu Campus",
      images: [
        "https://placehold.co/600x400?text=Arduino+Kit",
        "https://placehold.co/600x400?text=Arduino+Components",
      ],
    },
    {
      ownerId: ownerIds[2] ?? ownerIds[0],
      title: "Anker 20000mAh Power Bank",
      description:
        "High-capacity power bank, charges two devices simultaneously. Great for all-day fieldwork or lab sessions.",
      category: ItemCategory.ELECTRONICS,
      condition: ItemCondition.GOOD,
      pricePerDay: 30,
      pricePerWeek: 150,
      pricePerMonth: 500,
      securityDeposit: 800,
      campusLocation: "UCLM Mandaue Campus",
      images: ["https://placehold.co/600x400?text=Power+Bank"],
    },
    {
      ownerId: ownerIds[0],
      title: "Lab Gown (Medium)",
      description:
        "Clean white lab gown, size Medium. Required for Chemistry and Physics lab classes. Laundered after each rental.",
      category: ItemCategory.SCHOOL_ATTIRE,
      condition: ItemCondition.GOOD,
      pricePerDay: 20,
      pricePerWeek: 80,
      pricePerMonth: 250,
      securityDeposit: 200,
      campusLocation: "UCLM Lapu-Lapu Campus",
      images: ["https://placehold.co/600x400?text=Lab+Gown"],
    },
  ];

  for (const item of items) {
    const exists = await prisma.item.findFirst({
      where: { title: item.title, ownerId: item.ownerId },
    });

    if (!exists) {
      const created = await prisma.item.create({
        data: { ...item, images: item.images as never },
      });
      log(`  ✓ Item        "${created.title}"`);
    } else {
      log(`  · Item        "${item.title}" (already exists, skipped)`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log("\n🌱 EngiRent Hub — Database Seed\n");

  log("👤 Users");
  await seedAdmin();
  const students = await seedStudents();

  log("\n🔒 Lockers");
  await seedLockers();

  log("\n⚙️  Kiosk Config");
  await seedKioskConfig();

  log("\n📦 Sample Items");
  await seedItems(students.map((s) => s.id));

  log("\n✅ Seed complete!\n");
  log("─────────────────────────────────────────────");
  log(`Admin email:    ${process.env.ADMIN_EMAIL ?? "admin@engirent.edu.ph"}`);
  log(`Admin password: ${process.env.ADMIN_PASSWORD ?? "EngiRent@2025!"}`);
  log(`Student password (all): ${STUDENT_PASSWORD}`);
  log("─────────────────────────────────────────────\n");
}

main()
  .catch((err) => {
    process.stderr.write(`\n❌ Seed failed: ${String(err)}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
