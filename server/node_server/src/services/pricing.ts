import prisma from "../config/database";

/**
 * What a renter pays (user ruling 2026-10-21, PROGRESS.md "PHASE RENTER FEES"):
 *
 *   rent         = the owner's price per day × days       -> the OWNER, in full
 *   platform fee = platformFeePct % of the rent (default 2) -> EngiRent
 *   service fee  = a fixed amount ONCE per rental (default ₱10): pays the
 *                  PayMongo transfer that sends the owner their earnings
 *   total        = rent + platform fee + service fee
 *
 * Shown to students as "₱102/day + ₱10 service fee" for a ₱100/day item (the
 * platform fee is inside the daily price; the service fee is separate).
 * 1 day at ₱100 = ₱112. The deposit carries no fees. EngiRent absorbs
 * PayMongo's own fee on each payment. Rental.totalPrice stays the RENT: the
 * dispute caps, concern refunds and admin earnings all read it that way.
 */

export interface FeeSettings {
  platformFeePct: number;
  serviceFee: number;
}

export const DEFAULT_FEES: FeeSettings = { platformFeePct: 2, serviceFee: 10 };
export const MAX_PLATFORM_FEE_PCT = 20;
export const MAX_SERVICE_FEE = 100;

/** Money in pesos, rounded to whole centavos. */
export const r2 = (n: number): number => Math.round(n * 100) / 100;

/** The per-day price students see: the owner's price with the platform fee inside. */
export function displayPricePerDay(pricePerDay: number, fees: FeeSettings): number {
  return r2(pricePerDay * (1 + fees.platformFeePct / 100));
}

export interface Quote {
  rent: number;
  platformFee: number;
  serviceFee: number;
  total: number;
}

/** The full price of a booking, from the owner's daily price. */
export function quote(pricePerDay: number, days: number, fees: FeeSettings): Quote {
  const rent = r2(pricePerDay * days);
  const platformFee = r2((rent * fees.platformFeePct) / 100);
  const serviceFee = r2(fees.serviceFee);
  return { rent, platformFee, serviceFee, total: r2(rent + platformFee + serviceFee) };
}

/** The platform fee on an amount of rent (used for an extension's extra rent). */
export function platformFeeOn(rent: number, fees: FeeSettings): number {
  return r2((rent * fees.platformFeePct) / 100);
}

/** Admin input -> settings, or the reason it is refused. */
export function validateFees(input: { platformFeePct?: unknown; serviceFee?: unknown }): FeeSettings | string {
  const pct = Number(input.platformFeePct);
  const fee = Number(input.serviceFee);
  if (!Number.isFinite(pct) || pct < 0 || pct > MAX_PLATFORM_FEE_PCT) {
    return `The platform fee must be between 0 and ${MAX_PLATFORM_FEE_PCT}%.`;
  }
  if (!Number.isFinite(fee) || fee < 0 || fee > MAX_SERVICE_FEE) {
    return `The service fee must be between ₱0 and ₱${MAX_SERVICE_FEE}.`;
  }
  return { platformFeePct: r2(pct), serviceFee: r2(fee) };
}

/** The current settings (one row, id 1); the defaults until an admin saves some. */
export async function getFees(): Promise<FeeSettings> {
  const row = await prisma.feeConfig.findUnique({ where: { id: 1 } });
  return row ? { platformFeePct: row.platformFeePct, serviceFee: row.serviceFee } : DEFAULT_FEES;
}

export async function saveFees(fees: FeeSettings, adminId: string): Promise<FeeSettings> {
  const row = await prisma.feeConfig.upsert({
    where: { id: 1 },
    update: { ...fees, updatedById: adminId },
    create: { id: 1, ...fees, updatedById: adminId },
  });
  return { platformFeePct: row.platformFeePct, serviceFee: row.serviceFee };
}
