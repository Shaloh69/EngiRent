"""Pydantic schemas for API request/response models."""

from pydantic import BaseModel, Field


class MethodScores(BaseModel):
    traditional_best: float = Field(description="Best traditional CV score across all image pairs")
    traditional_aggregated: float = Field(description="Aggregated traditional CV score (trimmed mean)")
    sift_best_match: float = Field(description="Best SIFT match ratio")
    sift_best_inlier: float = Field(description="Best SIFT RANSAC inlier ratio")
    sift_combined: float = Field(description="Combined SIFT score (70% inlier + 30% match)")
    ssim_aggregated: float = Field(description="Aggregated SSIM structural similarity")
    deep_learning_aggregated: float = Field(description="Aggregated deep learning similarity")
    phash_best: float = Field(description="Best perceptual hash similarity")


class OCRResult(BaseModel):
    match: bool = Field(description="Whether serial numbers matched")
    details: dict | None = Field(default=None, description="OCR match details")


class QualityIssue(BaseModel):
    image_index: int = Field(description="Index of the problematic image")
    passed: bool = Field(description="Whether the image passed quality check")
    blur_score: float = Field(description="Laplacian blur score (higher = sharper)")
    brightness: float = Field(description="Mean brightness (0-255)")
    coverage_percent: float = Field(description="Foreground coverage percentage")
    issues: list[str] = Field(description="List of quality issues")


class VerificationResponse(BaseModel):
    verified: bool = Field(description="Whether the item passed verification")
    decision: str = Field(description="APPROVED, PENDING, RETRY, or REJECTED")
    message: str = Field(description="Human-readable decision message")
    confidence: float = Field(description="Overall confidence score (0-100)")
    attempt_number: int = Field(description="Current attempt number")
    method_scores: MethodScores
    ocr: OCRResult
    quality_issues: list[QualityIssue] = Field(default_factory=list, description="Image quality problems")
    good_pair_count: int = Field(default=0, description="Number of image pairs above manual review threshold")
    all_traditional_scores: list[float] = Field(description="All pairwise traditional CV scores")
    sift_all_ratios: list[float] = Field(description="All pairwise SIFT match ratios")
    # D-87: how long the check took, and whether the time budget forced any
    # stage to be skipped. Without these a degraded verdict is indistinguishable
    # from a full one, and the caller has no way to say "a human should look".
    elapsed_seconds: float = Field(default=0.0, description="Wall-clock seconds this verification took")
    degraded: bool = Field(default=False, description="True when the time budget forced stages to be skipped")
    skipped_stages: list[str] = Field(default_factory=list, description="Stages skipped because of the time budget")
    # D-87b: "fast" = the check a student waited on at the locker; "full" = the
    # background re-run that assists a human reviewer. The same score means
    # different things in each, so the tier travels with the result.
    mode: str = Field(default="fast", description="Which tier produced this verdict: fast or full")
    # ML phase (2026-09-25), filled by the v2 pipeline only.
    pipeline: str = Field(default="v1", description="Which verification pipeline produced this verdict")
    placement: dict | None = Field(
        default=None,
        description="Stage P: OK / OFF_CENTER / TRUNCATED / EMPTY / MULTIPLE (+ UNSEEN), the message to show, and per-frame verdicts",
    )
    reposition: bool = Field(
        default=False,
        description="True when the item must be MOVED, not judged. The decision is RETRY; it must not count toward the review escalation",
    )
    quality_blocked: bool = Field(default=False, description="True when every frame was unusable (e.g. the locker light off)")
    evidence: dict | None = Field(default=None, description="v2 raw per-stage evidence, for the reviewer")
    stage_seconds: dict | None = Field(default=None, description="v2 wall time per stage")


class StorableFeatures(BaseModel):
    """Pre-extracted feature data ready to be stored in Item.mlFeatures."""
    traditional: list = Field(description="Traditional CV feature dicts (one per image)")
    deep: list = Field(description="ResNet50 feature vectors serialized as float lists")
    ocr_texts: list[str] = Field(description="OCR-extracted text per image")
    image_count: int = Field(description="Number of images processed")


class FeatureExtractionResponse(BaseModel):
    image_count: int = Field(description="Number of images processed")
    traditional_features_count: int = Field(description="Number of traditional feature sets")
    deep_features_count: int = Field(description="Number of deep feature vectors")
    ocr_texts: list[str] = Field(description="OCR-extracted text from each image")
    features: StorableFeatures = Field(description="Full feature data for storage in Item.mlFeatures")


class FaceVerificationResponse(BaseModel):
    verified: bool = Field(description="Whether the face identity matched")
    detected: bool = Field(description="Whether a face was detected in the captured image")
    confidence: float = Field(description="Match confidence 0.0–1.0")
    message: str = Field(description="Human-readable result message")


class FaceRegisterResponse(BaseModel):
    success: bool = Field(description="Whether a face was detected and encoded")
    encoding: list[float] | None = Field(description="128-float face encoding (store in User.faceEncoding)")
    face_image_data: str | None = Field(default=None, description="base64 JPEG of detected face crop (for preview)")
    message: str = Field(description="Human-readable result message")


class HealthResponse(BaseModel):
    status: str
    service: str
    deep_learning_enabled: bool
    ocr_enabled: bool
    face_recognition_enabled: bool = Field(default=False)
    # ML phase: which item-verification pipeline /verify runs, and (v2 only)
    # whether its models have finished loading. "deployed" and "ready" differ
    # by the warm-up, which runs in a background thread at startup.
    item_pipeline: str = Field(default="v1")
    item_models_ready: bool | None = Field(default=None)
