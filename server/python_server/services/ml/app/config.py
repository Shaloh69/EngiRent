from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """ML Service configuration."""

    # Service
    app_name: str = "EngiRent AI Verification Service"
    debug: bool = False
    host: str = "0.0.0.0"
    port: int = 8001

    # Security
    # If set, every verification/face endpoint requires a matching X-API-Key
    # header. The Node backend sends env ML_SERVICE_API_KEY as X-API-Key, so set
    # this (ML_API_KEY) to the SAME value. Leave empty only for local dev.
    api_key: str = ""
    # CORS allowlist. Empty by default because all real callers are server-side
    # (Node backend, Pi kiosk) and don't need browser CORS. Set ML_ALLOWED_ORIGINS
    # as a comma-separated list only if a browser must call the service directly.
    allowed_origins: str = ""

    # Verification thresholds
    threshold_verified: float = 85.0
    threshold_manual_review: float = 60.0
    max_retry_attempts: int = 10

    # Traditional CV feature weights (must sum to ~1.0)
    # Rebalanced for improved feature set: HSV color, spatial, shape, texture, HOG, ORB
    weight_color: float = 0.22
    weight_spatial: float = 0.13
    weight_shape: float = 0.12
    weight_texture: float = 0.13
    weight_hog: float = 0.18
    weight_orb: float = 0.12
    weight_ssim: float = 0.10

    # D-89 (2026-09-19/20) — REWEIGHTED from a measured evaluation, not guessed.
    #
    # The second physical test put a correct "GLUE GUN 60W" in the locker and
    # it scored ~53 no matter which listing photo it was checked against — a
    # score these old weights (trad .30 / deep .25 / sift .20 / ssim .15 /
    # phash .10) could never lift near 85. Ran the real pipeline, in full mode
    # with nothing skipped, on that glue gun's own two locker captures (the
    # positive) against all 6 other listed items' photos (the negatives), once
    # with item isolation off and once on (`isolate_item_first`), and measured
    # each stage's own separation — mean positive score minus mean negative
    # score, the number that actually says whether a stage is discriminating
    # anything:
    #
    #                        no isolation   isolated
    #   deep_learning              +35.5      +35.4   <- best in both
    #   sift                       +21.1      +32.8
    #   traditional                 +2.1      +11.9   <- isolation triples it
    #   phash                       -2.9       +3.7   <- was WORSE than a coin flip
    #   ssim                        -0.9       +0.7   <- never discriminates
    #
    # Two things fell out of that table. First, isolation genuinely helps —
    # every stage's separation improves or holds (see `isolate_item_first`
    # below, now on). Second, and this is what actually explains the bug: the
    # two highest-weighted stages before this change (traditional .30, ssim
    # .15 — 45% of the score between them) were the two worst discriminators.
    # ssim and the raw colour/texture channel compare the whole photographed
    # SCENE, and a locker's flat white interior under a camera flash looks
    # nothing like a listing photo shot on a bedsheet — so most of the old
    # score was measuring the room, not the item.
    #
    # These weights are set from the isolated column, since isolation is on:
    weight_traditional: float = 0.20
    weight_deep_learning: float = 0.35
    weight_sift: float = 0.30
    weight_ssim_hybrid: float = 0.05
    weight_phash_hybrid: float = 0.10
    # Recomputing that same glue-gun-vs-everything table with THESE weights
    # (still on the isolated scores) widens the gap from +19.4 to +25.0: worst
    # negative (Soldering 60w, another ELECTRONICS listing) 42.5, best positive
    # 57.6 — a clean 15-point margin, no overlap. Not pushed further: a more
    # aggressive version (deep .40/sift .35/trad .15/phash .07/ssim .03) only
    # bought another +2.7 of separation, and tuning five knobs hard against one
    # positive example is how a real overfit starts. `ssim` and `phash` are
    # kept above zero rather than dropped: near-zero separation on THIS n=7
    # sample is not proof a stage is worthless on every item, and a small
    # weight still lets either one matter if the trend ever reverses.
    #
    # This does not, on its own, make weak evidence read as strong: D-89's
    # verdictPolicy still sends anything under 85 to a human after one retry,
    # regardless of what these weights produce.

    # Image processing
    #
    # D-87 (2026-09-18), measured on the live kiosk: with this at 4096 a single
    # deposit check ran for **7+ minutes** and was still inside "Step 3:
    # Traditional CV" when it was killed — the student stood at the locker and
    # the rental could not complete. Cost is quadratic in the pixel count, and
    # the pipeline touches every image several times (background removal, CLAHE,
    # ORB/HOG, SIFT+RANSAC, SSIM, ResNet), across 2 listing photos x 3 kiosk
    # frames. Phone photos arrive at ~4000px, so almost nothing was being
    # clamped. 1280 keeps far more detail than any stage actually consumes
    # (SIFT saturates well below it; SSIM and the ResNet pass resize to 640 and
    # 224 anyway) while cutting the work by ~10x.
    max_image_size: int = 1280
    target_size: tuple[int, int] = (640, 640)

    # D-87: the wall clock a single verify may spend before it starts SKIPPING
    # the remaining optional stages. It never aborts the request — the service
    # must always answer with a real verdict, because a deposit waits on it and
    # a silent cut-off is what left a bay reserved with an item inside. When the
    # budget is passed the result is marked `degraded` and is never allowed to
    # read as APPROVED on partial evidence.
    #
    # D-87b (2026-09-18) — TWO TIERS, because one budget could not serve both
    # jobs. A student is standing at an open locker: that check has to finish in
    # the time it takes to close a door. But squeezing the whole pipeline into
    # that window meant the heavy stages never ran, and a *correct* item scored
    # only 80-81 — under the 85 threshold — so nothing could ever be
    # auto-approved. The two callers want different things, so they now get
    # different budgets:
    #
    #   fast  — at placement, with a person waiting. Skips whatever does not
    #           fit. A PENDING here means "a human will look", not "suspect".
    #   full  — afterwards, in the background, for the row a human is about to
    #           review. Every stage runs; nobody is waiting. The ceiling exists
    #           only so one wedged image cannot occupy the service forever, and
    #           even at the ceiling the run still returns a real verdict.
    verify_time_budget_seconds: float = 25.0
    verify_full_budget_seconds: float = 900.0

    # D-89: cut every item out of its background before ANY stage compares it
    # (see utils/background.isolate_item). Turned ON from the evaluation above
    # — every stage's separation improved or held with it on; none got worse.
    isolate_item_first: bool = True

    # ML phase (2026-09-25): which verification pipeline /verify runs.
    #   v1 = app/comparison/hybrid.py (GrabCut + SIFT + ResNet-50, fixed weights)
    #   v2 = app/v2/ (floor-model localisation + placement, ISNet listing cut-out,
    #        DINOv2 + CLIP, calibrated fusion). Measured on the real 2026-09-24/25
    #        captures: separation -48.6 (v1) vs +49.2 held-out (v2). PROGRESS.md.
    # Default stays v1 so deploying the code changes nothing until ML_PIPELINE_VERSION=v2.
    pipeline_version: str = "v1"
    # Where v2 keeps listing-photo embeddings between restarts. Empty = memory only.
    v2_cache_dir: str = "cache_v2"

    # Feature extraction
    orb_features_count: int = 200
    sift_ratio_threshold: float = 0.7
    lbp_points: int = 8
    lbp_radius: int = 1
    color_hist_bins: int = 32

    # Deep learning
    enable_deep_learning: bool = True
    resnet_feature_dim: int = 2048

    # OCR
    enable_ocr: bool = True

    # Quality gate thresholds
    quality_min_blur_score: float = 50.0
    quality_min_brightness: float = 40.0
    quality_max_brightness: float = 240.0
    quality_min_coverage: float = 0.05

    # Perceptual hash
    phash_obvious_mismatch_threshold: float = 40.0

    # Score aggregation
    min_good_pairs: int = 2
    score_aggregation: str = "trimmed_mean"  # "max", "median", "trimmed_mean"

    # Storage (for uploaded images)
    upload_dir: str = "/tmp/engirent_uploads"

    # Reference-image fetch safety (SSRF hardening for /verify-face's
    # reference_image_url — the endpoint previously fetched any caller-
    # supplied URL with no host restriction, size cap, or timeout).
    # Comma-separated hostnames allowed to be fetched from (e.g. the
    # Supabase storage host today; the local image-serving host once storage
    # moves to the PC). Empty means "not configured" — in that case fetches
    # are only permitted when `debug=True` (local dev), and refused
    # (fail-closed) otherwise, mirroring the fail-closed pattern already used
    # for the kiosk shared secret and the ML API key.
    allowed_image_hosts: str = ""
    image_fetch_timeout_seconds: float = 5.0
    image_fetch_max_bytes: int = 10_000_000  # 10 MB

    # Face liveness (2026-10-15, docs/redesign/SPEC-FACE-LIVENESS.md). Starting
    # values from the literature (EAR ~0.25-0.35 open; turns of 20-30 degrees);
    # NOT yet tuned on real captures. Retune from the fixture run and record
    # the measured numbers in PROGRESS.md before changing any of these.
    face_match_max_distance: float = 0.5  # same as the 1-photo check (_dlib_verify)
    face_same_person_max_distance: float = 0.6  # step frames vs the centre frame
    # 2026-10-15, from judging 21 real attempts by eye (see PROGRESS.md): dlib's eye
    # aspect ratio is NOT comparable across people or lighting (a visibly closed eye
    # read 0.29, a visibly open one 0.16), so there is no absolute "open" or "closed"
    # level any more. A blink is judged against the person's OWN open eye in the
    # same attempt: the most-closed candidate must be at most this share of it
    # (all 18 judged blinks passed at 0.85; the weakest was 0.825).
    face_ear_open_min: float = 0.12  # only to refuse a centre frame that is plainly shut
    # First live test 2026-10-15 (two students, 15 attempts): real blink frames read
    # 0.16-0.20 against open 0.21-0.30; the old 0.19 / 0.75 failed real blinks.
    face_ear_closed_max: float = 0.30  # sanity cap only: a "blink" candidate above this is open
    face_ear_closed_ratio_max: float = 0.85
    # Head turns use the nose-between-the-eyes ratio (geometry.yaw_ratio), not
    # solvePnP degrees: PnP flipped sign at large turns on real phone frames. On
    # 81 facing frames |ratio| <= 0.12; on 38 real turn frames |ratio| >= 0.34
    # except one barely-turned frame at 0.17.
    face_centre_max_yaw_ratio: float = 0.20  # centre frame faces the camera
    face_turn_min_yaw_ratio: float = 0.28  # each turn frame, in its own direction
    # Measured 2026-10-15 on openly licensed Commons photos (eval/wild_faces_report.py,
    # near-frontal only): 5/5 caps had a hat share of 0.17 or more; the one false
    # refusal (glasses, forehead fully visible) sat at 0.043. 0.08 splits them.
    # Few photos, so treat the margin as thin and retune from real phone sessions.
    face_hat_min_share: float = 0.08  # hat pixels / head region below this: no covering
    face_forehead_min_skin: float = 0.6  # covering allowed only with the forehead visible
    face_forehead_band: float = 0.25  # forehead band height, fraction of brow-to-chin
    face_frame_min_share: float = 0.01  # covering below the eyes on each side
    face_max_image_side: int = 960  # frames are downscaled to this before detection
    face_parsing_model: str = "models_face/face_parsing_resnet18.onnx"
    # Passive anti-spoof (F1b): real - spoof logit must be at least this on the
    # centre AND blink frames. 0.0 = the model's own p >= 0.5 default; raise it
    # for fewer spoofs and more false refusals (its docs/LIMITATIONS.md).
    # Judged on 21 real attempts (2026-10-15): single frames of real faces scored as
    # low as -5.95 / -2.71, so ONE frame is not trustworthy. The check now takes the
    # BEST margin over the facing frames (centre + blink candidates): every real
    # attempt had at least one frame >= -0.22, while a flat photo or screen should
    # score low on all of them. The attack side is STILL unmeasured (no photo or
    # screen samples), so -1.0 is a usability call, not a security measurement.
    face_spoof_min_margin: float = -1.0
    # The frames the phone sends are NOT mirrored (126 saved frames, judged by eye,
    # 2026-10-15). The phone's own `mirrored` claim is ignored: two app releases
    # sent opposite values and a wrong claim turned every good attempt into a
    # failure. Change this only if a different capture path is ever added.
    face_frames_mirrored: bool = False
    face_antispoof_model: str = "models_face/antispoof_minifasv2se_98_20_int8.onnx"

    model_config = {"env_prefix": "ML_"}


settings = Settings()
