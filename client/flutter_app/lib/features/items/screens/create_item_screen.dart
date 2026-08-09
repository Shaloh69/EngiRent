import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/api_service.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/utils/toast_utils.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../core/widgets/form_widgets.dart';
import '../models/item_service.dart';

/// Listing form — mandate §2.2, modelled on the "sell an item" flow from the
/// FlutterShop reference: photos first (they're what a listing lives or dies
/// on), then what it is, then what it costs.
///
/// The previous version was a flat column of nine fields with the photo picker
/// buried in the middle and no indication of what the owner would actually
/// earn. Pricing now previews the payout, and the cover photo is explicit.
class CreateItemScreen extends StatefulWidget {
  const CreateItemScreen({super.key});

  @override
  State<CreateItemScreen> createState() => _CreateItemScreenState();
}

class _CreateItemScreenState extends State<CreateItemScreen> {
  final _formKey = GlobalKey<FormState>();
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _priceCtrl = TextEditingController();
  final _depositCtrl = TextEditingController();
  final _serialCtrl = TextEditingController();
  final _service = ItemService();
  final _api = ApiService();
  final _picker = ImagePicker();

  String _selectedCategory = AppConstants.categories.keys.first;
  String _selectedCondition = 'GOOD';
  bool _submitting = false;
  bool _photoError = false;
  final List<File> _pickedImages = [];

  static const _conditions = <({String key, String label, String detail})>[
    (key: 'NEW', label: 'New', detail: 'Unused, still boxed'),
    (key: 'EXCELLENT', label: 'Excellent', detail: 'Barely used, no marks'),
    (key: 'GOOD', label: 'Good', detail: 'Light wear, works perfectly'),
    (key: 'FAIR', label: 'Fair', detail: 'Visible wear, fully functional'),
  ];

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _priceCtrl.dispose();
    _depositCtrl.dispose();
    _serialCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickImage(ImageSource source) async {
    if (_pickedImages.length >= 5) {
      AppToast.error(context, 'Maximum 5 photos',
          'Remove one before adding another.');
      return;
    }
    final xFile = await _picker.pickImage(source: source, imageQuality: 85);
    if (xFile != null) {
      setState(() {
        _pickedImages.add(File(xFile.path));
        _photoError = false;
      });
    }
  }

  void _removeImage(int index) {
    setState(() => _pickedImages.removeAt(index));
  }

  /// Reorders a photo to the front. The first image is the cover shown in
  /// search results, so which one leads is a decision the owner should own.
  void _makeCover(int index) {
    if (index == 0) return;
    setState(() {
      final file = _pickedImages.removeAt(index);
      _pickedImages.insert(0, file);
    });
  }

  Future<void> _showPhotoSource() async {
    final p = AppPalette.of(context);
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: p.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.md)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: AppSpacing.xs),
            ListTile(
              leading: Icon(Icons.photo_camera_outlined, color: p.primary),
              title: const Text('Take a photo'),
              onTap: () {
                Navigator.pop(sheetContext);
                _pickImage(ImageSource.camera);
              },
            ),
            ListTile(
              leading: Icon(Icons.photo_library_outlined, color: p.primary),
              title: const Text('Choose from gallery'),
              onTap: () {
                Navigator.pop(sheetContext);
                _pickImage(ImageSource.gallery);
              },
            ),
            const SizedBox(height: AppSpacing.xs),
          ],
        ),
      ),
    );
  }

  Future<List<String>> _uploadImages() async {
    final urls = <String>[];
    for (final file in _pickedImages) {
      final resp = await _api.uploadFile('/upload/image', file, 'file');
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        final url = data['url'] as String?;
        if (url != null) urls.add(url);
      }
    }
    return urls;
  }

  Future<void> _submit() async {
    final formOk = _formKey.currentState!.validate();
    setState(() => _photoError = _pickedImages.isEmpty);
    if (!formOk || _pickedImages.isEmpty) {
      if (_pickedImages.isEmpty) {
        AppToast.error(context, 'Add at least one photo',
            'Listings without photos are almost never rented.');
      }
      return;
    }

    setState(() => _submitting = true);

    final uploadedUrls = await _uploadImages();
    if (!mounted) return;
    if (uploadedUrls.isEmpty) {
      setState(() => _submitting = false);
      AppToast.error(context, 'Photo upload failed',
          'Check your connection and try again.');
      return;
    }

    final result = await _service.createItem(
      title: _titleCtrl.text.trim(),
      description: _descCtrl.text.trim(),
      category: _selectedCategory,
      condition: _selectedCondition,
      pricePerDay: _priceCtrl.text.trim(),
      securityDeposit: _depositCtrl.text.trim(),
      images: uploadedUrls,
      serialNumber:
          _serialCtrl.text.trim().isEmpty ? null : _serialCtrl.text.trim(),
    );

    if (!mounted) return;
    setState(() => _submitting = false);

    if (result['success'] == true) {
      AppToast.success(context, 'Listing published',
          'Your item is now visible to other students.');
      Navigator.pop(context);
    } else {
      AppToast.error(context, 'Could not publish listing',
          (result['error'] as String?) ?? 'Please try again.');
    }
  }

  double get _price => double.tryParse(_priceCtrl.text.trim()) ?? 0;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(title: const Text('List an Item')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.lg),
          children: [
            FormSection(
              title: 'Photos',
              icon: Icons.photo_camera_outlined,
              caption:
                  'Up to 5. The first is the cover shown in search. Clear, well-lit '
                  'photos of the actual item rent far more often than stock images.',
              children: [
                _PhotoStrip(
                  images: _pickedImages,
                  onAdd: _showPhotoSource,
                  onRemove: _removeImage,
                  onMakeCover: _makeCover,
                ),
                if (_photoError)
                  const Text(
                    'At least one photo is required',
                    style: TextStyle(fontSize: 11.5, color: AppColors.error),
                  ),
              ],
            ),

            FormSection(
              title: 'What is it',
              icon: Icons.inventory_2_outlined,
              children: [
                AppField(
                  label: 'Title',
                  controller: _titleCtrl,
                  hint: 'e.g. Fluke 117 Digital Multimeter',
                  maxLength: 80,
                  textCapitalization: TextCapitalization.sentences,
                  helper: 'Include the brand and model — that\'s what people search.',
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) return 'Required';
                    if (v.trim().length < 4) return 'Too short to be searchable';
                    return null;
                  },
                ),
                AppPickerField(
                  label: 'Category',
                  value: AppConstants.categories[_selectedCategory] ?? '',
                  onTap: _pickCategory,
                ),
                _ConditionPicker(
                  value: _selectedCondition,
                  options: _conditions,
                  onChanged: (v) => setState(() => _selectedCondition = v),
                ),
                AppField(
                  label: 'Description',
                  controller: _descCtrl,
                  hint:
                      'What\'s included, any quirks, and what it\'s good for. '
                      'Mention accessories, cables or cases.',
                  maxLines: 5,
                  maxLength: 600,
                  textCapitalization: TextCapitalization.sentences,
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) return 'Required';
                    if (v.trim().length < 20) {
                      return 'Add a bit more detail (at least 20 characters)';
                    }
                    return null;
                  },
                ),
              ],
            ),

            FormSection(
              title: 'Pricing',
              icon: Icons.payments_outlined,
              caption:
                  'The deposit is held in escrow while the item is out and returned '
                  'automatically once the condition check passes.',
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: AppField(
                        label: 'Price per day',
                        controller: _priceCtrl,
                        prefix: '₱ ',
                        hint: '0',
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true),
                        inputFormatters: [
                          FilteringTextInputFormatter.allow(
                              RegExp(r'^\d*\.?\d{0,2}')),
                        ],
                        onChanged: (_) => setState(() {}),
                        validator: (v) {
                          final n = double.tryParse(v?.trim() ?? '');
                          if (n == null || n <= 0) return 'Enter an amount';
                          return null;
                        },
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: AppField(
                        label: 'Security deposit',
                        controller: _depositCtrl,
                        prefix: '₱ ',
                        hint: '0',
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true),
                        inputFormatters: [
                          FilteringTextInputFormatter.allow(
                              RegExp(r'^\d*\.?\d{0,2}')),
                        ],
                        onChanged: (_) => setState(() {}),
                        validator: (v) {
                          final n = double.tryParse(v?.trim() ?? '');
                          if (n == null || n < 0) return 'Enter an amount';
                          return null;
                        },
                      ),
                    ),
                  ],
                ),
                if (_price > 0) _EarningsPreview(pricePerDay: _price),
              ],
            ),

            FormSection(
              title: 'Optional',
              icon: Icons.tag_rounded,
              children: [
                AppField(
                  label: 'Serial number',
                  controller: _serialCtrl,
                  hint: 'Leave blank if it has none',
                  helper:
                      'Only visible to you and to admins handling a dispute. '
                      'Helps prove the returned item is the one you lent.',
                ),
              ],
            ),

            NoticeBanner(
              kind: NoticeKind.info,
              title: 'What happens next',
              message:
                  'Your listing goes live immediately. When someone rents it, you '
                  'drop the item at the kiosk and the locker handles the rest — you '
                  'never have to meet the renter.',
              icon: Icons.lock_outline_rounded,
            ),
            SizedBox(height: p.isDark ? 0 : 0),
          ],
        ),
      ),
      bottomNavigationBar: StickyActionBar(
        label: 'Publish listing',
        icon: Icons.check_rounded,
        busy: _submitting,
        onPressed: _submit,
      ),
    );
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
              child: SectionLabel('Category'),
            ),
            for (final entry in AppConstants.categories.entries)
              ListTile(
                dense: true,
                title: Text(entry.value, style: TextStyle(color: p.ink)),
                trailing: entry.key == _selectedCategory
                    ? Icon(Icons.check_rounded, size: 18, color: p.primary)
                    : null,
                onTap: () => Navigator.pop(sheetContext, entry.key),
              ),
            const SizedBox(height: AppSpacing.xs),
          ],
        ),
      ),
    );
    if (picked != null && mounted) {
      setState(() => _selectedCategory = picked);
    }
  }
}

/// Horizontal photo strip with an add tile. The cover is badged, and any other
/// photo can be promoted to cover with a long-press — reordering used to be
/// impossible, so the cover was whatever you happened to pick first.
class _PhotoStrip extends StatelessWidget {
  const _PhotoStrip({
    required this.images,
    required this.onAdd,
    required this.onRemove,
    required this.onMakeCover,
  });

  final List<File> images;
  final VoidCallback onAdd;
  final ValueChanged<int> onRemove;
  final ValueChanged<int> onMakeCover;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final stripHeight = scaledHeight(context, 104);
    return SizedBox(
      height: stripHeight,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: images.length + (images.length >= 5 ? 0 : 1),
        separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.xs),
        itemBuilder: (context, i) {
          if (i == images.length) {
            return GestureDetector(
              onTap: onAdd,
              child: Container(
                width: 96,
                decoration: BoxDecoration(
                  color: p.surfaceAlt,
                  borderRadius: AppRadius.input,
                  border: Border.all(color: p.border),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.add_a_photo_outlined, size: 20, color: p.primary),
                    const SizedBox(height: AppSpacing.hair),
                    Text(
                      images.isEmpty ? 'Add photo' : '${images.length}/5',
                      style: TextStyle(fontSize: 11, color: p.muted),
                    ),
                  ],
                ),
              ),
            );
          }

          return GestureDetector(
            onLongPress: () => onMakeCover(i),
            child: Stack(
              children: [
                ClipRRect(
                  borderRadius: AppRadius.input,
                  child: Image.file(
                    images[i],
                    width: 96,
                    height: stripHeight,
                    fit: BoxFit.cover,
                  ),
                ),
                Positioned(
                  top: 3,
                  right: 3,
                  child: GestureDetector(
                    onTap: () => onRemove(i),
                    child: Container(
                      padding: const EdgeInsets.all(3),
                      decoration: const BoxDecoration(
                        color: Colors.black54,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.close_rounded,
                          size: 13, color: Colors.white),
                    ),
                  ),
                ),
                if (i == 0)
                  Positioned(
                    bottom: 3,
                    left: 3,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 5, vertical: 2),
                      decoration: BoxDecoration(
                        color: p.primary,
                        borderRadius: AppRadius.input,
                      ),
                      child: Text(
                        'COVER',
                        style: TextStyle(
                          fontSize: 8.5,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.4,
                          color: p.isDark
                              ? const Color(0xFF04211D)
                              : Colors.white,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// Condition picker with plain-language detail per option. "GOOD" alone means
/// different things to the owner and the renter; the detail line is what the
/// AI condition check is later measured against.
class _ConditionPicker extends StatelessWidget {
  const _ConditionPicker({
    required this.value,
    required this.options,
    required this.onChanged,
  });

  final String value;
  final List<({String key, String label, String detail})> options;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Condition',
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: p.ink,
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        Wrap(
          spacing: AppSpacing.xs,
          runSpacing: AppSpacing.xs,
          children: [
            for (final o in options)
              GestureDetector(
                onTap: () => onChanged(o.key),
                child: AnimatedContainer(
                  duration: AppMotion.fast,
                  padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm, vertical: 7),
                  decoration: BoxDecoration(
                    color: value == o.key
                        ? p.primary.withValues(alpha: 0.10)
                        : Colors.transparent,
                    borderRadius: AppRadius.input,
                    border: Border.all(
                      color: value == o.key ? p.primary : p.border,
                      width: value == o.key ? 1.5 : 1,
                    ),
                  ),
                  child: Text(
                    o.label,
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight:
                          value == o.key ? FontWeight.w700 : FontWeight.w500,
                      color: value == o.key ? p.primary : p.muted,
                    ),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: AppSpacing.hair + 2),
        Text(
          options.firstWhere((o) => o.key == value).detail,
          style: TextStyle(fontSize: 11.5, color: p.muted),
        ),
      ],
    );
  }
}

/// Shows what a listing actually earns over common rental lengths. Owners
/// were pricing blind — a per-day figure doesn't tell you what a week is worth.
class _EarningsPreview extends StatelessWidget {
  const _EarningsPreview({required this.pricePerDay});
  final double pricePerDay;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: p.surfaceAlt,
        borderRadius: AppRadius.input,
        border: Border.all(color: p.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'You\'d earn',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.3,
              color: p.muted,
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              for (final days in [3, 7, 14])
                Column(
                  children: [
                    MonoText(
                      '₱${(pricePerDay * days).toStringAsFixed(0)}',
                      size: 14,
                      color: p.primary,
                    ),
                    Text(
                      '$days days',
                      style: TextStyle(fontSize: 10.5, color: p.muted),
                    ),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }
}
