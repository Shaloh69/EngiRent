import 'dart:convert';
import 'dart:io';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/models/item_model.dart';
import '../../../core/services/api_service.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/utils/toast_utils.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../core/widgets/form_widgets.dart';
import '../models/item_service.dart';

/// A slot in the photo strip: either a photo already on the listing (a URL)
/// or one just picked on this screen (a local file, not yet uploaded).
///
/// Unifying the two into one ordered list — rather than two parallel lists —
/// is what lets reordering-to-cover and removal work identically regardless
/// of whether the photo already exists on the server; the alternative is two
/// copies of that logic that have to stay in sync.
class _PhotoEntry {
  final String? existingUrl;
  final File? file;
  const _PhotoEntry.existing(String url)
      : existingUrl = url,
        file = null;
  const _PhotoEntry.picked(File f)
      : file = f,
        existingUrl = null;
}

/// Listing form — mandate §2.2, modelled on the "sell an item" flow from the
/// FlutterShop reference: photos first (they're what a listing lives or dies
/// on), then what it is, then what it costs.
///
/// The previous version was a flat column of nine fields with the photo picker
/// buried in the middle and no indication of what the owner would actually
/// earn. Pricing now previews the payout, and the cover photo is explicit.
///
/// Doubles as the edit form (checklist 2.2) — pass [editListing] rather than
/// building a second form. Reuses this screen's existing photo strip,
/// category/condition pickers, and price preview verbatim; only the submit
/// action and a few labels change.
class CreateItemScreen extends StatefulWidget {
  const CreateItemScreen({super.key, this.editListing});

  final MyListingModel? editListing;

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

  bool get _isEdit => widget.editListing != null;

  String _selectedCategory = AppConstants.categories.keys.first;
  String _selectedCondition = 'GOOD';
  bool _submitting = false;
  bool _photoError = false;
  final List<_PhotoEntry> _photos = [];

  @override
  void initState() {
    super.initState();
    final edit = widget.editListing;
    if (edit != null) {
      final item = edit.item;
      _titleCtrl.text = item.title;
      _descCtrl.text = item.description;
      _priceCtrl.text = _trimZeros(item.pricePerDay);
      _depositCtrl.text = _trimZeros(item.securityDeposit);
      _selectedCategory = item.category;
      _selectedCondition = item.condition;
      _serialCtrl.text = item.serialNumber ?? '';
      _photos.addAll(item.images.map(_PhotoEntry.existing));
    }
  }

  static String _trimZeros(double n) =>
      n == n.roundToDouble() ? n.toStringAsFixed(0) : n.toString();

  // Matches the server's ItemCondition enum exactly (NEW | LIKE_NEW | GOOD |
  // FAIR | ACCEPTABLE — see schema.prisma). This list previously had a key,
  // 'EXCELLENT', that is not a valid enum value at all: picking it and
  // submitting would 400 against `body("condition").isIn([...])`, and
  // 'ACCEPTABLE' — a real option — was missing from the picker entirely.
  static const _conditions = <({String key, String label, String detail})>[
    (key: 'NEW', label: 'New', detail: 'Unused, still boxed'),
    (key: 'LIKE_NEW', label: 'Like new', detail: 'Barely used, no marks'),
    (key: 'GOOD', label: 'Good', detail: 'Light wear, works perfectly'),
    (key: 'FAIR', label: 'Fair', detail: 'Visible wear, fully functional'),
    (key: 'ACCEPTABLE', label: 'Acceptable', detail: 'Well used, still does the job'),
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
    if (_photos.length >= 5) {
      AppToast.error(context, 'Maximum 5 photos',
          'Remove one before adding another.');
      return;
    }
    final xFile = await _picker.pickImage(source: source, imageQuality: 85);
    if (xFile != null) {
      setState(() {
        _photos.add(_PhotoEntry.picked(File(xFile.path)));
        _photoError = false;
      });
    }
  }

  /// Checklist 2.3: "Refuse removing the last photo" — enforced as a blocked
  /// action here, not just as a submit-time validation error, so an owner
  /// can't land on a listing with zero photos mid-edit.
  void _removeImage(int index) {
    if (_photos.length <= 1) {
      AppToast.error(context, 'At least one photo is required',
          'Add a replacement before removing this one.');
      return;
    }
    setState(() => _photos.removeAt(index));
  }

  /// Reorders a photo to the front. The first image is the cover shown in
  /// search results, so which one leads is a decision the owner should own.
  void _makeCover(int index) {
    if (index == 0) return;
    setState(() {
      final entry = _photos.removeAt(index);
      _photos.insert(0, entry);
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

  /// Resolves every entry to a URL, in the same order the strip shows them
  /// (position 0 stays the cover). Existing entries keep their URL untouched
  /// — they are not re-uploaded — only newly picked files are sent.
  ///
  /// Returns null if any newly picked file fails to upload, rather than
  /// silently dropping it and saving a listing with fewer photos than the
  /// owner arranged.
  Future<List<String>?> _resolveImages() async {
    final urls = <String>[];
    for (final entry in _photos) {
      if (entry.existingUrl != null) {
        urls.add(entry.existingUrl!);
        continue;
      }
      final resp = await _api.uploadFile('/upload/image', entry.file!, 'file');
      if (resp.statusCode != 200) return null;
      final url = jsonDecode(resp.body)['url'] as String?;
      if (url == null) return null;
      urls.add(url);
    }
    return urls;
  }

  Future<void> _submit() async {
    final formOk = _formKey.currentState!.validate();
    setState(() => _photoError = _photos.isEmpty);
    if (!formOk || _photos.isEmpty) {
      if (_photos.isEmpty) {
        AppToast.error(context, 'Add at least one photo',
            'Listings without photos are almost never rented.');
      }
      return;
    }

    setState(() => _submitting = true);

    final images = await _resolveImages();
    if (!mounted) return;
    if (images == null || images.isEmpty) {
      setState(() => _submitting = false);
      AppToast.error(context, 'Photo upload failed',
          'Check your connection and try again.');
      return;
    }

    final serial =
        _serialCtrl.text.trim().isEmpty ? null : _serialCtrl.text.trim();

    final result = _isEdit
        ? await _service.updateItem(
            widget.editListing!.item.id,
            title: _titleCtrl.text.trim(),
            description: _descCtrl.text.trim(),
            category: _selectedCategory,
            condition: _selectedCondition,
            pricePerDay: _priceCtrl.text.trim(),
            securityDeposit: _depositCtrl.text.trim(),
            images: images,
            // '' clears the field server-side (the controller only skips a
            // key when it's `undefined` in the JSON body, and an empty
            // string is a real, present value there) — sending null would
            // instead be dropped by jsonEncode and leave the old value.
            serialNumber: serial ?? '',
          )
        : await _service.createItem(
            title: _titleCtrl.text.trim(),
            description: _descCtrl.text.trim(),
            category: _selectedCategory,
            condition: _selectedCondition,
            pricePerDay: _priceCtrl.text.trim(),
            securityDeposit: _depositCtrl.text.trim(),
            images: images,
            serialNumber: serial,
          );

    if (!mounted) return;
    setState(() => _submitting = false);

    if (result['success'] == true) {
      AppToast.success(
        context,
        _isEdit ? 'Listing updated' : 'Listing published',
        _isEdit
            ? 'Your changes are live.'
            : 'Your item is now visible to other students.',
      );
      Navigator.pop(context, true);
    } else {
      AppToast.error(
        context,
        _isEdit ? 'Could not save changes' : 'Could not publish listing',
        (result['error'] as String?) ?? 'Please try again.',
      );
    }
  }

  double get _price => double.tryParse(_priceCtrl.text.trim()) ?? 0;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(title: Text(_isEdit ? 'Edit Listing' : 'List an Item')),
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
                  photos: _photos,
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

            if (!_isEdit)
              NoticeBanner(
                kind: NoticeKind.info,
                title: 'What happens next',
                message:
                    'Your listing goes live immediately. When someone rents it, you '
                    'drop the item at the kiosk and the locker handles the rest — you '
                    'never have to meet the renter.',
                icon: Icons.lock_outline_rounded,
              )
            else if (widget.editListing!.activeRental != null)
              // Editing is always allowed — a typo fix shouldn't have to wait
              // for a rental to finish — but the owner should know a change
              // now affects someone mid-rental, not a hypothetical future one.
              NoticeBanner(
                kind: NoticeKind.warning,
                title: 'A rental is in progress',
                message:
                    '${widget.editListing!.activeRental!.renterName} currently has '
                    'this item. Changes save immediately and are visible to them.',
                icon: Icons.info_outline_rounded,
              ),
            SizedBox(height: p.isDark ? 0 : 0),
          ],
        ),
      ),
      bottomNavigationBar: StickyActionBar(
        label: _isEdit ? 'Save changes' : 'Publish listing',
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
    required this.photos,
    required this.onAdd,
    required this.onRemove,
    required this.onMakeCover,
  });

  final List<_PhotoEntry> photos;
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
        itemCount: photos.length + (photos.length >= 5 ? 0 : 1),
        separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.xs),
        itemBuilder: (context, i) {
          if (i == photos.length) {
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
                      photos.isEmpty ? 'Add photo' : '${photos.length}/5',
                      style: TextStyle(fontSize: 11, color: p.muted),
                    ),
                  ],
                ),
              ),
            );
          }

          final entry = photos[i];
          return GestureDetector(
            onLongPress: () => onMakeCover(i),
            child: Stack(
              children: [
                ClipRRect(
                  borderRadius: AppRadius.input,
                  child: entry.existingUrl != null
                      ? CachedNetworkImage(
                          imageUrl: entry.existingUrl!,
                          width: 96,
                          height: stripHeight,
                          fit: BoxFit.cover,
                          placeholder: (_, __) => Container(color: p.surfaceAlt),
                          errorWidget: (_, __, ___) => Container(
                            color: p.surfaceAlt,
                            child: Icon(Icons.broken_image_outlined,
                                size: 18, color: p.muted),
                          ),
                        )
                      : Image.file(
                          entry.file!,
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
