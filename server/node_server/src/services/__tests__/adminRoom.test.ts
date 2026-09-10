import {
  ADMIN_ROOM,
  canJoinAdminRoom,
  notifyAdmins,
} from "../adminRoom";

// E2.2 / D-14.
//
// Two defects share one fix. The four `admin:*` kiosk-telemetry events were
// sent with `io.emit(...)`, which is a broadcast to EVERY connected socket —
// including every student's phone — and nothing consumed them, because the
// admin console has no socket.io client at all. So 4 of 21 socket events were
// simultaneously over-delivered and unconsumed.
//
// Extracted into a service rather than tested through index.ts, because
// importing index.ts boots the HTTP and socket.io servers — the same reason
// D-18's fix moved runMlVerification out.

describe("canJoinAdminRoom — who is allowed to hear kiosk telemetry", () => {
  it("admits an authenticated ADMIN", () => {
    expect(canJoinAdminRoom({ kind: "user", role: "ADMIN" })).toBe(true);
  });

  // A reviewer works the verification and feedback queues, which are exactly
  // the queues this room exists to keep live.
  it("admits an authenticated REVIEWER", () => {
    expect(canJoinAdminRoom({ kind: "user", role: "REVIEWER" })).toBe(true);
  });

  it("refuses a student", () => {
    expect(canJoinAdminRoom({ kind: "user", role: "STUDENT" })).toBe(false);
  });

  it("refuses an anonymous socket", () => {
    expect(canJoinAdminRoom({ kind: "anon" })).toBe(false);
  });

  // A kiosk authenticates with the shared secret and has no role at all.
  // Without the `kind` check, `role === undefined` would fall through to
  // whatever the role comparison did.
  it("refuses a kiosk, which authenticates but has no role", () => {
    expect(canJoinAdminRoom({ kind: "kiosk", kioskId: "kiosk-1" })).toBe(false);
  });

  // The socket middleware sets `kind: "user"` only after verifying the JWT,
  // so a role without that kind means something built the object by hand.
  it("refuses a role claim that did not come with an authenticated user kind", () => {
    expect(canJoinAdminRoom({ role: "ADMIN" })).toBe(false);
    expect(canJoinAdminRoom({ kind: "anon", role: "ADMIN" })).toBe(false);
  });

  it("refuses an empty or missing socket data object", () => {
    expect(canJoinAdminRoom({})).toBe(false);
    expect(canJoinAdminRoom(undefined)).toBe(false);
  });
});

describe("notifyAdmins — telemetry goes to the room, never to everyone", () => {
  function makeIo() {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    return { io: { to, emit: jest.fn() }, to, emit };
  }

  it("emits to the admin room", () => {
    const { io, to, emit } = makeIo();
    notifyAdmins(io, "admin:verification_submitted", { user_id: "u1" });

    expect(to).toHaveBeenCalledWith(ADMIN_ROOM);
    expect(emit).toHaveBeenCalledWith("admin:verification_submitted", {
      user_id: "u1",
    });
  });

  // The whole point of D-14. A regression here silently starts pushing
  // admin-only payloads to every student's phone again, and nothing would
  // fail. Repointed from admin:kiosk_error to a QUEUE event by D-37 (b),
  // which removed kiosk telemetry from this socket entirely -- the guarantee
  // under test is notifyAdmins' room targeting, not any one event name, and
  // the stakes did not drop with the rename: a verification payload reaching
  // every phone leaks who is being reviewed.
  it("never calls the broadcast io.emit", () => {
    const { io, emit } = makeIo();
    notifyAdmins(io, "admin:verification_submitted", { user_id: "u1" });

    expect(io.emit).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalled();
  });

  it("is a no-op when no socket server is attached", () => {
    expect(() =>
      notifyAdmins(undefined, "admin:feedback_new", { id: "f1" }),
    ).not.toThrow();
    expect(() =>
      notifyAdmins(null, "admin:feedback_new", { id: "f1" }),
    ).not.toThrow();
  });
});
