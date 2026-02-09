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

    # Feature weights (Phase 1: Traditional CV)
    weight_color: float = 0.40
    weight_shape: float = 0.25
    weight_texture: float = 0.20
    weight_orb: float = 0.15

    # Hybrid weights (Phase 3)
    weight_traditional: float = 0.40
    weight_deep_learning: float = 0.35
    weight_sift: float = 0.25

    # Image processing
    max_image_size: int = 4096
    target_size: tuple[int, int] = (640, 640)

    # Feature extraction
    orb_features_count: int = 100
    sift_ratio_threshold: float = 0.7
    lbp_points: int = 8
    lbp_radius: int = 1
    color_hist_bins: int = 32

    # Deep learning
    enable_deep_learning: bool = True
    resnet_feature_dim: int = 2048

    # OCR
    enable_ocr: bool = True

    # Storage (for uploaded images)
    upload_dir: str = "/tmp/engirent_uploads"

    model_config = {"env_prefix": "ML_"}


settings = Settings()
