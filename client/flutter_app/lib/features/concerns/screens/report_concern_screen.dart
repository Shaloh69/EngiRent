import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/utils/toast_utils.dart';
import '../../../core/widgets/app_widgets.dart';
import '../concern_api.dart';
import '../widgets/evidence_widgets.dart';
import 'video_recorder_screen.dart';

/// Concerns v2: write a report (or, with [concernId], an answer to one) with a
/// statement, photos and a video. The requirement comes from the server, and
/// every missing piece is shown as a checklist before sending, so a student
/// never wonders why the button is disabled.
class ReportConcernScreen extends StatefulWidget {
  final String kind;
  final String? rentalId; // a new report
  final String? concernId; // an answer to an existing case
  final String? referenceNo;
  final String itemTitle;
  final Map<String, dynamic> requirement; // {minStatementChars, maxStatementChars, minPhotos, maxPhotos, videoRequired, maxVideos}
  final String? closesAt;

  const ReportConcernScreen({
    super.key,
    required this.kind,
    required this.itemTitle,
    required this.requirement,
    this.rentalId,
    this.concernId,
    this.referenceNo,
    this.closesAt,
  });

  bool get isAnswer => concernId != null;

  @override
  State<ReportConcernScreen> createState() => _ReportConcernScreenState();
}

class _ReportConcernScreenState extends State<ReportConcernScreen> {
  final _statement = TextEditingController();
  final _statementFocus = FocusNode();
  final _picker = ImagePicker();
  final List<String> _photos = [];
  String? _video;
  bool _sending = false;

  int get _minText => (widget.requirement['minStatementChars'] as num?)?.toInt() ?? 50;
  int get _maxText => (widget.requirement['maxStatementChars'] as num?)?.toInt() ?? 2000;
  int get _minPhotos => (widget.requirement['minPhotos'] as num?)?.toInt() ?? 1;
  int get _maxPhotos => (widget.requirement['maxPhotos'] as num?)?.toInt() ?? 5;
  bool get _videoRequired => widget.requirement['videoRequired'] == true;

  @override
  void initState() {
    super.initState();
    _statement.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _statement.dispose();
    _statementFocus.dispose();
    super.dispose();
  }

  Future<void> _addPhoto(ImageSource source) async {
    if (_photos.length >= _maxPhotos) return;
    FocusScope.of(context).unfocus(); // or the keyboard comes back over the new photo
    final x = await _picker.pickImage(source: source, imageQuality: 80, maxWidth: 1800);
    if (x != null && mounted) setState(() => _photos.add(x.path));
  }

  Future<void> _recordVideo() async {
    _statementFocus.unfocus();
    final path = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => const VideoRecorderScreen()));
    // Popping a Flutter route hands focus back to the field that had it, which
    // reopened the keyboard over the new video; drop it once the pop settles.
    _statementFocus.unfocus();
    WidgetsBinding.instance.addPostFrameCallback((_) => _statementFocus.unfocus());
    if (path == null || !mounted) return;
    final bytes = await File(path).length();
    if (bytes > 40 * 1024 * 1024) {
      if (mounted) AppToast.error(context, 'Video too large', 'Record a shorter video (under 30 seconds) and try again.');
      return;
    }
    setState(() => _video = path);
  }

  List<String> get _missing {
    final m = <String>[];
    final len = _statement.text.trim().length;
    if (len < _minText) m.add('Describe it in at least $_minText characters (${_minText - len} more).');
    if (_photos.length < _minPhotos) m.add('Add at least $_minPhotos photo${_minPhotos == 1 ? '' : 's'}.');
    if (_videoRequired && _video == null) m.add('Record a short video of the problem.');
    return m;
  }

  Future<void> _send() async {
    setState(() => _sending = true);
    try {
      if (widget.isAnswer) {
        await ConcernApi.respond(widget.concernId!, statement: _statement.text.trim(), photos: _photos, video: _video);
        if (!mounted) return;
        AppToast.success(context, 'Answer sent', 'An admin now decides. You will be told here and by email.');
        Navigator.pop(context, true);
      } else {
        final c = await ConcernApi.report(
          rentalId: widget.rentalId!,
          kind: widget.kind,
          statement: _statement.text.trim(),
          photos: _photos,
          video: _video,
        );
        if (!mounted) return;
        AppToast.success(context, 'Report sent', 'Case ${c['referenceNo']}. The other student has 24 hours to answer, then an admin decides.');
        Navigator.pop(context, c['id'] as String?);
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Not sent', e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final missing = _missing;
    final steps = widget.isAnswer
        ? const [
            'The student who reported this sees your answer, photos and video.',
            'An admin compares both sides with the photos taken at the locker, and decides.',
            'You are told the decision here and by email, with the admin\'s explanation.',
          ]
        : ConcernText.steps(widget.kind);

    return Scaffold(
      appBar: AppBar(title: Text(widget.isAnswer ? 'Give your side' : ConcernText.title(widget.kind))),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
          children: [
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.itemTitle, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 6),
                  Text(
                    widget.isAnswer
                        ? 'Case ${widget.referenceNo ?? ''}: the other student reported "${ConcernText.title(widget.kind)}". Tell your side and add photos or a video if you can.'
                        : ConcernText.explain(widget.kind),
                    style: TextStyle(color: p.muted, height: 1.4),
                  ),
                  if (widget.closesAt != null || !widget.isAnswer) ...[
                    const SizedBox(height: 8),
                    Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Icon(Icons.schedule_rounded, size: 16, color: p.muted),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                            widget.closesAt != null
                                ? '${widget.isAnswer ? 'Answer' : 'Report'} before ${ConcernText.when(widget.closesAt)}'
                                : ConcernText.openUntil(widget.kind),
                            style: TextStyle(fontSize: 13, color: p.muted)),
                      ),
                    ]),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 12),
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('What happens next', style: TextStyle(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  for (var i = 0; i < steps.length; i++)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        CircleAvatar(radius: 10, backgroundColor: p.primary, child: Text('${i + 1}', style: const TextStyle(fontSize: 11, color: Colors.white))),
                        const SizedBox(width: 8),
                        Expanded(child: Text(steps[i], style: const TextStyle(height: 1.35))),
                      ]),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            SectionLabel(widget.isAnswer ? 'Your side' : 'What is wrong'),
            TextField(
              controller: _statement,
              focusNode: _statementFocus,
              minLines: 4,
              maxLines: 10,
              maxLength: _maxText,
              decoration: InputDecoration(
                hintText: widget.isAnswer
                    ? 'e.g. It worked when I deposited it; my listing photos show the screen lit.'
                    : ConcernText.hint(widget.kind),
                helperText: 'At least $_minText characters',
              ),
            ),
            const SizedBox(height: 12),
            SectionLabel('Photos (${_photos.length}/$_maxPhotos${_minPhotos > 0 ? ', at least $_minPhotos' : ', optional'})'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final ph in _photos) EvidencePhoto(filePath: ph, onRemove: () => setState(() => _photos.remove(ph))),
                if (_photos.length < _maxPhotos) ...[
                  _AddTile(icon: Icons.photo_camera_rounded, label: 'Take photo', onTap: () => _addPhoto(ImageSource.camera)),
                  _AddTile(icon: Icons.photo_library_rounded, label: 'From gallery', onTap: () => _addPhoto(ImageSource.gallery)),
                ],
              ],
            ),
            const SizedBox(height: 4),
            Text(
                widget.isAnswer
                    ? 'Anything that supports your side, e.g. a photo of the item from before the rental.'
                    : 'Show the whole item, then the problem close up, in good light.',
                style: TextStyle(fontSize: 12, color: p.muted)),
            const SizedBox(height: 16),
            SectionLabel(_videoRequired ? 'Video (required, up to 30 seconds)' : 'Video (optional, up to 30 seconds)'),
            if (_video != null)
              EvidenceVideo(key: ValueKey(_video), filePath: _video, onRemove: () => setState(() => _video = null))
            else
              OutlinedButton.icon(
                onPressed: _recordVideo,
                icon: const Icon(Icons.videocam_rounded),
                label: const Text('Record a video'),
              ),
            const SizedBox(height: 4),
            Text('Recorded here in the app, so it is clearly from today.', style: TextStyle(fontSize: 12, color: p.muted)),
            const SizedBox(height: 20),
            if (missing.isNotEmpty)
              AppCard(
                color: AppColors.warning.withValues(alpha: 0.10),
                borderColor: AppColors.warning.withValues(alpha: 0.4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Still needed before you can send', style: TextStyle(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 6),
                    for (final m in missing)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          const Icon(Icons.radio_button_unchecked_rounded, size: 16, color: AppColors.warning),
                          const SizedBox(width: 6),
                          Expanded(child: Text(m)),
                        ]),
                      ),
                  ],
                ),
              ),
            const SizedBox(height: 12),
            ElevatedButton.icon(
              onPressed: missing.isEmpty && !_sending ? _send : null,
              icon: _sending
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.send_rounded),
              label: Text(_sending ? 'Sending… (a video can take a minute)' : (widget.isAnswer ? 'Send my answer' : 'Send report')),
            ),
          ],
        ),
      ),
    );
  }
}

class _AddTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _AddTile({required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        width: 96,
        height: 96,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: p.border, width: 1.5),
          color: p.surfaceAlt,
        ),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(icon, color: p.primary),
          const SizedBox(height: 4),
          Text(label, style: TextStyle(fontSize: 11, color: p.muted)),
        ]),
      ),
    );
  }
}
