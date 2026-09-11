import { resolveFaceSubject } from "../faceVerificationService";

/**
 * E4.6 / failure mode F5.
 *
 * Once the actuator has dropped an item into the lower compartment it belongs
 * to the OWNER again, whatever the rental status says. The dangerous case is a
 * DISPUTED or CANCELLED rental: it still has a renter, and under the old
 * status-only rule that renter would face-match their way into a bottom door
 * holding an item the system had just taken back off them.
 *
 * The subject is derived from the rental's own columns, never from anything the
 * kiosk or phone sends — same principle as the original deposit/claim rule.
 */
const OWNER = {
  profileImage: "users/owner/face.jpg",
  faceEncoding: null,
};
const RENTER = {
  profileImage: "users/renter/face.jpg",
  faceEncoding: null,
};

function rental(over: Record<string, unknown> = {}) {
  return {
    status: "DEPOSITED",
    ownerId: "owner-1",
    renterId: "renter-1",
    releaseRequestedAt: null as Date | null,
    retrievedAt: null as Date | null,
    owner: OWNER,
    renter: RENTER,
    ...over,
  };
}

describe("resolveFaceSubject — the original rule still holds", () => {
  it("a deposit is the owner", () => {
    expect(resolveFaceSubject(rental({ status: "AWAITING_DEPOSIT" })).userId).toBe("owner-1");
  });

  it.each(["DEPOSITED", "ACTIVE", "VERIFICATION"])("%s is the renter", (status) => {
    expect(resolveFaceSubject(rental({ status })).userId).toBe("renter-1");
  });
});

describe("F5 — a released item belongs to the owner, whatever the status says", () => {
  const released = { releaseRequestedAt: new Date("2026-09-12T10:00:00Z") };

  it.each(["DISPUTED", "CANCELLED", "VERIFICATION", "DEPOSITED"])(
    "%s with a release in flight resolves to the OWNER",
    (status) => {
      const subject = resolveFaceSubject(rental({ status, ...released }));
      expect(subject.userId).toBe("owner-1");
    },
  );

  it("the renter cannot open a bottom door holding an item taken back off them", () => {
    // The concrete attack this closes: a rejected return leaves the rental
    // DISPUTED with the renter still attached. Without the retrieval check the
    // subject would be the renter.
    const subject = resolveFaceSubject(rental({ status: "DISPUTED", ...released }));
    const renterSubject = resolveFaceSubject(rental({ status: "DISPUTED" }));
    expect(subject.userId).not.toBe("renter-1");
    // The reference photo the ML service will compare against must also be the
    // owner's — a correct userId with the renter's face would still pass.
    expect(subject.referenceFaceUrl).not.toBe(renterSubject.referenceFaceUrl);
    expect(subject.referenceFaceUrl).not.toBe("");
  });

  it("reverts to the status rule once the item has been collected", () => {
    const subject = resolveFaceSubject(
      rental({ status: "ACTIVE", ...released, retrievedAt: new Date() }),
    );
    expect(subject.userId).toBe("renter-1");
  });

  it("treats a rental with no retrieval columns exactly as before", () => {
    // Callers that select a narrower shape must not silently become owner-only.
    const narrow = { status: "ACTIVE", ownerId: "owner-1", renterId: "renter-1", owner: OWNER, renter: RENTER };
    expect(resolveFaceSubject(narrow).userId).toBe("renter-1");
  });
});
