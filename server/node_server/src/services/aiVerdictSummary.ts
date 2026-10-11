/**
 * Ruling 15 (2026-10-11) — the AI's verdict in plain words.
 *
 * The admin's Condition Checks modal showed a score (77.87) and a handful of
 * raw numbers; the renter and the owner saw nothing at all. This turns the
 * stored v2 evidence into sentences a student can read: what the camera saw
 * and why the score is what it is. Pure: it reads only what it is given.
 *
 * The thresholds below are the WORDING bands, not decision thresholds; they
 * change nothing about how an item is judged. They were set against the
 * training spread in `fusion_params.json` (identity mean 0.35, sd 0.27) and the
 * one real hard negative, D-112's lookalike (identity 0.625, same-kind 0.906),
 * which reads here as "its shape only loosely matches".
 *
 * Colour NAMES appear only when the ML service reported them
 * (`listing_colours` / `locker_colours`); otherwise the colour sentence uses
 * the overlap number alone. It never invents a colour.
 */

export interface StoredEvidence {
  pipeline?: string;
  decision?: string;
  confidence?: number;
  message?: string | null;
  placement?: { verdict?: string; message?: string } | null;
  reposition?: boolean;
  qualityBlocked?: boolean;
  evidence?: Record<string, unknown> | null;
}

export interface VerdictInput {
  itemTitle: string;
  score: number | null | undefined;
  /** The fast check stored on the row. */
  mlEvidence?: StoredEvidence | null;
  /** The full run's details (`deepReviewDetails`), when it ran. */
  deepReviewDetails?: { evidence?: StoredEvidence | null } | null;
  deepReviewScore?: number | null;
  unavailable?: boolean;
  unavailableReason?: string | null;
  /** The admin's decision, when one was made: APPROVED or REJECTED. */
  adminDecision?: string | null;
}

export interface PlainVerdict {
  /** One line: "Not a match: ...". */
  headline: string;
  /** The individual observations, each a full sentence. */
  points: string[];
  /** Which run the words come from. */
  source: "full" | "quick" | "none";
  /** The score the words describe, if any. */
  score: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const listJoin = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

function colourList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 3);
}

const PLACEMENT_WORDS: Record<string, string> = {
  EMPTY: "The camera could not see any item in the locker.",
  MULTIPLE: "The camera saw more than one object in the locker.",
  TRUNCATED: "The item was partly out of the camera's view.",
  OFF_CENTER: "The item was placed far from the centre of the locker.",
  UNSEEN: "The locker was too dark for the camera to see.",
};

export function shapeWords(identity: number): string {
  if (identity >= 0.85) return "its shape and details closely match the listing photos";
  if (identity >= 0.7) return "its shape resembles the listing photos";
  if (identity >= 0.5) return "its shape only loosely matches the listing photos";
  return "its shape does not match the listing photos";
}

export function kindWords(sameKind: number, title: string): string {
  if (sameKind >= 0.85) return `it reads as the same kind of object as the ${title}`;
  if (sameKind >= 0.6) return `it may be a similar kind of object to the ${title}`;
  return `it reads as a different kind of object from the ${title}`;
}

export function colourWords(overlap: number, locker: string[], listing: string[]): string {
  const named = locker.length > 0 && listing.length > 0;
  const seen = named ? `the item is ${listJoin(locker)} and the listing is ${listJoin(listing)}` : "";
  if (overlap >= 0.6) return named ? `the colours match (${seen})` : "the colours match the listing";
  if (overlap >= 0.35) return named ? `the colours only partly match (${seen})` : "the colours only partly match the listing";
  return named ? `the colours are clearly different: ${seen}` : "the colours are clearly different from the listing";
}

/**
 * Build the plain-language verdict. Prefers the full run's evidence (every
 * stage ran) over the quick check's.
 */
export function plainVerdict(input: VerdictInput): PlainVerdict {
  const title = input.itemTitle || "listed item";
  const full = input.deepReviewDetails?.evidence ?? null;
  const quick = input.mlEvidence ?? null;
  const chosen = full?.evidence ? full : quick;
  const source: PlainVerdict["source"] = chosen === full && full ? "full" : chosen ? "quick" : "none";
  const score =
    source === "full" ? (num(input.deepReviewScore) ?? num(full?.confidence)) : (num(input.score) ?? num(quick?.confidence));

  const points: string[] = [];

  if (input.unavailable && source === "none") {
    return {
      headline: "No AI verdict: the check could not run.",
      points: [
        input.unavailableReason === "ml_unreachable"
          ? "The AI service was unreachable at the time, so a person must compare the photos."
          : "The photos could not be compared, so a person must check them.",
      ],
      source,
      score: null,
    };
  }

  const placementVerdict = chosen?.placement?.verdict;
  if (placementVerdict && PLACEMENT_WORDS[placementVerdict]) points.push(PLACEMENT_WORDS[placementVerdict]);

  const ev = (chosen?.evidence ?? {}) as Record<string, unknown>;
  const identity = num(ev.dino_max);
  const sameKind = num(ev.sem_bc);
  const colour = num(ev.colour);
  const lockerColours = colourList(ev.locker_colours);
  const listingColours = colourList(ev.listing_colours);

  const clauses: string[] = [];
  if (colour !== null && (colour < 0.6 || lockerColours.length > 0)) {
    clauses.push(colourWords(colour, lockerColours, listingColours));
  }
  if (identity !== null) clauses.push(shapeWords(identity));
  if (sameKind !== null) clauses.push(kindWords(sameKind, title));
  for (const c of clauses) points.push(c.charAt(0).toUpperCase() + c.slice(1) + ".");

  if (score !== null) {
    points.push(`The AI's overall score was ${score.toFixed(1)} out of 100 (85 or more passes on its own).`);
  }
  if (colour !== null && colour < 0.35 && score !== null && score >= 60) {
    points.push(
      "The AI's score gives colour very little weight, which is why a person reviews every return the AI is unsure about.",
    );
  }

  let verdictWord: string;
  if (input.adminDecision === "REJECTED") verdictWord = "Not a match";
  else if (input.adminDecision === "APPROVED") verdictWord = "Confirmed match";
  else if (score === null) verdictWord = "Needs a person to check";
  else if (score >= 85) verdictWord = "Likely a match";
  else if (score >= 60) verdictWord = "Uncertain";
  else verdictWord = "Likely not a match";

  const top = clauses.slice(0, 3);
  const lead =
    top.length === 0
      ? ""
      : top.length <= 2
        ? `${top.join(", and ")}.`
        : `${top.slice(0, -1).join(", ")}, and ${top[top.length - 1]}.`;
  const headline = lead ? `${verdictWord}: ${lead}` : `${verdictWord}.`;

  return { headline, points, source, score };
}
