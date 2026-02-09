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


class FeatureExtractionResponse(BaseModel):
    image_count: int = Field(description="Number of images processed")
    traditional_features_count: int = Field(description="Number of traditional feature sets")
    deep_features_count: int = Field(description="Number of deep feature vectors")
    ocr_texts: list[str] = Field(description="OCR-extracted text from each image")


class HealthResponse(BaseModel):
    status: str
    service: str
    deep_learning_enabled: bool
    ocr_enabled: bool
