import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/models/feedback_model.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/utils/toast_utils.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../core/widgets/form_widgets.dart';
import '../models/feedback_service.dart';

/// Checklist Stage 3.2 — reachable from Profile → Send feedback, and
/// contextually from the places things actually go wrong: a failed kiosk
/// scan, a payment error, a disputed rental. Before this there was no route
/// to the people running the system at all (mandate §2.9.3) — a student who
/// hit a problem had nowhere to put it, and the admins running a deployment
/// had no signal except rentals silently failing.
///
/// The contextual params pre-fill category and IDs — a report filed from a
/// stuck locker should already know which kiosk and which rental without the
/// student having to type or remember either.
class SendFeedbackScreen extends StatefulWidget {
  const SendFeedbackScreen({
    super.key,
    this.initialCategory,
    this.initialBody,
    this.contextNote,
    this.screen,
    this.rentalId,
    this.kioskId,
    this.itemId,
  });

  final String? initialCategory;
  final String? initialBody;

  /// Shown above the form when this screen was opened contextually, so the
  /// student understands why fields are already filled in — e.g. "Filed from
  /// your kiosk scan attempt — the kiosk ID is attached automatically."
  final String? contextNote;

  final String? screen;
  final String? rentalId;
  final String? kioskId;
  final String? itemId;

  @override
  State<SendFeedbackScreen> createState() => _SendFeedbackScreenState();
}

class _SendFeedbackScreenState extends State<SendFeedbackScreen> {
  final _formKey = GlobalKey<FormState>();
  final _bodyCtrl = TextEditingController();
  final _service = FeedbackService();
  final _picker = ImagePicker();

  late String _category = widget.initialCategory ?? 'BUG';
  File? _screenshot;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    if (widget.initialBody != null) _bodyCtrl.text = widget.initialBody!;
  }

  @override
  void dispose() {
    _bodyCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickScreenshot() async {
    final xFile = await _picker.pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (xFile != null) setState(() => _screenshot = File(xFile.path));
  }

  Future<void> _pickCategory() async {
    final p = AppPalette.of(context);
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: p.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.md)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(
                  AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.xs),
              child: SectionLabel('What kind of report is this'),
            ),
            for (final entry in kFeedbackCategories.entries)
              ListTile(
                dense: true,
                title: Text(entry.value, style: TextStyle(color: p.ink)),
                trailing: entry.key == _category
                    ? Icon(Icons.check_rounded, size: 18, color: p.primary)
                    : null,
                onTap: () => Navigator.pop(sheetContext, entry.key),
              ),
            const SizedBox(height: AppSpacing.xs),
          ],
        ),
      ),
    );
    if (picked != null && mounted) setState(() => _category = picked);
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _submitting = true);

    final result = await _service.submit(
      category: _category,
      body: _bodyCtrl.text.trim(),
      screen: widget.screen,
      rentalId: widget.rentalId,
      kioskId: widget.kioskId,
      itemId: widget.itemId,
      screenshot: _screenshot,
    );

    if (!mounted) return;
    setState(() => _submitting = false);

    if (result['success'] == true) {
      AppToast.success(context, 'Report sent',
          'Thanks — an admin will look into it.');
      Navigator.pop(context, true);
    } else {
      AppToast.error(context, 'Could not send your report',
          (result['error'] as String?) ?? 'Please try again.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(title: const Text('Send Feedback')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.lg),
          children: [
            if (widget.contextNote != null)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.md),
                child: NoticeBanner(
                  kind: NoticeKind.info,
                  message: widget.contextNote!,
                  icon: Icons.info_outline_rounded,
                ),
              ),
            FormSection(
              title: 'What kind of report',
              icon: Icons.category_outlined,
              children: [
                AppPickerField(
                  label: 'Category',
                  value: kFeedbackCategories[_category] ?? '',
                  onTap: _pickCategory,
                ),
              ],
            ),
            FormSection(
              title: 'What happened',
              icon: Icons.edit_note_rounded,
              children: [
                AppField(
                  label: 'Description',
                  controller: _bodyCtrl,
                  hint: 'The more detail the better — what you expected, what '
                      'happened instead, and when.',
                  maxLines: 6,
                  maxLength: 4000,
                  textCapitalization: TextCapitalization.sentences,
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) return 'Required';
                    if (v.trim().length < 10) return 'A little more detail would help';
                    return null;
                  },
                ),
              ],
            ),
            FormSection(
              title: 'Screenshot (optional)',
              icon: Icons.image_outlined,
              caption: 'Only attach one if it helps explain the problem — '
                  'avoid screenshots with other people\'s information visible.',
              children: [
                if (_screenshot == null)
                  OutlinedButton.icon(
                    onPressed: _pickScreenshot,
                    icon: const Icon(Icons.add_photo_alternate_outlined, size: 18),
                    label: const Text('Attach a screenshot'),
                  )
                else
                  Stack(
                    children: [
                      ClipRRect(
                        borderRadius: AppRadius.input,
                        child: Image.file(_screenshot!, height: 160, width: double.infinity, fit: BoxFit.cover),
                      ),
                      Positioned(
                        top: 6,
                        right: 6,
                        child: Semantics(
                          label: 'Remove screenshot',
                          button: true,
                          excludeSemantics: true,
                          child: GestureDetector(
                            onTap: () => setState(() => _screenshot = null),
                            child: Container(
                              padding: const EdgeInsets.all(4),
                              decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                              child: const Icon(Icons.close_rounded, size: 15, color: Colors.white),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
              ],
            ),
            if (widget.rentalId != null || widget.kioskId != null || widget.itemId != null)
              NoticeBanner(
                kind: NoticeKind.success,
                message: [
                  if (widget.rentalId != null) 'Rental attached automatically.',
                  if (widget.kioskId != null) 'Kiosk ID attached automatically.',
                  if (widget.itemId != null) 'Listing attached automatically.',
                ].join(' '),
                icon: Icons.attach_file_rounded,
              ),
          ],
        ),
      ),
      bottomNavigationBar: StickyActionBar(
        label: 'Send report',
        icon: Icons.send_rounded,
        busy: _submitting,
        onPressed: _submit,
      ),
    );
  }
}
