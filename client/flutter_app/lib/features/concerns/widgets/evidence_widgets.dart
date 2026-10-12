import 'dart:io';

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../../../core/widgets/app_widgets.dart';

/// A photo from the network (a case's evidence) or from this phone (a report
/// being written). Tapping opens it full screen with pinch-to-zoom.
class EvidencePhoto extends StatelessWidget {
  final String? url;
  final String? filePath;
  final VoidCallback? onRemove;
  final double size;
  const EvidencePhoto({super.key, this.url, this.filePath, this.onRemove, this.size = 96});

  ImageProvider get _provider => filePath != null ? FileImage(File(filePath!)) as ImageProvider : NetworkImage(url!);

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Stack(
      children: [
        GestureDetector(
          onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => _FullPhoto(provider: _provider))),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: Image(
              image: _provider,
              width: size,
              height: size,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => Container(
                width: size,
                height: size,
                color: p.surfaceAlt,
                alignment: Alignment.center,
                child: Text('Photo not available', textAlign: TextAlign.center, style: TextStyle(fontSize: 11, color: p.muted)),
              ),
            ),
          ),
        ),
        if (onRemove != null)
          Positioned(
            top: 2,
            right: 2,
            child: Material(
              color: Colors.black54,
              shape: const CircleBorder(),
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: onRemove,
                child: const Padding(
                  padding: EdgeInsets.all(4),
                  child: Icon(Icons.close_rounded, size: 16, color: Colors.white),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _FullPhoto extends StatelessWidget {
  final ImageProvider provider;
  const _FullPhoto({required this.provider});

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: Colors.black,
          foregroundColor: Colors.white,
          titleTextStyle: Theme.of(context).appBarTheme.titleTextStyle?.copyWith(color: Colors.white),
          title: const Text('Photo'),
        ),
        body: Center(child: InteractiveViewer(maxScale: 5, child: Image(image: provider, fit: BoxFit.contain))),
      );
}

/// A video from the network (a case's evidence) or from this phone. Plays
/// inline; never autoplays.
class EvidenceVideo extends StatefulWidget {
  final String? url;
  final String? filePath;
  final VoidCallback? onRemove;
  const EvidenceVideo({super.key, this.url, this.filePath, this.onRemove});

  @override
  State<EvidenceVideo> createState() => _EvidenceVideoState();
}

class _EvidenceVideoState extends State<EvidenceVideo> {
  late final VideoPlayerController _c = widget.filePath != null
      ? VideoPlayerController.file(File(widget.filePath!))
      : VideoPlayerController.networkUrl(Uri.parse(widget.url!));
  bool _ready = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _c.addListener(() {
      if (mounted) setState(() {});
    });
    _c.initialize().then((_) {
      if (mounted) setState(() => _ready = true);
    }).catchError((_) {
      if (mounted) setState(() => _failed = true);
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  String _fmt(Duration d) => '${d.inMinutes}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    if (_failed) {
      return Container(
        height: 120,
        decoration: BoxDecoration(color: p.surfaceAlt, borderRadius: BorderRadius.circular(12)),
        alignment: Alignment.center,
        child: Text('The video could not be played. Check your connection.', style: TextStyle(color: p.muted)),
      );
    }
    final ratio = _ready && _c.value.aspectRatio > 0 ? _c.value.aspectRatio : 16 / 9;
    final playing = _c.value.isPlaying;
    // A phone video is portrait; at full width it was taller than the screen and
    // pushed the Send button out of sight. Cap the height and letterbox it.
    return Stack(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: Container(
            color: Colors.black,
            constraints: const BoxConstraints(maxHeight: 360),
            child: Align(
              heightFactor: 1,
              child: AspectRatio(
                aspectRatio: ratio,
                child: !_ready
                    ? const Center(child: CircularProgressIndicator(strokeWidth: 2))
                    : GestureDetector(
                        onTap: () => playing ? _c.pause() : _c.play(),
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            VideoPlayer(_c),
                            if (!playing)
                              const CircleAvatar(
                                radius: 28,
                                backgroundColor: Colors.black54,
                                child: Icon(Icons.play_arrow_rounded, size: 36, color: Colors.white),
                              ),
                            Positioned(
                              left: 8,
                              right: 8,
                              bottom: 6,
                              child: Row(
                                children: [
                                  Expanded(child: VideoProgressIndicator(_c, allowScrubbing: true)),
                                  const SizedBox(width: 8),
                                  Text(
                                    '${_fmt(_c.value.position)} / ${_fmt(_c.value.duration)}',
                                    style: const TextStyle(color: Colors.white, fontSize: 11),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
              ),
            ),
          ),
        ),
        if (widget.onRemove != null)
          Positioned(
            top: 6,
            right: 6,
            child: Material(
              color: Colors.black54,
              shape: const CircleBorder(),
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: widget.onRemove,
                child: const Padding(padding: EdgeInsets.all(6), child: Icon(Icons.close_rounded, size: 18, color: Colors.white)),
              ),
            ),
          ),
      ],
    );
  }
}
