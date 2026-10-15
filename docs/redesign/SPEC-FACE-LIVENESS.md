# SPEC — Face recognition revamp: blink + head turn liveness, glasses allowed, hats refused

> **Status: PROPOSAL, NOT BUILT.** Written 2026-10-15 from the user's request for the next session:
> "revamp the entirety of the facial recognition — turning left and right; can scan with glasses but won't
> scan if there is a hat; needs to blink for full recognition; find templates online for the phone design
> page and the code implementation." Section 7 lists what the user must rule on before the build (G2).
>
> **Written for:** the next session (to build from) and the user (to rule on section 7).

## 1. What exists today (re-derived from the code, 2026-10-15)

- **Phone** (`client/flutter_app/lib/features/kiosk/screens/face_verify_screen.dart`, 576 lines): the plain
  `camera` package (`pubspec.yaml`, `camera: ^0.11.0+2`) takes **one still photo** (`takePicture()`, ~line 144)
  and posts it to `POST /kiosk/verify-face`. There is **no on-device face detection**: the screen's own comment
  (~line 321) says the oval cannot tell whether a face is in it.
- **Server**: Node calls the ML service; `server/python_server/services/ml/app/routers/verification.py`
  compares the photo with the stored encoding using dlib `face_recognition` (match when distance ≤ 0.5,
  ~line 503), with a Haar-cascade fallback when dlib is missing.
- **No liveness at all**: no blink, no head turn, no hat rule. A printed photo or a phone screen held up to
  the camera is not refused by anything in the flow.
- **Enrolment** (profile setup) also takes a single face photo.

## 2. What must NOT change (CLAUDE.md hard rule, `Implemented.md` §6)

The face-verification **trust architecture** stays: the kiosk validates its own live QR token (90 s, single
use); `resolveFaceSubject` derives identity from rental status, never from client input; the server-side
session store is the trust boundary; **Node calls the ML service, the key never reaches a client**; it fails
closed. This revamp changes **what is captured and what the ML service checks**, not who decides.
**On-device checks are guidance only, never a security boundary:** the phone coaches the person through the
challenge, the server re-checks every step on the frames it receives.

## 3. Target flow

1. Server issues the challenge with the face-required step: a **random order** of `BLINK`, `TURN_LEFT`,
   `TURN_RIGHT` plus a nonce, stored in the session (a replayed recording of an earlier attempt then fails).
2. Phone (live camera stream + on-device face detection) guides: centre the face in the oval → each step in
   the issued order → hold still. It grabs one key frame per step (eyes-closed frame, left frame, right
   frame) and a centred, eyes-open frame for matching.
3. Phone posts the frame set + nonce to `/kiosk/verify-face` (same endpoint, multipart, same session rules).
4. ML service, on the frames (server-side, authoritative):
   - **Same person in every frame** (encodings consistent) and the centred frame **matches the stored face**
     (today's dlib check).
   - **Head turn**: yaw of the left frame below −θ and right frame above +θ (dlib 68-point landmarks +
     `cv2.solvePnP`, or MediaPipe Face Landmarker's transformation matrix); frames in the issued order.
   - **Blink**: eye aspect ratio (EAR) low in the closed frame, high in the open frames.
   - **Hat refused, glasses allowed**: face parsing on the centred frame; refuse when the `hat` class covers
     more than a set share of the head region; the `eye_g` (eyeglasses) class is ignored.
   - Any failure → a specific, plain reason back to the phone ("Remove your hat and try again", "We didn't
     see you blink", "Turn your head further to the left"), fails closed.
5. Enrolment uses the same capture flow, so the stored face is from a live person without a hat.

## 4. Templates found online (2026-10-15)

### Phone, code + UI

| Package | What it gives | Notes |
|---|---|---|
| [flutter_liveness_actions](https://pub.dev/packages/flutter_liveness_actions) ([GitHub](https://github.com/pvlKryu/flutter_liveness_actions)) | Blink, turn left, turn right, hold still (presets `basic()`, `lowEndFriendly()`), challenge state machine, quality gates, guidance metadata; uses `google_mlkit_face_detection` | MIT, **verified publisher**, 160 pub points, v1.4.0 recent. Helpers only: we own the camera, the UI and the frames. **Recommended for the logic.** |
| [samviva](https://pub.dev/packages/samviva) ([GitHub](https://github.com/samueljiwandono0310/samviva)) | Blink, turn left/right, smile; **ready UI**: face oval with dark overlay, bottom instruction card, step circles with an arc; returns one JPEG on success | MIT, unverified uploader, 10 downloads. **Use as the UI template**, not as a dependency. |
| [face_liveness_detection_plus](https://pub.dev/packages/face_liveness_detection_plus), [proveface](https://pub.dev/packages/proveface), [facial_liveness_verification](https://pub.dev/packages/facial_liveness_verification), [smart_liveliness_detection](https://pub.dev/documentation/smart_liveliness_detection/latest/) | Similar ML Kit challenge flows; some add randomized order, oval ratios, a stream of states | New, low adoption; references only. |

How they all detect it: ML Kit's `headEulerAngleY` for left/right turns and
`leftEyeOpenProbability` / `rightEyeOpenProbability` for blinks (enable `classification` in the detector).

### Phone, screen design references

- Dribbble tags (browse in a browser; the pages render client-side):
  [liveness](https://dribbble.com/tags/liveness) (incl. "Head rotation animation for MATI app"),
  [face recognition](https://dribbble.com/tags/face_recognition),
  [identity verification](https://dribbble.com/tags/identity-verification),
  [verification UI](https://dribbble.com/tags/verification-ui) (incl. "Face verification process UI").
- Vendor flow to model the steps on: [Amazon Rekognition Face Liveness](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness.html)
  and its [Amplify UI customization](https://ui.docs.amplify.aws/swift/connected-components/liveness/customization)
  (start/instructions screen, face-in-oval, real-time feedback, WCAG-compliant colours).
- Must keep EngiRent's own design system (the app's tokens and fonts) and the existing `_OvalGuidePainter`
  style; the references are for the step layout, not the look.

### Server, code

- **Face parsing (hat / eyeglasses)**: [yakhyo/face-parsing](https://github.com/yakhyo/face-parsing): BiSeNet,
  **MIT**, ONNX weights on its release page (ResNet18 ~43 MB, ResNet34 ~82 MB), ONNX Runtime inference script,
  19 CelebAMask-HQ classes including `hat` and `eye_g` (**read the label map from its code**; the indices differ
  between models). Alternative: [BiSeNet LiteRT](https://huggingface.co/litert-community/BiSeNet-Face-Parsing-LiteRT)
  (eyeglasses index 6, hat index 18, MIT weights). Avoid [jonathandinu/face-parsing](https://huggingface.co/jonathandinu/face-parsing)
  (non-commercial licence).
- **Blink / head pose**: EAR from eye landmarks (dlib 68-point is already installed with `face_recognition`;
  or MediaPipe Face Landmarker) and yaw from landmarks + `cv2.solvePnP`. Pattern reference: the
  [VisionLabs liveness handbook](https://docs.visionlabs.ai/sdk/v.5.21.0/sdk/livenessengine-handbook/liveness-facility)
  (blink = open → closed → open on both eyes; turn = rotation past a threshold) and the server-chosen random
  sequence in [IDENTT's liveness module](https://www.identt.pl/en/liveness-detection/).
- **Optional later**: passive anti-spoofing ([Silent-Face-Anti-Spoofing, Minivision](https://clarifai.com/minivision-ai/silent-face-anti-spoofing/models/silent-face-anti-spoofing))
  against photos and screen replays. Not in scope unless the user asks; RGB-only checks are never 100 % spoof-proof.

## 5. Build sections (G2 table to copy into PROGRESS.md at phase start, after section 7 is ruled on)

| # | Section | Where | Done when (seen, not just tested) |
|---|---------|-------|-----------|
| F1 | ML: `/face/liveness-verify` (or extend the face route) taking a frame set + issued order: same-person, match, yaw per step, EAR blink, hat refusal (BiSeNet ONNX), plain reasons, fail closed | `server/python_server/services/ml` | unit tests on local, gitignored fixtures; never a real face in git |
| F2 | Node: issue a random challenge order + nonce with the face step, keep it in the session store, forward the frame set to ML, map reasons to messages | `faceVerificationService.ts`, kiosk routes | e2e over HTTP with fixtures |
| F3 | App: new guided capture (camera image stream + `google_mlkit_face_detection` + `flutter_liveness_actions`), UI on the samviva/Amplify step pattern in EngiRent's design system; replaces the single photo in `face_verify_screen.dart` | `client/flutter_app` | seen on a **real phone** (the emulator's camera is a virtual room) |
| F4 | Enrolment: profile setup uses the same flow; hat refused at enrolment too | app + ML | seen on a real phone |
| F5 | Real kiosk run: verify → open-bay (G11: the door opens on the student's tap, ask first) | kiosk | one real flow with the user present |
| F6 | Thesis test cases (blink, left/right, glasses pass, hat refused, photo refused) + full release | docs, release | all four release places |

## 6. Risks to plan for

- **Thresholds need real faces**: yaw angle, EAR and hat share must be tuned on real captures from the test
  accounts (Chester's photo is supplied by the user and must never be committed, `reference_test_accounts`).
- **Low-end phones**: ML Kit on a live stream can be slow; `flutter_liveness_actions` has a `lowEndFriendly()`
  preset; keep the frame size small.
- **Upload size**: 4-5 frames instead of 1; compress JPEGs on the phone.
- **ML service** gains an ONNX Runtime dependency + ~43 MB model on the server.

## 7. Decisions for the user (before F1)

1. **Challenge order**: random per attempt, chosen by the server (recommended, blocks replays) or a fixed
   order (blink, left, right)?
2. **Head coverings**: "no hat" — should **religious head coverings (for example a hijab)** be exempt? A face
   parsing model may label a hijab as a hat; refusing it would lock those students out. Recommendation: refuse
   caps, hats and hoods; allow head coverings that leave the whole face (forehead to chin) visible.
3. **Existing users**: keep their enrolled face (liveness applies at verification only) or ask everyone to
   re-enrol with the new flow?
4. **Passive anti-spoof** (photo/screen detection without a challenge): include now or later?
