// Real, dated entries condensed from the project's own engineering log
// (repo root memory.md). No invented dates, no invented features — this is
// a public-facing rewrite of what memory.md already records in full detail,
// same rule the /blog page's project journal follows (§3.5 of the design
// mandate bans fabricated changelog/blog content).

export type ChangelogTag = "release" | "feature" | "fix" | "design" | "infra";

export interface ChangelogEntry {
  date: string; // ISO, real
  version?: string; // only set when the entry corresponds to an actual app version bump
  tag: ChangelogTag;
  title: string;
  bullets: string[];
}

export const changelog: ChangelogEntry[] = [
  {
    date: "2026-10-15",
    version: "1.15.4",
    tag: "fix",
    title: "Scanning always reaches the face check, and no false \"Update your face\"",
    bullets: [
      "If the app's live connection to the server dropped, a scan could go nowhere and the app kept waiting; it now reconnects before sending the scan and says plainly if it cannot",
      "After scanning, the screen now says \"Checking with the kiosk\" and that the locker opens only after your face check; it used to say \"Opening a locker\", which read as if the door opened first (it never did)",
      "Students who had already updated their face were asked to update it again after logging in; fixed on the server for every app version",
    ],
  },
  {
    date: "2026-10-15",
    version: "1.15.3",
    tag: "fix",
    title: "A more accurate face check, tuned on real test pictures",
    bullets: [
      "Fixed \"Remove your hat\" appearing on a bare head: dark hair or a hand on the head is no longer mistaken for a hat",
      "Fixed \"Turn your head further\" when you had turned enough, and a turn the wrong way now says which way to turn",
      "Blinking now works for different eye shapes and lighting, because it is compared with your own open eyes",
      "Fewer real faces are refused as \"a photo or a screen\"; steadier pictures are chosen so fewer tries fail",
    ],
  },
  {
    date: "2026-10-15",
    version: "1.15.2",
    tag: "fix",
    title: "Turning your head left is detected again",
    bullets: [
      "1.15.1 stopped recognising a turn to the left; this build fixes it, and the left and right checks now agree between the phone and the server",
    ],
  },
  {
    date: "2026-10-15",
    version: "1.15.1",
    tag: "fix",
    title: "A guide for the face check, and blinks and turns that are recognised",
    bullets: [
      "A friendly guide shows what to do next and says it in a bubble; the ring around your face pulses when ready, shivers if you are too far or too close, shows which way to turn, flashes green on each step and shakes red if a try is refused",
      "From the first real tests: blinks are now recognised even when your eyes only close for a moment, and a head turn is read from a moderate angle instead of a full side-on view that the camera could not use",
      "Left and right were reversed in 1.15.0 and are now correct",
      "Fewer real faces are wrongly refused as \"a photo or a screen\"",
    ],
  },
  {
    date: "2026-10-15",
    version: "1.15.0",
    tag: "feature",
    title: "A guided face check: blink and turn your head",
    bullets: [
      "The kiosk now checks it is really you: look at the camera, blink, and turn your head left and right, in an order the server picks each time",
      "A photo of a face, or a face on another phone's screen, is refused",
      "Glasses are fine. Caps, hats and hoods are refused with a clear message; a head covering that leaves your whole face visible, like a hijab, is fine",
      "Everyone updates their face once: tap \"Update your face with the new system now\" on the home screen. Until you do, the kiosk asks you to update first",
      "If your new face does not match the one on your account, you confirm with your password and an admin approves it before it works at the kiosk",
    ],
  },
  {
    date: "2026-10-14",
    version: "1.14.7",
    tag: "infra",
    title: "New server address after a restart",
    bullets: [
      "The server restarted and its address changed; this build has the new address built in",
      "Installed apps from 1.14.0 on find the new address by themselves, so updating is recommended but not required",
    ],
  },
  {
    date: "2026-10-13",
    version: "1.14.6",
    tag: "fix",
    title: "The AI's reason and the locker photo now show on a retry",
    bullets: [
      "When the locker's check asks you to move the item and try again, the app now shows why (for example, \"More than one object is in the locker\") and the photo the locker camera took",
      "Since 1.14.4 the server sent both, but the app counted the attempts one short and kept them hidden; found on a real return at the kiosk",
    ],
  },
  {
    date: "2026-10-13",
    version: "1.14.5",
    tag: "feature",
    title: "Report problems the locker camera cannot see",
    bullets: [
      "Renters can report an item that was broken or incomplete at pickup, within 24 hours; reported within 3 hours, the whole rent can come back",
      "Owners can report damage found after a return, within 24 hours of collecting it; the renter's deposit is held until then",
      "Each report needs a written statement, photos and, for damage, a short video recorded in the app; the other student can answer within 24 hours",
      "An admin compares both sides with the locker photos and decides how responsible each student is; both see the decision and the amounts in plain words",
      "Tapping a notification now opens its rental, and return dates and \"due\" labels now match your calendar",
    ],
  },
  {
    date: "2026-10-12",
    version: "1.14.4",
    tag: "feature",
    title: "See why the AI asked you to try again",
    bullets: [
      "When the check at the locker asks you to move the item or try again, the app now shows the AI's reason (for example, \"More than one object is in the locker\") instead of a generic message",
      "It also shows the photo the locker camera took, so you can see what the AI saw; tap a photo to enlarge it",
      "Only the student who placed the item sees these photos",
    ],
  },
  {
    date: "2026-10-12",
    version: "1.14.3",
    tag: "fix",
    title: "Times now match your clock",
    bullets: [
      "Chat messages showed the server's time (UTC) instead of yours, so a message sent at 11:00 PM appeared as 3:00 PM. Messages, account activity, notifications, payments, reviews and feedback now show your local time",
      "Rental start and end dates are unchanged",
    ],
  },
  {
    date: "2026-10-12",
    version: "1.14.2",
    tag: "fix",
    title: "No more request floods after a dropped connection",
    bullets: [
      "Each time the connection dropped and came back, the app sent more and more profile requests to the server, up to about two per second, until the server briefly refused everyone on the same network, admins included",
      "The app now asks once, however many times the connection flickers",
      "Also: the kiosk now retries sending the locker photos if the first try fails, so a weak Wi-Fi moment no longer leaves an item without an AI check",
    ],
  },
  {
    date: "2026-10-12",
    version: "1.14.1",
    tag: "feature",
    title: "Forgot password, and EngiRent can email you now",
    bullets: [
      "\"Forgot password?\" on the sign-in screen emails a 6-digit code to your account's address; it works once, for 15 minutes, and allows 5 tries",
      "Changing your password this way signs your other devices out and sends you an email saying it happened",
      "Dispute case updates and reminders now arrive by email as well as in the app",
    ],
  },
  {
    date: "2026-10-11",
    version: "1.14.0",
    tag: "release",
    title: "Disputes, guardians, and no more broken installs after a server restart",
    bullets: [
      "The app now looks up the server's current address every time it starts, so a server restart no longer needs a new download",
      "If a returned item is not the one you rented, an admin (never the AI alone) opens a dispute: the app shows the case, the deadline, the amount owed and how it grows, and what the AI saw, in plain words",
      "During a dispute your account is limited to the case: you pay at the kiosk before the locker opens, return the correct item, collect your own item any time, or ask for a review",
      "Every student now needs a parent or guardian on record, and agrees they and UCLM may be contacted if a dispute is not resolved",
      "Owners now enter an item's replacement value when listing; it caps what a dispute can ever charge",
      "Online payment through PayMongo is ready on the server; until it is switched on, payments are still confirmed by staff as before",
    ],
  },
  {
    date: "2026-10-09",
    version: "1.13.5",
    tag: "infra",
    title: "The app can reach the server again",
    bullets: [
      "The server was down after a restart on 2026-10-08 and came back on 2026-10-09 at a new address, so 1.13.4 could not connect",
      "This build points at the current address. Nothing else changed: it is the same app as 1.13.4",
    ],
  },
  {
    date: "2026-10-01",
    version: "1.13.4",
    tag: "infra",
    title: "The app can reach the server again",
    bullets: [
      "The server was down after a restart on 2026-09-28 and came back on 2026-10-01 at a new address, so 1.13.3 could not connect",
      "This build points at the current address. Nothing else changed: it is the same app as 1.13.3",
    ],
  },
  {
    date: "2026-09-25",
    version: "1.13.3",
    tag: "infra",
    title: "The app can reach the server again",
    bullets: [
      "The server restarted on the evening of 2026-09-25 and came back at a new address, so 1.13.2 could not connect",
      "This build points at the current address. Nothing else changed: it is the same app as 1.13.2",
    ],
  },
  {
    date: "2026-09-24",
    version: "1.13.2",
    tag: "feature",
    title: "Owners collect their item back before a rental is complete",
    bullets: [
      "When a return passes, the renter's security deposit refund goes out straight away, and the owner gets a “Collect Your Item from the Kiosk” button — the rental is only marked complete once the owner has opened the locker and taken the item back",
      "Found during a real test on 2026-09-24: a return approved in the evening was marked complete while the item was still sitting in the locker, and nothing ever told its owner to come and get it",
      "Only the renter can review the item now — the owner was being offered a review of their own listing",
    ],
  },
  {
    date: "2026-09-24",
    version: "1.13.1",
    tag: "infra",
    title: "The app can reach the server again",
    bullets: [
      "After the server came back from a power cut on 2026-09-23, it came up at a new address, and the installed app was still calling the old one — so it looked offline and could not sign in",
      "This build points at the current address. Nothing else changed: it is the same app as 1.13.0",
    ],
  },
  {
    date: "2026-09-22",
    version: "1.13.0",
    tag: "fix",
    title: "Returning an item no longer strands your phone on \u201cChecking\u201d",
    bullets: [
      "If a return needed a person to confirm it, or was rejected, or even passed outright, the phone had no way to hear the result \u2014 it just sat on \u201cChecking locker NN\u201d until you gave up and backed out",
      "All three outcomes now reach your phone properly: awaiting review looks the same as a deposit awaiting review, a rejected return explains that the item goes back to its owner while it is looked into, and a clean pass shows the normal done screen",
      "Found from a real return on 2026-09-22 that needed a second attempt and then went to review \u2014 the server had already logged sending the result, the phone just never had anyone listening for it",
    ],
  },
  {
    date: "2026-09-22",
    version: "1.12.0",
    tag: "feature",
    title: "Three photos from different angles, so the locker can recognise your item",
    bullets: [
      "Listing an item now needs at least three photos, each from a different angle — front, back and side. The form shows how many you have and how many more you need",
      "A short guide on the screen and again as you take each photo: good even light, and a plain light background such as a white table or sheet",
      "You cannot count the same photo twice — adding one you already have is refused",
      "Why: a correct item was being turned away at the locker because its one listing photo showed a different side and a different room. Several angles give the check a view that matches however the item is lying",
      "If you list items, install this build: older versions can no longer add or re-photograph a listing, and will say why. Renting is unaffected",
    ],
  },
  {
    date: "2026-09-18",
    version: "1.11.0",
    tag: "feature",
    title: "Tell us when you will collect it, and the locker plans around you",
    bullets: [
      "When you book, you can now set the day you will actually collect the item — leave it alone to collect on your first rental day, as before",
      "If you are collecting a day or more later, the item gets the full check instead of the quick one at the locker, because nobody is standing there waiting for it",
      "Once that check passes, the item is moved into the lower compartment of the locker, which frees the upper one for another student's hand-off. With only four lockers, that roughly doubles how many rentals the bank can carry at once",
      "The owner can drop the item off whenever suits them, without tying up a locker until your collection day",
      "A locker holding items in both compartments is taken out of rotation, so nothing is ever placed on top of someone else's property",
    ],
  },
  {
    date: "2026-09-18",
    version: "1.10.4",
    tag: "fix",
    title: "No more being sent to collect an item nobody has checked",
    bullets: [
      "The app used to offer \"Pick Up Item from Kiosk\" as soon as the owner dropped it off, even while the item was still being checked against the listing — so you could walk to the locker for something that had not been confirmed",
      "Now it waits, shows you that the item is in the locker and being confirmed, and tells you the moment you can collect it",
      "Most checks finish in well under a minute; if one needs a person to look, you are told that instead of being left guessing",
      "Install this if you are on build 24: the server now refuses unconfirmed pickups, and build 24 still shows the button",
    ],
  },
  {
    date: "2026-09-18",
    version: "1.10.3",
    tag: "fix",
    title: "Readable prices, and an honest answer when the kiosk isn't sure",
    bullets: [
      "The total price, deposit and dates on a rental were white text on a white panel in dark mode — invisible. They now follow the theme like everything else",
      "When the kiosk's quick check can't confirm your item on the spot, the app no longer implies something went wrong: your item is in the locker, a fuller check runs in the background, and a person confirms it",
      "That confirmation can take a few hours, and the app now says so instead of leaving you watching a spinner",
      "Same server address as build 23 — if 23 is working for you, this one is optional",
    ],
  },
  {
    date: "2026-09-18",
    version: "1.10.2",
    tag: "fix",
    title: "Rebuilt for the server's new address, again",
    bullets: [
      "The server restarted and its public address changed again, so build 22 and earlier cannot sign in until you install this one",
      "Nothing else changed: the locker flow from 1.10.0 is the same",
    ],
  },
  {
    date: "2026-09-17",
    version: "1.10.1",
    tag: "fix",
    title: "Rebuilt for the server's new address",
    bullets: [
      "The server restarted and its public address changed, which the app has baked in at build time — anyone on build 21 or earlier cannot sign in until they install this one",
      "No other changes: the locker flow from 1.10.0 is unchanged",
    ],
  },
  {
    date: "2026-09-14",
    version: "1.10.0",
    tag: "feature",
    title: "You open the locker when you're ready, and you decide when it checks",
    bullets: [
      "The locker no longer opens by itself the moment your face is verified. You get an \"Open Kiosk Now\" button, so the door unlocks while you're standing in front of it with a hand free",
      "A countdown shows how long the door stays unlocked, and you can open it again if it relocks before you're done",
      "A reminder on screen: push the door of the locker that lights up — the lock only holds it shut, it doesn't swing open on its own",
      "When your item is inside and the door is closed, tap \"Item is placed\" and the kiosk photographs the locker then. Before, it took the photo on a 20-second timer whether you were ready or not",
      "If the kiosk isn't sure about the item, you can now simply try again: it reopens the locker and rechecks. Previously that was a dead end — the door reopened and nothing ever looked again",
      "The kiosk screen now explains a retry instead of jumping back to its start screen",
    ],
  },
  {
    date: "2026-09-14",
    version: "1.9.1",
    tag: "fix",
    title: "Renters can pay the security deposit, and each side sees what happens next",
    bullets: [
      "Renters can now pay the security deposit from the app. Before this, Pay Now only ever asked for the rental fee, so a rental could never be fully paid and never reached the kiosk",
      "The pay button now says exactly what it pays and how much, and you can send the deposit without waiting for the rental fee to be confirmed first",
      "Owners no longer see the renter's payment buttons. Each side sees only its own next step, and a short note says whose turn it is while you wait",
    ],
  },
  {
    date: "2026-09-14",
    version: "1.9.0",
    tag: "release",
    title: "Live updates that actually arrive, a payment screen that tells you what to do, and a redesign",
    bullets: [
      "Live updates finally work. A crash while connecting meant chat messages, rental status changes, deposit and return results and payment confirmations had never arrived in real time, since April — you only saw them after reopening a screen",
      "After a dropped connection the app catches up on what it missed, and your Profile updates the moment an admin approves your ID instead of still saying \"Under review\"",
      "Tapping Pay Now used to do nothing. It now shows exactly where to send the money, with a copyable number and reference, tells you an admin confirms it within 24 hours, and notifies you when they do",
      "Owners viewing their own listing now see \"Manage your listing\" rather than a button to rent their own item",
      "Verifying your face for a kiosk handoff now shows how long the session has left and which attempt you're on, instead of a bare \"Verifying…\"",
      "A new colour system across the app: text fields and outlined buttons now meet accessibility contrast guidelines, the dark sign-in screen is no longer tinted brown, and \"Connecting…\" no longer appears in warning amber",
      "Rebuilt against the current server — build 18 could no longer sign in after the server's address changed",
    ],
  },
  {
    date: "2026-09-13",
    tag: "fix",
    title: "The kiosk's QR code shows how fresh it is, and never shows a dead one",
    bullets: [
      "A ring around the kiosk's QR code now empties as the code ages, with the real number of seconds left beside it",
      "Fixed the kiosk displaying an already-expired code for up to 30 seconds — scanning it was refused even though it looked valid. The kiosk now fetches the next code the moment the old one runs out",
    ],
  },
  {
    date: "2026-09-03",
    version: "1.8.0",
    tag: "feature",
    title: "Identity verification moved from the kiosk to your phone",
    bullets: [
      "Claiming, depositing, or returning an item no longer needs a kiosk camera pointed at your face — after scanning the kiosk's QR code, a verification page opens on your own phone instead",
      "One less camera watching a public corridor, and your phone's camera does a better job in real lighting than a fixed one ever could",
      "The kiosk now just waits and tells you to check your phone, with a real cancel — it never stalls on a step it can no longer perform",
      "Verification still runs against your enrolled ID photo, and the phone never decides the result itself — only the server does, exactly as before",
    ],
  },
  {
    date: "2026-09-03",
    tag: "fix",
    title: "The kiosk, made genuinely usable end to end",
    bullets: [
      "Scanning the kiosk's QR code now actually starts a rental — it used to mark the session connected and then sit there, because the screen the code is displayed on was not one the app's scan was allowed to advance from",
      "The touchscreen no longer comes up blank after a power cut: the installer never built the kiosk interface, so there was nothing for the browser to load",
      "Fixed the kiosk browser both failing to reopen after a crash and, in the opposite case, stacking a new fullscreen window every ten seconds",
      "Each locker camera is now bound to a stable hardware address, so the photos taken for item verification are of the locker they claim to be",
      "Locker open/close commands reached the hardware again — the console was addressing a kiosk ID that did not match the one the hardware registers under, and reported success either way",
    ],
  },
  {
    date: "2026-09-03",
    tag: "infra",
    title: "Admin tooling and deployment hardening",
    bullets: [
      "Admins can approve or reject a payment directly while card payments are still being finalised, so a rental is never stuck waiting on a payment provider",
      "The console's kiosk page was rebuilt on the same design system as the rest of the console instead of its own one-off styling",
      "ID verification no longer times out when a reviewer approves during heavy load",
      "Restored the full deployment after a site-wide brownout, and wrote down the recovery steps so the next outage is a checklist rather than a diagnosis",
    ],
  },
  {
    date: "2026-08-10",
    version: "1.7.0",
    tag: "fix",
    title: "A crash fix, a real safety gap closed, and an update screen that credits who found them",
    bullets: [
      "Fixed a crash that turned the whole app white when switching the language to Bisaya",
      "Listing an item or starting a rental now requires a verified student ID — a real reported safety gap",
      "The Identity tile in Profile is tappable whenever verification isn't done, not just after a rejection",
      "A real \"update required\" screen for outdated installs — real release notes, and credit to the students who reported the bugs it fixes",
    ],
  },
  {
    date: "2026-08-10",
    version: "1.6.0",
    tag: "release",
    title: "Enterprise hygiene: sixteen features across the app and console",
    bullets: [
      "A Reviewer staff role can clear ID-verification and listing-moderation queues without touching payouts, refunds, or other accounts",
      "Every admin action — who did what, to what, and why — is now recorded to a real, queryable audit log",
      "Bulk listing moderation and CSV export for users, rentals, and transactions in the admin console",
      "Renters can extend or shorten an active rental instead of only paying a late fee after the fact",
      "New account activity, transaction history, and notification preference screens",
      "Remote locker release for a stuck kiosk door, straight from the admin console",
      "A screen-reader pass across icon-only controls, plus Bisaya and Tagalog language support",
    ],
  },
  {
    date: "2026-08-10",
    tag: "feature",
    title: "Real availability, listing video, and trust & safety",
    bullets: [
      "Item availability now checks actual booking date ranges instead of a single on/off flag",
      "Owners can attach a short video to a listing, alongside photos",
      "Owner completion rate and renter on-time rate are shown where they matter; a listing can be reported directly",
      "The cancellation policy and the deposit's damage-protection cap are stated before payment, not discovered after",
    ],
  },
  {
    date: "2026-08-10",
    tag: "feature",
    title: "Works offline, and lets people talk it out",
    bullets: [
      "The app caches the last good data and queues actions taken while offline instead of failing outright",
      "In-app messaging scoped to a rental, so a dispute has a real transcript instead of a phone number exchanged in person",
    ],
  },
  {
    date: "2026-08-10",
    tag: "feature",
    title: "Crash reporting, My Listings, and a real feedback loop",
    bullets: [
      "Crash reporting wired through the whole app startup, not just the visible screens",
      "Owners can finally see, edit, and unlist their own listings after publishing them",
      "A real bug/feedback pipeline, with an admin triage queue and a resolution notice back to the reporter",
      "Item moderation and review removal, with a reasoned, attributable trail",
    ],
  },
  {
    date: "2026-08-09",
    tag: "feature",
    title: "Account verification, for real this time",
    bullets: [
      "A real review queue for student ID verification, with the actual evidence visible to the reviewer",
      "A rejection now says why, and re-submitting clears the old reason instead of showing both at once",
      "Fixed a cross-origin bug that was silently blocking verification photos from ever rendering",
    ],
  },
  {
    date: "2026-08-07",
    tag: "design",
    title: "A new design system: EngiRent Vault",
    bullets: [
      "One palette, one type stack, and animated backgrounds across the phone app, admin console, kiosk, and this site",
      "The admin console rebuilt from scratch on Mantine; this site rebuilt on Velora UI",
      "Full light and dark mode everywhere except the kiosk touchscreen",
    ],
  },
  {
    date: "2026-08-06",
    tag: "design",
    title: "Kiosk migrates to React, this site drops its starter kit",
    bullets: [
      "The kiosk touchscreen UI rebuilt on React and Vite, including a dedicated offline-fallback screen",
      "This site fully migrated off its original UI kit, down to zero leftover scaffold files",
    ],
  },
  {
    date: "2026-08-06",
    tag: "infra",
    title: "Real money movement, and biometric data actually encrypted",
    bullets: [
      "Owner payouts and deposit refunds run through real PayMongo transfer and refund calls, not a ledger entry",
      "Face templates encrypted at rest instead of stored in the clear",
      "Closed off client-controlled payment amounts — the server decides what a rental costs, not the app",
      "Photo and file storage moved off a third-party bucket to the project's own server",
    ],
  },
  {
    date: "2026-08-05",
    tag: "infra",
    title: "Where this started: a full independent audit",
    bullets: [
      "A ground-up audit of the whole codebase against its own documentation, correcting claims that didn't hold up",
      "The staged revamp plan that every entry above worked through, written from that audit",
    ],
  },
];

export const changelogTagLabel: Record<ChangelogTag, string> = {
  release: "Release",
  feature: "Feature",
  fix: "Fix",
  design: "Design",
  infra: "Infrastructure",
};
