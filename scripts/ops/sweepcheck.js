// sweepcheck.js — READ-ONLY. Runs on the server from server/node_server (needs
// its @prisma/client). Prints counts only: no row contents, no credentials.
//
// Why it exists: Node runs the E4.6 hourly retrieval sweep, which can issue
// drop_item — a physical actuator stroke (G11). Restarting Node while a
// release is requested but not yet completed could interrupt a retrieval
// mid-flight, so the caller refuses when IN_FLIGHT > 0.
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const lockers = await p.locker.groupBy({ by: ["status"], _count: true });
  const rentals = await p.rental.groupBy({ by: ["status"], _count: true });
  const inFlight = await p.rental.count({ where: { releaseRequestedAt: { not: null }, releasedAt: null } });
  console.log("LOCKERS " + JSON.stringify(lockers.map((r) => [r.status, r._count])));
  console.log("RENTALS " + JSON.stringify(rentals.map((r) => [r.status, r._count])));
  console.log("IN_FLIGHT " + inFlight);
  await p.$disconnect();
})().catch((e) => {
  console.error("ERR " + e.message);
  process.exit(1);
});
