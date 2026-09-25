"""
Stages 2 and 3: learned embeddings of the item crops (CPU).

  DINOv2 (facebook/dinov2-base): instance-level appearance. Better than the
      ImageNet ResNet-50 it replaces at "is this the same object", because it
      is trained without labels and keeps fine structure.
  CLIP (openai/clip-vit-base-patch16): what KIND of thing is in the crop,
      zero-shot against a vocabulary of equipment names. This is what separates
      a rivet tool from a screwdriver when both are black-and-yellow hand tools.

Both load once per process; weights come from the Hugging Face cache.
"""

from __future__ import annotations

import threading

import numpy as np
import torch

DINO_ID = "facebook/dinov2-base"
CLIP_ID = "openai/clip-vit-base-patch16"

_lock = threading.Lock()
_models: dict = {}


def _get(name: str):
    with _lock:
        if name not in _models:
            from transformers import AutoImageProcessor, AutoModel, CLIPModel, CLIPProcessor

            if name == "dino":
                _models[name] = (AutoImageProcessor.from_pretrained(DINO_ID), AutoModel.from_pretrained(DINO_ID).eval())
            elif name == "clip":
                _models[name] = (CLIPProcessor.from_pretrained(CLIP_ID), CLIPModel.from_pretrained(CLIP_ID).eval())
        return _models[name]


def _norm(x: torch.Tensor) -> np.ndarray:
    return torch.nn.functional.normalize(x.float(), dim=-1).cpu().numpy()


@torch.inference_mode()
def dino(crops_rgb: list[np.ndarray]) -> np.ndarray:
    """One L2-normalised vector per crop: [CLS ; mean patch token]."""
    proc, model = _get("dino")
    inp = proc(images=crops_rgb, return_tensors="pt")
    h = model(**inp).last_hidden_state
    return _norm(torch.cat([h[:, 0], h[:, 1:].mean(1)], dim=-1))


@torch.inference_mode()
def clip_image(crops_rgb: list[np.ndarray]) -> np.ndarray:
    proc, model = _get("clip")
    inp = proc(images=crops_rgb, return_tensors="pt")
    return _norm(model.get_image_features(**inp))


_text_cache: dict[str, np.ndarray] = {}


@torch.inference_mode()
def clip_text(texts: list[str]) -> np.ndarray:
    missing = [t for t in texts if t not in _text_cache]
    if missing:
        proc, model = _get("clip")
        inp = proc(text=missing, return_tensors="pt", padding=True)
        for t, v in zip(missing, _norm(model.get_text_features(**inp))):
            _text_cache[t] = v
    return np.stack([_text_cache[t] for t in texts])


CLIP_LOGIT_SCALE = 100.0  # CLIP's own learned temperature (exp(4.6052))
