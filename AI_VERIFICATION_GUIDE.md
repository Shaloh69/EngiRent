# EngiRent Hub - AI Item Verification System 🤖

## Problem Statement

**Challenge**: How to verify that the item physically placed in the locker by the owner is the **exact same item** shown in the listing photos they uploaded?

**Goal**: Compare 3+ owner-uploaded images (from listing) with real-time camera images (from inside locker) to confirm they are the same physical item.

---

## 🎯 Solution Overview

You **CANNOT** expect 100% identical images because:
- ❌ Different camera angles
- ❌ Different lighting conditions (home vs. kiosk)
- ❌ Different backgrounds (home surface vs. white locker interior)
- ❌ Different camera quality (phone camera vs. locker camera)
- ❌ Item may be in different position/orientation

**Instead, you use:**
✅ **Feature Matching** - Extract unique visual features from both sets of images
✅ **Similarity Scoring** - Calculate how similar the features are (0-100%)
✅ **Confidence Threshold** - Decide if similarity is high enough (typically 85%+)
✅ **Multi-Image Comparison** - Compare multiple angles to improve accuracy

---

## 📊 Verification Workflow

```
Owner Upload (Listing Creation)
│
├─► Upload 3+ images of item
│   • Front view
│   • Side view
│   • Close-up (brand/serial number)
│   • Top view (optional)
│
├─► Backend stores images in S3
│   • original_1.jpg
│   • original_2.jpg
│   • original_3.jpg
│
└─► ML Service extracts features
    • Color histogram
    • Shape descriptors
    • Texture patterns
    • Text/logo detection (OCR)
    • Store in database as "feature vectors"

─────────────────────────────────────

Owner Deposits Item in Kiosk
│
├─► Places item in locker
│
├─► Locker camera activates
│   • Captures 3-5 images automatically
│   • Different angles (camera may rotate OR multiple cameras)
│   • kiosk_1.jpg, kiosk_2.jpg, kiosk_3.jpg
│
├─► ML Service extracts features from kiosk images
│
├─► Compare kiosk features vs. original features
│   • Visual similarity score
│   • Shape match score
│   • Color match score
│   • Text/logo match score
│
├─► Calculate overall confidence: 87.5%
│
└─► Decision:
    • ≥85% → Item VERIFIED ✅ (Payment released)
    • 60-84% → MANUAL REVIEW ⚠️ (Admin checks)
    • <60% → VERIFICATION FAILED ❌ (Retry or refund)
```

---

## 🔬 Technical Implementation

### Method 1: Traditional Computer Vision (Fast, Reliable)

#### Step 1: Feature Extraction

```python
import cv2
import numpy as np
from skimage.feature import local_binary_pattern

def extract_features(image_path):
    """Extract multiple feature vectors from an image"""
    img = cv2.imread(image_path)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    
    # 1. COLOR HISTOGRAM (captures color distribution)
    hist_r = cv2.calcHist([img_rgb], [0], None, [32], [0, 256])
    hist_g = cv2.calcHist([img_rgb], [1], None, [32], [0, 256])
    hist_b = cv2.calcHist([img_rgb], [2], None, [32], [0, 256])
    color_hist = np.concatenate([hist_r, hist_g, hist_b]).flatten()
    color_hist = color_hist / color_hist.sum()  # Normalize
    
    # 2. SHAPE DESCRIPTORS (captures object geometry)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if len(contours) > 0:
        largest_contour = max(contours, key=cv2.contourArea)
        moments = cv2.moments(largest_contour)
        hu_moments = cv2.HuMoments(moments).flatten()
        # Log transform to make values comparable
        shape_features = -np.sign(hu_moments) * np.log10(np.abs(hu_moments) + 1e-10)
    else:
        shape_features = np.zeros(7)
    
    # 3. TEXTURE (captures surface patterns)
    lbp = local_binary_pattern(gray, P=8, R=1, method='uniform')
    lbp_hist, _ = np.histogram(lbp.ravel(), bins=59, range=(0, 59))
    texture_features = lbp_hist / lbp_hist.sum()  # Normalize
    
    # 4. ORB KEYPOINTS (Scale-invariant features - robust to rotation/scaling)
    orb = cv2.ORB_create(nfeatures=100)
    keypoints, descriptors = orb.detectAndCompute(gray, None)
    
    if descriptors is not None:
        # Aggregate descriptors into single vector
        orb_features = np.mean(descriptors, axis=0)
    else:
        orb_features = np.zeros(32)
    
    return {
        'color': color_hist,      # 96-dimensional
        'shape': shape_features,  # 7-dimensional
        'texture': texture_features,  # 59-dimensional
        'orb': orb_features       # 32-dimensional
    }
```

#### Step 2: Similarity Calculation

```python
from scipy.spatial.distance import cosine, euclidean
from scipy.stats import pearsonr

def calculate_similarity(features_original, features_kiosk):
    """
    Compare two feature sets and return similarity scores
    Returns: dict with individual scores and overall confidence
    """
    
    # 1. Color Similarity (using cosine similarity)
    color_sim = 1 - cosine(features_original['color'], features_kiosk['color'])
    color_sim = max(0, min(1, color_sim))  # Clamp to [0, 1]
    
    # 2. Shape Similarity (using Hu moments comparison)
    shape_diff = np.sum(np.abs(features_original['shape'] - features_kiosk['shape']))
    shape_sim = 1 / (1 + shape_diff)  # Convert distance to similarity
    
    # 3. Texture Similarity (using correlation)
    texture_corr, _ = pearsonr(features_original['texture'], features_kiosk['texture'])
    texture_sim = (texture_corr + 1) / 2  # Convert [-1, 1] to [0, 1]
    
    # 4. ORB Features Similarity
    orb_sim = 1 - cosine(features_original['orb'], features_kiosk['orb'])
    orb_sim = max(0, min(1, orb_sim))
    
    # WEIGHTED AVERAGE (weights based on importance)
    # Color is most important (40%), then shape (25%), texture (20%), ORB (15%)
    overall_similarity = (
        color_sim * 0.40 +
        shape_sim * 0.25 +
        texture_sim * 0.20 +
        orb_sim * 0.15
    )
    
    return {
        'color_similarity': color_sim * 100,
        'shape_similarity': shape_sim * 100,
        'texture_similarity': texture_sim * 100,
        'orb_similarity': orb_sim * 100,
        'overall_confidence': overall_similarity * 100
    }
```

#### Step 3: Multi-Image Comparison

```python
def verify_item_multi_image(original_images, kiosk_images):
    """
    Compare multiple original images with multiple kiosk images
    Uses best match strategy
    """
    
    # Extract features from all images
    original_features = [extract_features(img) for img in original_images]
    kiosk_features = [extract_features(img) for img in kiosk_images]
    
    # Compare each kiosk image with each original image
    similarity_matrix = []
    
    for kiosk_feat in kiosk_features:
        row_scores = []
        for orig_feat in original_features:
            similarity = calculate_similarity(orig_feat, kiosk_feat)
            row_scores.append(similarity['overall_confidence'])
        similarity_matrix.append(row_scores)
    
    # Strategy 1: BEST MATCH (take highest similarity)
    best_match_score = np.max(similarity_matrix)
    
    # Strategy 2: AVERAGE OF TOP 3 MATCHES
    flat_scores = np.array(similarity_matrix).flatten()
    top_3_avg = np.mean(np.sort(flat_scores)[-3:])
    
    # Strategy 3: MEAN OF ALL COMPARISONS
    mean_score = np.mean(similarity_matrix)
    
    # Use best match but require at least 2 good matches
    good_matches = np.sum(np.array(similarity_matrix) >= 85)
    
    final_confidence = best_match_score
    verified = final_confidence >= 85 and good_matches >= 2
    
    return {
        'verified': verified,
        'confidence': final_confidence,
        'best_match': best_match_score,
        'average_top3': top_3_avg,
        'mean_all': mean_score,
        'good_matches': good_matches,
        'similarity_matrix': similarity_matrix
    }
```

---

### Method 2: Deep Learning with YOLOv8 + Feature Matching

#### Step 1: Object Detection (Isolate Item)

```python
from ultralytics import YOLO

def detect_and_crop_item(image_path):
    """Use YOLO to detect and crop the main item"""
    model = YOLO('yolov8n.pt')
    results = model(image_path)
    
    # Get bounding box of detected item
    for r in results:
        boxes = r.boxes
        if len(boxes) > 0:
            # Get largest detected object
            box = boxes[0].xyxy[0].cpu().numpy()
            x1, y1, x2, y2 = map(int, box)
            
            # Crop item from image
            img = cv2.imread(image_path)
            cropped_item = img[y1:y2, x1:x2]
            
            return cropped_item, box
    
    return None, None
```

#### Step 2: Deep Feature Extraction (ResNet/EfficientNet)

```python
import torch
import torchvision.models as models
import torchvision.transforms as transforms
from PIL import Image

def extract_deep_features(image_path):
    """Extract deep learning features using pre-trained ResNet"""
    
    # Load pre-trained ResNet50
    model = models.resnet50(pretrained=True)
    # Remove classification layer to get feature vector
    model = torch.nn.Sequential(*list(model.children())[:-1])
    model.eval()
    
    # Preprocessing
    transform = transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406],
                           std=[0.229, 0.224, 0.225])
    ])
    
    # Load and preprocess image
    img = Image.open(image_path).convert('RGB')
    img_tensor = transform(img).unsqueeze(0)
    
    # Extract features
    with torch.no_grad():
        features = model(img_tensor)
    
    # Flatten to 1D vector
    features = features.squeeze().numpy()
    
    return features  # 2048-dimensional vector
```

#### Step 3: Cosine Similarity for Deep Features

```python
from sklearn.metrics.pairwise import cosine_similarity

def compare_deep_features(features1, features2):
    """Compare two deep feature vectors"""
    
    # Reshape for sklearn
    f1 = features1.reshape(1, -1)
    f2 = features2.reshape(1, -1)
    
    # Calculate cosine similarity
    similarity = cosine_similarity(f1, f2)[0][0]
    
    return similarity * 100  # Convert to percentage
```

---

### Method 3: SIFT/SURF Feature Matching (Most Robust)

```python
def match_keypoints_sift(img1_path, img2_path):
    """
    Match keypoints between two images using SIFT
    Returns match ratio (higher = more similar)
    """
    
    # Read images
    img1 = cv2.imread(img1_path, cv2.IMREAD_GRAYSCALE)
    img2 = cv2.imread(img2_path, cv2.IMREAD_GRAYSCALE)
    
    # Initialize SIFT detector
    sift = cv2.SIFT_create()
    
    # Detect keypoints and compute descriptors
    kp1, des1 = sift.detectAndCompute(img1, None)
    kp2, des2 = sift.detectAndCompute(img2, None)
    
    if des1 is None or des2 is None:
        return 0
    
    # FLANN-based matcher
    FLANN_INDEX_KDTREE = 1
    index_params = dict(algorithm=FLANN_INDEX_KDTREE, trees=5)
    search_params = dict(checks=50)
    flann = cv2.FlannBasedMatcher(index_params, search_params)
    
    # Find matches
    matches = flann.knnMatch(des1, des2, k=2)
    
    # Ratio test (Lowe's ratio test)
    good_matches = []
    for m, n in matches:
        if m.distance < 0.7 * n.distance:
            good_matches.append(m)
    
    # Calculate match ratio
    match_ratio = len(good_matches) / min(len(kp1), len(kp2))
    
    return {
        'match_ratio': match_ratio * 100,
        'good_matches': len(good_matches),
        'total_keypoints_img1': len(kp1),
        'total_keypoints_img2': len(kp2)
    }
```

---

## 🎯 Recommended Hybrid Approach

**Combine multiple methods for best accuracy:**

```python
def hybrid_verification(original_images, kiosk_images):
    """
    Use multiple verification methods and combine results
    """
    
    scores = {
        'traditional_cv': [],
        'deep_learning': [],
        'sift_matching': []
    }
    
    # Method 1: Traditional CV
    for orig_img in original_images:
        for kiosk_img in kiosk_images:
            orig_feat = extract_features(orig_img)
            kiosk_feat = extract_features(kiosk_img)
            sim = calculate_similarity(orig_feat, kiosk_feat)
            scores['traditional_cv'].append(sim['overall_confidence'])
    
    # Method 2: Deep Learning
    for orig_img in original_images:
        for kiosk_img in kiosk_images:
            orig_deep = extract_deep_features(orig_img)
            kiosk_deep = extract_deep_features(kiosk_img)
            sim = compare_deep_features(orig_deep, kiosk_deep)
            scores['deep_learning'].append(sim)
    
    # Method 3: SIFT Matching
    for orig_img in original_images:
        for kiosk_img in kiosk_images:
            match_result = match_keypoints_sift(orig_img, kiosk_img)
            scores['sift_matching'].append(match_result['match_ratio'])
    
    # Calculate weighted average
    # Traditional CV: 40% (reliable for color/shape)
    # Deep Learning: 35% (good for complex patterns)
    # SIFT Matching: 25% (robust to rotation/scale)
    
    final_score = (
        np.max(scores['traditional_cv']) * 0.40 +
        np.max(scores['deep_learning']) * 0.35 +
        np.max(scores['sift_matching']) * 0.25
    )
    
    return {
        'verified': final_score >= 85,
        'confidence': final_score,
        'method_scores': {
            'traditional_best': np.max(scores['traditional_cv']),
            'deep_learning_best': np.max(scores['deep_learning']),
            'sift_best': np.max(scores['sift_matching'])
        }
    }
```

---

## 🚨 Handling Edge Cases

### Case 1: Item Has Stickers/Damage Added Later

**Problem**: Owner adds new stickers or item gets scratched

**Solution**:
```python
# Focus on immutable features
- ✅ Overall shape and size
- ✅ Brand/model (OCR)
- ✅ Color distribution
- ❌ Ignore small surface changes (use texture tolerance)
```

### Case 2: Different Lighting Conditions

**Problem**: Home lighting vs. locker LED lighting

**Solution**:
```python
# Normalize brightness and contrast
def normalize_lighting(image):
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    
    # Apply CLAHE (Contrast Limited Adaptive Histogram Equalization)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    l = clahe.apply(l)
    
    normalized = cv2.merge([l, a, b])
    return cv2.cvtColor(normalized, cv2.COLOR_LAB2BGR)
```

### Case 3: Item Orientation Changed

**Problem**: Item placed upside down or rotated

**Solution**:
```python
# Use rotation-invariant features
- ✅ Hu Moments (rotation invariant)
- ✅ SIFT/ORB keypoints (rotation invariant)
- ✅ Color histogram (order doesn't matter)
```

### Case 4: Multiple Similar Items

**Problem**: Two identical calculators (same model)

**Solution**:
```python
# Check for unique identifiers
def check_unique_identifiers(image):
    # OCR for serial numbers
    import pytesseract
    text = pytesseract.image_to_string(image)
    
    # Look for:
    # - Serial numbers
    # - Scratches/unique marks
    # - Stickers
    # - Wear patterns
    
    return unique_features
```

---

## 📊 Performance Thresholds

```python
CONFIDENCE_THRESHOLDS = {
    'VERIFIED': 85,      # Auto-approve
    'MANUAL_REVIEW': 60, # Send to admin
    'REJECTED': 60       # Auto-reject (or allow retry)
}

MAX_RETRY_ATTEMPTS = 10

def make_decision(confidence_score, attempt_number):
    if confidence_score >= CONFIDENCE_THRESHOLDS['VERIFIED']:
        return 'APPROVED', 'Item verified successfully'
    
    elif confidence_score >= CONFIDENCE_THRESHOLDS['MANUAL_REVIEW']:
        return 'PENDING', 'Manual review required by admin'
    
    else:
        if attempt_number < MAX_RETRY_ATTEMPTS:
            return 'RETRY', f'Verification failed. Please reposition item. Attempt {attempt_number}/10'
        else:
            return 'REJECTED', 'Verification failed after max attempts. Transaction cancelled.'
```

---

## 🎥 Camera Setup Inside Locker

### Option 1: Single Rotating Camera
```
┌─────────────────┐
│   Locker Door   │
├─────────────────┤
│                 │
│     [ITEM]      │ ← Item placed here
│                 │
│    🎥 (rotate)  │ ← Camera on servo motor
│   /  |  \       │   Captures 3-5 angles
│  /   |   \      │
└─────────────────┘
```

### Option 2: Multiple Fixed Cameras (Better)
```
┌─────────────────┐
│   Locker Door   │
├─────────────────┤
│  🎥            🎥│ ← Top corners
│                 │
│     [ITEM]      │
│                 │
│  🎥     🎥      │ ← Side angles
│        🎥       │ ← Bottom/center
└─────────────────┘
```

**Recommendation**: 
- **3 cameras minimum** (front, left 45°, right 45°)
- **5 cameras ideal** (front, left, right, top, close-up)
- **USB cameras** (easier) OR **CSI cameras** (faster)
- **LED ring light** inside locker for consistent lighting

---

## 💾 Database Schema for Verification

```sql
-- Store original features when item is listed
CREATE TABLE item_features (
    id UUID PRIMARY KEY,
    item_id UUID REFERENCES items(id),
    image_url VARCHAR(500),
    color_histogram JSON,      -- 96 floats
    shape_features JSON,        -- 7 floats
    texture_features JSON,      -- 59 floats
    orb_features JSON,          -- 32 floats
    deep_features JSON,         -- 2048 floats (optional)
    created_at TIMESTAMP
);

-- Store verification attempts
CREATE TABLE verification_logs (
    id UUID PRIMARY KEY,
    rental_id UUID REFERENCES rentals(id),
    attempt_number INT,
    kiosk_images JSON,          -- Array of S3 URLs
    confidence_score FLOAT,
    method_scores JSON,         -- Individual method scores
    verified BOOLEAN,
    decision VARCHAR(20),       -- APPROVED/PENDING/RETRY/REJECTED
    timestamp TIMESTAMP
);
```

---

## 🚀 Implementation Steps

### Phase 1: Basic Verification (MVP)
1. ✅ Traditional CV (color + shape + texture)
2. ✅ Single camera, 3 images
3. ✅ 85% threshold
4. ✅ 10 retry attempts

### Phase 2: Enhanced Verification
1. ✅ Add SIFT keypoint matching
2. ✅ Multiple cameras (3-5)
3. ✅ Lighting normalization
4. ✅ Admin review panel for 60-84% scores

### Phase 3: Production-Grade
1. ✅ Deep learning features (ResNet50)
2. ✅ Hybrid scoring (combine all methods)
3. ✅ OCR for serial numbers
4. ✅ A/B testing different thresholds

---

## 📞 Support

For verification system questions:
- Technical: ml@engirenthub.com
- Camera setup: hardware@engirenthub.com
- GitHub Issues: [Report bugs](https://github.com/your-repo/issues)
