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

    # Hybrid method weights (Phase 3)
    weight_traditional: float = 0.30
    weight_deep_learning: float = 0.25
    weight_sift: float = 0.20
    weight_ssim_hybrid: float = 0.15
    weight_phash_hybrid: float = 0.10

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

    model_config = {"env_prefix": "ML_"}


settings = Settings()
