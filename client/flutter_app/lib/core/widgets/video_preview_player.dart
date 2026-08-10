import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import 'app_widgets.dart';
import '../theme/tokens.dart';

/// A listing's optional clip (checklist Stage 7) — muted always, tap to
/// play/pause, first frame doubles as the poster (no separate thumbnail
/// generation needed: an initialized-but-unplayed controller already shows
/// frame zero). Takes an already-constructed [VideoPlayerController] rather
/// than a URL/file itself, so one widget serves both the pre-upload local
/// preview (create/edit listing) and the uploaded network playback (item
/// detail) — the caller decides `.file()`/`.networkUrl()`, this only owns
/// the play/pause UI.
class VideoPreviewPlayer extends StatefulWidget {
  const VideoPreviewPlayer({super.key, required this.controller, this.onRemove});

  final VideoPlayerController controller;
  final VoidCallback? onRemove;

  @override
  State<VideoPreviewPlayer> createState() => _VideoPreviewPlayerState();
}

class _VideoPreviewPlayerState extends State<VideoPreviewPlayer> {
  bool _ready = false;
  bool _playing = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    widget.controller.setVolume(0);
    widget.controller.setLooping(false);
    widget.controller.addListener(_onTick);
    widget.controller.initialize().then((_) {
      if (mounted) setState(() => _ready = true);
    }).catchError((_) {
      if (mounted) setState(() => _failed = true);
    });
  }

  void _onTick() {
    final playing = widget.controller.value.isPlaying;
    if (playing != _playing && mounted) setState(() => _playing = playing);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onTick);
    super.dispose();
  }

  void _toggle() {
    if (!_ready) return;
    if (_playing) {
      widget.controller.pause();
    } else {
      widget.controller.play();
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final aspectRatio = _ready && widget.controller.value.aspectRatio > 0
        ? widget.controller.value.aspectRatio
        : 16 / 9;

    return ClipRRect(
      borderRadius: AppRadius.card,
      child: AspectRatio(
        aspectRatio: aspectRatio,
        child: Container(
          color: p.isDark ? Colors.black : const Color(0xFF0E1420),
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (_failed)
                Center(
                  child: Icon(Icons.videocam_off_rounded, size: 32, color: p.muted),
                )
              else if (_ready)
                // Covered entirely by the play-button overlay below while
                // paused (same Stack region, same _toggle), so the label
                // tracks actual state rather than always claiming "Pause" —
                // avoids a contradictory announcement on the rare chance
                // both nodes are reachable at once.
                Semantics(
                  label: _playing ? 'Pause video' : 'Play video',
                  button: true,
                  child: GestureDetector(onTap: _toggle, child: VideoPlayer(widget.controller)),
                )
              else
                Center(
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white70),
                  ),
                ),
              if (_ready && !_playing)
                Semantics(
                  label: 'Play video',
                  button: true,
                  excludeSemantics: true,
                  child: GestureDetector(
                    onTap: _toggle,
                    child: Container(
                      color: Colors.black.withValues(alpha: 0.22),
                      child: const Center(
                        child: Icon(
                          Icons.play_circle_fill_rounded,
                          size: 54,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ),
                ),
              if (widget.onRemove != null)
                Positioned(
                  top: 8,
                  right: 8,
                  child: Semantics(
                    label: 'Remove video',
                    button: true,
                    excludeSemantics: true,
                    child: GestureDetector(
                      onTap: widget.onRemove,
                      child: Container(
                        padding: const EdgeInsets.all(5),
                        decoration: const BoxDecoration(
                          color: Colors.black54,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.close_rounded, size: 16, color: Colors.white),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
