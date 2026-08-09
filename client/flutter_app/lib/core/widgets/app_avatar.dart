import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../services/storage_service.dart';
import '../theme/app_theme.dart';
import 'app_widgets.dart';

/// Authenticated avatar.
///
/// **Why this exists rather than a plain NetworkImage:** the API serves user
/// photos from `GET /media/users/:id/face.jpg`, which is behind the
/// `authenticate` middleware — it reads `Authorization: Bearer …` and nothing
/// else. `NetworkImage`/`CachedNetworkImage` send no credentials by default,
/// so every avatar request returned **401** and silently fell back to a blank
/// box. Verified directly against the deployed API: 401 with no header, 404
/// (correct — no photo uploaded yet) with one.
///
/// This widget attaches the stored token to the image request, so photos load
/// once a user has actually completed face registration. It also degrades in
/// the two ways the old code didn't: no URL and a failed fetch both fall back
/// to readable initials rather than a grey square.
class AppAvatar extends StatefulWidget {
  const AppAvatar({
    super.key,
    required this.name,
    this.imageUrl,
    this.radius = 20,
    this.backgroundColor,
  });

  /// Used for the initials fallback.
  final String name;
  final String? imageUrl;
  final double radius;
  final Color? backgroundColor;

  @override
  State<AppAvatar> createState() => _AppAvatarState();
}

class _AppAvatarState extends State<AppAvatar> {
  final _storage = StorageService();
  Map<String, String>? _headers;

  @override
  void initState() {
    super.initState();
    _loadHeaders();
  }

  Future<void> _loadHeaders() async {
    // Only media served from our own API needs the token; an external URL
    // (e.g. a seeded placeholder) must not receive it.
    if (widget.imageUrl == null || !_isOwnMedia(widget.imageUrl!)) return;
    try {
      final token = await _storage.getAccessToken();
      if (!mounted || token == null) return;
      setState(() => _headers = {'Authorization': 'Bearer $token'});
    } catch (_) {
      // Fall through to initials — an avatar is never worth surfacing an
      // error for.
    }
  }

  bool _isOwnMedia(String url) => url.contains('/media/');

  String get _initials {
    final parts = widget.name.trim().split(RegExp(r'\s+'))
      ..removeWhere((s) => s.isEmpty);
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    final bg = widget.backgroundColor ?? p.surfaceAlt;

    final fallback = CircleAvatar(
      radius: widget.radius,
      backgroundColor: bg,
      child: Text(
        _initials,
        style: AppTheme.mono(
          fontSize: widget.radius * 0.72,
          fontWeight: FontWeight.w600,
          color: p.primary,
        ),
      ),
    );

    final url = widget.imageUrl;
    if (url == null || url.isEmpty) return fallback;

    // Our own media needs the token; waiting for it avoids firing a request
    // that would 401 and then get cached as a failure.
    if (_isOwnMedia(url) && _headers == null) return fallback;

    return ClipOval(
      child: CachedNetworkImage(
        imageUrl: url,
        httpHeaders: _headers,
        width: widget.radius * 2,
        height: widget.radius * 2,
        fit: BoxFit.cover,
        placeholder: (_, __) => CircleAvatar(
          radius: widget.radius,
          backgroundColor: bg,
        ),
        errorWidget: (_, __, ___) => fallback,
      ),
    );
  }
}
