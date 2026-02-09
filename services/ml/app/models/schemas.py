"""Pydantic schemas for API request/response models."""

from pydantic import BaseModel, Field


class MethodScores(BaseModel):
    traditional_best: float = Field(description="Best traditional CV score across all image pairs")
    traditional_avg: float = Field(description="Average traditional CV score")
    sift_best: float = Field(description="Best SIFT keypoint match ratio")
    deep_learning_best: float = Field(description="Best deep learning similarity score")


class OCRResult(BaseModel):
    match: bool = Field(description="Whether serial numbers matched")
    details: dict | None = Field(default=None, description="OCR match details")


class VerificationResponse(BaseModel):
    verified: bool = Field(description="Whether the item passed verification")
    decision: str = Field(description="APPROVED, PENDING, RETRY, or REJECTED")
    message: str = Field(description="Human-readable decision message")
    confidence: float = Field(description="Overall confidence score (0-100)")
    attempt_number: int = Field(description="Current attempt number")
    method_scores: MethodScores
    ocr: OCRResult
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
