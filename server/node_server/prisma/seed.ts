import {
  PrismaClient,
  UserRole,
  LockerSize,
  LockerStatus,
  ItemCategory,
  ItemCondition,
  RentalStatus,
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
  const studentId = process.env.ADMIN_STUDENT_ID ?? "ADMIN-001";

  // SECURITY, 2026-09-06. This used to be
  //   process.env.ADMIN_PASSWORD ?? "<a hardcoded literal>"
  // and this repository is PUBLIC on GitHub, so that default was a published
  // administrator password. It was confirmed live against the deployment:
  // it authenticated as ADMIN, which is read/write access to every student's
  // ID and face media, the payment-approval endpoint, and the kiosk relay
  // commands that drive real solenoids.
  //
  // There is no safe default for this value, so there is no default. An
  // unset ADMIN_PASSWORD stops the seed rather than quietly creating an
  // account whose password anybody can look up.
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error(
      "ADMIN_PASSWORD must be set (12+ characters) before seeding. " +
        "Refusing to create an administrator with a default password: this " +
        "repository is public, so any hardcoded value is a published credential.",
    );
  }

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

  // Never log the password. The seed runs from svc-node.bat, whose stdout is
  // captured into D:\ENG\startbat-logs — printing it here moved the secret
  // from the environment into a file on disk that nothing rotates.
  log(`  ✓ Admin       ${admin.email}`);
  return admin;
}

// ── Sample students ───────────────────────────────────────────────────────────

// Sample-data password. Same reasoning as the admin above, with one
// difference: these accounts are fixtures, so a known password is the point.
// The guard is that they must never be seeded into a real deployment — see
// main(), which refuses under NODE_ENV=production.
const STUDENT_PASSWORD = process.env.SEED_STUDENT_PASSWORD ?? "Student@2025!";

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
      // profileComplete/biometricConsentAt set directly here rather than via
      // the real /auth/register-face + /auth/id-photo + /auth/profile/complete
      // flow — that flow needs a live ML service and real photos, which
      // seed data doesn't have. Fine for dev/test seeding: the point is a
      // usable account past the _AuthGuard profile-setup gate, not a test
      // of the biometric pipeline itself.
      update: { profileComplete: true, biometricConsentAt: new Date() },
      create: {
        ...s,
        password: hashed,
        role: UserRole.STUDENT,
        isVerified: true,
        isActive: true,
        profileComplete: true,
        biometricConsentAt: new Date(),
      },
    });
    log(`  ✓ Student     ${user.email}`);
    created.push(user);
  }

  return created;
}

// ── Lockers ───────────────────────────────────────────────────────────────────

/**
 * The identity the REAL deployed kiosk registers itself with (its `KIOSK_ID`
 * env var, sent on `kiosk:register`). Socket.io room membership is an exact
 * string match, so this value is load-bearing: `Locker.kioskId` read
 * "kiosk-1" until 2026-09-03, which meant every door command — and now every
 * `kiosk:occupancy` push (D-53) — went to a room nobody was in, while the API
 * reported success and nothing physically happened. It was fixed directly in
 * the live DB; this line is what stopped a fresh seed from recreating it.
 */
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

// -- Kiosk config: DELETED (D-54) ------------------------------------------

/**
 * `seedKioskConfig` was removed on 2026-09-11 (D-54, ruled by the user) and is
 * deliberately not replaced. **Do not write another one without reading this.**
 *
 * It upserted a hardware schema that had been obsolete for months: `trapdoor`
 * solenoid pins (the trapdoor was removed from the design), `pwm` actuator pins
 * (the actuators are relay on/off - there is no PWM circuit), GPIO numbers
 * matching nothing in the real `config.py`, 3 cameras where there are 5, and
 * 5s/3s timings against the real hand-calibrated 15s doors and 22/21/17/23s
 * actuators. The identical row was found in the live database and deleted on
 * 2026-09-03 for exactly that reason.
 *
 * It was harmless only because it was keyed "kiosk-1" while the real kiosk
 * registers as "KIOSK-001" - the same mismatch that made every door command
 * vanish into an empty room. Repointing that key at KIOSK_ID, which is what
 * "fix the typo" looks like from a diff, would have made a `prisma db seed`
 * upsert the obsolete payload onto the real kiosk's config row, which
 * `index.ts`'s `kiosk:register` handler pushes to the Pi on every connect.
 *
 * **The Pi's own `server/kiosk/kiosk_config.json` is the source of truth for
 * per-locker timings** (`CLAUDE.md`: hand-calibrated, verified twice against
 * real hardware, and where an animation and a hardware value disagree the
 * hardware is right). The live DB has held ZERO `KioskConfig` rows since
 * 2026-09-03 and the kiosk works, because with no stored config the server
 * pushes nothing and the Pi keeps its local file. Seeding nothing here is not
 * a gap - it is the fix.
 *
 * Any future seed would have to be GENERATED from the Pi's calibrated file,
 * never hand-written, and would still be a hardware-calibration change that
 * needs a ruling.
 */

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

// ── Sample rentals (+ notifications) ──────────────────────────────────────────
// One rental per lifecycle status the Phone App actually needs to render —
// gives the Rentals tab / Rental Detail screen real, varied content instead
// of an empty state.

async function seedRentals(students: { id: string }[]) {
  if (students.length < 2) return;
  const [renter, owner] = students;

  const items = await prisma.item.findMany({ where: { ownerId: owner.id } });
  if (items.length === 0) return;

  const now = new Date();
  const day = 24 * 60 * 60 * 1000;

  const scenarios: {
    status: RentalStatus;
    startOffsetDays: number;
    endOffsetDays: number;
    extra?: Record<string, unknown>;
  }[] = [
    { status: RentalStatus.PENDING, startOffsetDays: 1, endOffsetDays: 4 },
    { status: RentalStatus.AWAITING_DEPOSIT, startOffsetDays: 0, endOffsetDays: 3 },
    {
      status: RentalStatus.ACTIVE,
      startOffsetDays: -2,
      endOffsetDays: 5,
      extra: { depositedAt: new Date(now.getTime() - 2 * day) },
    },
    {
      status: RentalStatus.COMPLETED,
      startOffsetDays: -10,
      endOffsetDays: -3,
      extra: {
        depositedAt: new Date(now.getTime() - 10 * day),
        completedAt: new Date(now.getTime() - 3 * day),
      },
    },
  ];

  for (let i = 0; i < scenarios.length; i++) {
    const item = items[i % items.length];
    const scenario = scenarios[i];

    const exists = await prisma.rental.findFirst({
      where: { itemId: item.id, renterId: renter.id, status: scenario.status },
    });
    if (exists) {
      log(`  · Rental      ${item.title} (${scenario.status}, already exists, skipped)`);
      continue;
    }

    const rental = await prisma.rental.create({
      data: {
        itemId: item.id,
        renterId: renter.id,
        ownerId: owner.id,
        startDate: new Date(now.getTime() + scenario.startOffsetDays * day),
        endDate: new Date(now.getTime() + scenario.endOffsetDays * day),
        status: scenario.status,
        totalPrice: item.pricePerDay * 3,
        securityDeposit: item.securityDeposit,
        ...scenario.extra,
      },
    });
    log(`  ✓ Rental      ${item.title} → ${rental.status}`);

    if (scenario.status === RentalStatus.ACTIVE) {
      await prisma.notification.create({
        data: {
          userId: renter.id,
          title: "Rental Active",
          message: `Your rental of ${item.title} is now active. Return by ${rental.endDate.toLocaleDateString("en-PH")}.`,
          type: "RENTAL_STARTED",
          relatedEntityId: rental.id,
          relatedEntityType: "rental",
        },
      });
    } else if (scenario.status === RentalStatus.COMPLETED) {
      await prisma.notification.create({
        data: {
          userId: renter.id,
          title: "Rental Completed",
          message: `Your rental of ${item.title} is complete. Leave a review?`,
          type: "REVIEW_REQUEST",
          relatedEntityId: rental.id,
          relatedEntityType: "rental",
        },
      });
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log("\n🌱 EngiRent Hub — Database Seed\n");

  log("👤 Users");
  await seedAdmin();

  // Fixture students carry a known shared password. Creating them on a
  // deployment that has real users would add real login-capable accounts
  // whose credentials are in a public repo.
  if (process.env.NODE_ENV === "production" && !process.env.SEED_ALLOW_FIXTURES) {
    throw new Error(
      "Refusing to seed fixture students under NODE_ENV=production. " +
        "Set SEED_ALLOW_FIXTURES=1 if this really is a throwaway environment.",
    );
  }

  const students = await seedStudents();

  log("\n🔒 Lockers");
  await seedLockers();

  log("\n📦 Sample Items");
  await seedItems(students.map((s) => s.id));

  log("\n📄 Sample Rentals");
  await seedRentals(students);

  log("\n✅ Seed complete!\n");
  log("─────────────────────────────────────────────");
  log(`Admin email:    ${process.env.ADMIN_EMAIL ?? "admin@engirent.edu.ph"}`);
  log("Admin password: (the ADMIN_PASSWORD you supplied - not printed)");
  log("Student password (all): the SEED_STUDENT_PASSWORD you supplied, or");
  log("  the fixture default in this file. Fixtures only - never production.");
  log("─────────────────────────────────────────────\n");
}

main()
  .catch((err) => {
    process.stderr.write(`\n❌ Seed failed: ${String(err)}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
