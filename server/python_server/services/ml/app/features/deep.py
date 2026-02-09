"""
Phase 3: Deep Learning Feature Extraction using ResNet50.

Uses a pre-trained ResNet50 (ImageNet weights) with the final
classification layer removed, producing a 2048-dimensional feature
vector that captures high-level visual semantics.

These features understand complex patterns, object parts, and
visual concepts far beyond what traditional CV can capture.
"""

import logging

import numpy as np

from ..config import settings

logger = logging.getLogger(__name__)

# Lazy imports - PyTorch is heavy, only load when needed
_model = None
_transform = None


def _load_model():
    """Lazily load ResNet50 and preprocessing transform."""
    global _model, _transform

    if _model is not None:
        return _model, _transform

    import torch
    import torchvision.models as models
    import torchvision.transforms as transforms

    # Load pre-trained ResNet50, remove classification head
    resnet = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V2)
    _model = torch.nn.Sequential(*list(resnet.children())[:-1])
    _model.eval()

    _transform = transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    logger.info("ResNet50 model loaded successfully")
    return _model, _transform


class DeepFeatureExtractor:
    """Extract deep learning features using pre-trained ResNet50."""

    def __init__(self):
        self.enabled = settings.enable_deep_learning
        self.feature_dim = settings.resnet_feature_dim

    def extract(self, source: str | bytes | np.ndarray) -> np.ndarray:
        """
        Extract a 2048-d feature vector from an image.

        Args:
            source: File path, raw bytes, or numpy array (BGR).

        Returns:
            numpy array of shape (2048,).
        """
        if not self.enabled:
            return np.zeros(self.feature_dim)

        import torch
        from PIL import Image

        model, transform = _load_model()

        # Convert source to PIL Image
        if isinstance(source, str):
            img = Image.open(source).convert("RGB")
        elif isinstance(source, bytes):
            import io

            img = Image.open(io.BytesIO(source)).convert("RGB")
        elif isinstance(source, np.ndarray):
            import cv2

            rgb = cv2.cvtColor(source, cv2.COLOR_BGR2RGB)
            img = Image.fromarray(rgb)
        else:
            raise ValueError(f"Unsupported source type: {type(source)}")

        tensor = transform(img).unsqueeze(0)

        with torch.no_grad():
            features = model(tensor)

        return features.squeeze().numpy()  # (2048,)

    def extract_batch(self, sources: list[str | bytes | np.ndarray]) -> list[np.ndarray]:
        """Extract features from multiple images."""
        return [self.extract(src) for src in sources]
