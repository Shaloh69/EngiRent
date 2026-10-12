# SPEC — Concerns v2: hidden damage, more than one kind of dispute, real evidence

> **Status: PROPOSAL, NOT BUILT.** Written 2026-10-13 from the user's request ("an owner can hand over an item
> that is broken in a way the camera cannot see; a renter can return one; the concern button vanishes the moment
> the return is approved; evidence must be video, images and a full written account"). Nothing here is
> implemented. Section 6 lists the decisions the user must make before any build starts (G2).
>
> **Written for:** the user (to rule on section 6) and whoever builds it next.

## 1. What exists today (re-derived from the code, 2026-10-13)

- **One concern button**, "Raise a concern about this return", on the rental detail screen
  (`rental_detail_screen.dart`), shown only while `status == VERIFICATION` and the return is not yet approved.
  `POST /rentals/:id/dispute` (`rentalController.fileDispute`) puts the return check into MANUAL_REVIEW, appends
  "Concern raised by the owner/renter: …" to the check's notes and notifies every admin. **Text only, no photos,
  no video, no case, no answer from the other party.** The button stays after sending (each press adds another
  note and notifies the admins again).
- **One kind of dispute case** (Dispute v2): the WRONG item came back, opened only by an admin's Reject at the
  return check. Fees, deadline, restriction, kiosk payment, letters. Nothing for a damaged item, and nothing a
  student can open.
- **Money timing:** the renter's deposit is refunded the moment a return is APPROVED
  (`returnApprovalService.approveReturn` → `finalizeRentalCompletion`), before the owner has even collected the
  item, so an owner who finds hidden damage after collecting has no deposit left to claim from.
- **Uploads:** `video/mp4` is already an allowed type, but the live limit is **10 MB per file** (`MAX_FILE_SIZE`),
  too small for most phone videos.

## 2. Why the button "does not show properly" (bugs found 2026-10-13, independent of this proposal)

1. **The rental screen does not refresh when a return is checked.** It reloads on payment and deposit events and
   on reconnect, but NOT on `return:under_review`, `return:approved` or `return:disputed`. A screen left open keeps
   whatever it showed: the button stays after the admin approves, or never appears when the return goes to review,
   until the user leaves and comes back.
2. **The owner is never told a return was approved.** `return:approved` is sent to the renter only
   (`returnApprovalService.ts`), so even a refreshing screen would not refresh on the owner's phone.
3. **A refused concern shows the wrong error.** The app reads `message` from the reply, the server sends `error`,
   so a late press shows "Could not file dispute." instead of the real reason.

Fix (small, can ship before the rest): the screen reloads on any event for its rental; `return:approved` also goes
to the owner; the error toast reads `error`; after sending a concern the button becomes a "Concern sent, waiting
for an admin" status line.

## 3. The proposal: one "Report a problem" flow, four kinds of case

Every report becomes a **case** (the Dispute v2 record gains a `kind`), so it gets one place for the timeline,
evidence, messages, the admin's decision and the notifications: never again a free-text note on a check.

| Kind | Who reports | When the button shows | Typical example |
|---|---|---|---|
| **WRONG_ITEM** (exists) | the admin opens it (Reject at the return check) | — | a different item came back |
| **DEFECT_ON_RECEIPT** (new) | the RENTER | from pickup until **N hours** after pickup (proposed 24 h) | the calculator does not turn on; a part is missing; not as described |
| **DAMAGE_ON_RETURN** (new) | the OWNER | from the moment the return is approved until **M hours** after the owner collects (proposed 24 h) | screen cracked inside the case; does not power on any more |
| **RETURN_CHECK_CONCERN** (today's button, upgraded) | either party | while the return is being checked | "that is not my item" / "I returned it in good condition" |

A report requires **evidence** (section 4). While a case is open the button is replaced by its status
("Report sent: waiting for the owner's reply / an admin"), so it cannot be sent twice.

### 3a. DEFECT_ON_RECEIPT (renter → early return and refund)

1. The renter reports within the window, with evidence. The rental clock for late fees pauses.
2. The **owner** is told and may reply with their own statement and evidence within **24 h** (proposed).
3. An **admin** decides:
   - **Upheld:** the renter returns the item at the kiosk (normal return flow, but no late fee), then gets the
     **deposit back in full** plus a **rent refund** (rule in section 6, Q3). The owner's payout is reduced to
     match, the listing is **paused** until the owner tells an admin it is fixed (Profile > Send Feedback; the admin
     lists it again from Items; there is no self-service "fixed" button, corrected 2026-10-13 in C5), and the case is recorded on the owner.
   - **Not upheld:** the rental carries on as booked; the clock resumes; the renter is told why.

### 3b. DAMAGE_ON_RETURN (owner → charge for hidden damage)

1. The owner reports within the window, with evidence (ideally recorded when they open the locker).
2. The **renter** is told and may reply with their own evidence within **24 h**.
3. An **admin** decides:
   - **Upheld:** an amount the admin sets (up to the item's replacement value) is taken **from the held deposit
     first** (section 6, Q2); anything above the deposit becomes an amount owed through the existing Dispute v2
     machinery (restricted account, pay at the kiosk or online, reminders, letters).
   - **Not upheld:** nothing is charged; the deposit is released.

### 3c. RETURN_CHECK_CONCERN (today's button, kept, with evidence)

Same timing as today, but with evidence, a status line instead of a re-sendable button, and the other party told.
If the admin then approves the return, the owner's DAMAGE_ON_RETURN window opens, so "approved" no longer means
"too late to object".

## 4. Evidence

- **A written account**, required: at least 50 characters, up to 2,000 ("what is wrong, when you noticed it").
- **Photos**, required: 1 to 5.
- **A video**, required for DEFECT_ON_RECEIPT and DAMAGE_ON_RETURN (proposed, section 6 Q5): up to **30 s**,
  recorded in the app (not picked from the gallery, so it is fresh), compressed on the phone to roughly 720p so it
  stays under the upload limit. The server's limit is raised for this endpoint only (proposed 40 MB), not globally.
- **Privacy:** stored privately (`storage/cases/{caseId}/…`), served only through short-lived signed links, visible
  to the two parties of that rental and to admins; never public, never in the repo.
- The admin console shows a timeline with every statement, the photos, a video player, the locker photos already on
  file, and the decision buttons for that kind of case.

## 5. Build order (each step shippable and checkable on its own)

1. **The visibility fixes** of section 2 (phone + one server line). Release.
2. **Data:** `Dispute.kind`, an evidence table (statement, photos, video, who, when), windows on the rental.
   Additive schema only.
3. **Evidence upload** endpoint (photos + one video, size and type checks, private storage) + phone capture screen
   (camera, 30 s video, compression, progress, retry).
4. **DEFECT_ON_RECEIPT** end to end (phone report, owner reply, admin decision, refund, listing pause).
5. **Deposit hold** + **DAMAGE_ON_RETURN** end to end.
6. **RETURN_CHECK_CONCERN** moved onto the same flow.
7. Test cases added to the thesis document; full release.

Steps 4-5 move money, so they are tested with mocks first and on the live system only with a fixture rental.

## 6. Decisions needed from the user before building

1. **Windows.** Renter may report a defect until how long after pickup? Owner may report damage until how long
   after collecting? (Proposed: 24 h and 24 h.)
2. **Deposit hold.** To make DAMAGE_ON_RETURN payable, keep the renter's deposit until the owner's window closes
   (renter gets it back up to ~24 h later than today)? Or keep today's instant refund and collect any damage as an
   amount owed (restricted account, kiosk payment)? (Proposed: hold it.)
3. **Refund when a defect is upheld.** Full rent back if reported within the first few hours of pickup (proposed
   3 h), otherwise the unused days back? Deposit back in full either way.
4. **Damage amount.** Admin sets it, capped at the replacement value; deposit first, the rest owed? (Proposed: yes.)
5. **Video.** Required for the two damage kinds, or optional with photos required? (Proposed: required, 30 s.)
6. **Other party's reply.** Give the other student 24 h to answer with their own evidence before the admin decides?
   (Proposed: yes; the admin may decide earlier if the evidence is clear.)
7. **Repeat offenders.** After how many upheld cases is an owner's listing (or a renter's account) reviewed?
   (Proposed: 2 in 90 days.)
