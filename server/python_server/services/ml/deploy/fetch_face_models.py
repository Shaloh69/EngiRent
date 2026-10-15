"""
Fetch the face-liveness model weights into models_face/ and check their hashes.

    python deploy/fetch_face_models.py

The weights are not committed (models_face/ is gitignored, ~53 MB). Each file
is checked against the SHA-256 GitHub publishes for the release asset; a
mismatch deletes the download and exits non-zero, so a tampered or truncated
file never reaches the service (which would then refuse with 503 anyway).

Face parsing: yakhyo/face-parsing (MIT), BiSeNet ResNet18, release "weights".
Its training data is CelebAMask-HQ, whose licence allows non-commercial
research and education only: fine for this thesis, to be revisited before any
commercial use.
"""

import hashlib
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = {
    "models_face/face_parsing_resnet18.onnx": (
        "https://github.com/yakhyo/face-parsing/releases/download/weights/resnet18.onnx",
        "0d9bd318e46987c3bdbfacae9e2c0f461cae1c6ac6ea6d43bbe541a91727e33f",
    ),
}


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ok = True
    for rel, (url, want) in MODELS.items():
        dest = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.isfile(dest) and sha256(dest) == want:
            print(f"ok      {rel}")
            continue
        print(f"fetch   {rel} <- {url}")
        tmp = dest + ".part"
        urllib.request.urlretrieve(url, tmp)
        got = sha256(tmp)
        if got != want:
            os.remove(tmp)
            print(f"FAILED  {rel}: sha256 {got} != {want}", file=sys.stderr)
            ok = False
            continue
        os.replace(tmp, dest)
        print(f"ok      {rel}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
