import 'dart:ui' show Rect, Size;

/// What the camera sees right now, for the ring and the coach to react to.
/// COACHING ONLY: it never blocks the shutter and never decides anything. The
/// server compares the photo with the enrolled face, exactly as before.
enum LivenessHint { searching, ready, tooFar, tooClose, offCentre, multiple }

/// Pure mapping from one detection result to a hint, so it is testable
/// without a camera. [box] is the face's bounding box in the UPRIGHT image of
/// [image] size; [yawDeg] is ML Kit's head yaw.
///
/// Limits (share of the picture's width the face takes, and how far its centre
/// may be from the picture's centre) are coaching comfort values, not a test:
/// a photo taken outside them is still sent and judged by the server.
LivenessHint hintFor({required int faceCount, Rect? box, Size? image, double? yawDeg}) {
  if (faceCount <= 0 || box == null || image == null || image.width <= 0 || image.height <= 0) {
    return LivenessHint.searching;
  }
  if (faceCount > 1) return LivenessHint.multiple;
  final widthShare = box.width / image.width;
  if (widthShare < 0.28) return LivenessHint.tooFar;
  if (widthShare > 0.80) return LivenessHint.tooClose;
  final dx = (box.center.dx - image.width / 2).abs() / image.width;
  final dy = (box.center.dy - image.height / 2).abs() / image.height;
  if (dx > 0.18 || dy > 0.20) return LivenessHint.offCentre;
  if ((yawDeg ?? 0).abs() > 18) return LivenessHint.offCentre;
  return LivenessHint.ready;
}

/// The sentence under the oval for a hint.
String coachText(LivenessHint hint) => switch (hint) {
  LivenessHint.searching => 'Looking for your face…',
  LivenessHint.multiple => 'Only one person in the picture, please',
  LivenessHint.tooFar => 'Move a little closer',
  LivenessHint.tooClose => 'Move a little further away',
  LivenessHint.offCentre => 'Look straight at the camera, face inside the oval',
  LivenessHint.ready => 'Looks good — tap the button to take the photo',
};
