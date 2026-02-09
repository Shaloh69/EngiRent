from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """ML Service configuration."""

    # Service
    app_name: str = "EngiRent AI Verification Service"
    debug: bool = False
    host: str = "0.0.0.0"
    port: int = 8001

    # Verification thresholds
    threshold_verified: float = 85.0
    threshold_manual_review: float = 60.0
    max_retry_attempts: int = 10

    # Traditional CV feature weights (must sum to 1.0)
    # These 6 weights are used in SimilarityCalculator.compare_traditional()
    # SSIM is a separate channel in the hybrid verifier, not here
    weight_color: float = 0.25
    weight_spatial: float = 0.15
    weight_shape: float = 0.12
    weight_texture: float = 0.15
    weight_hog: float = 0.20
    weight_orb: float = 0.13

    # Hybrid method weights (Phase 3)
    weight_traditional: float = 0.30
    weight_deep_learning: float = 0.25
    weight_sift: float = 0.20
    weight_ssim_hybrid: float = 0.15
    weight_phash_hybrid: float = 0.10

    # Image processing
    max_image_size: int = 4096
    target_size: tuple[int, int] = (640, 640)

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

    model_config = {"env_prefix": "ML_"}


settings = Settings()
