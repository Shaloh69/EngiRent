import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_rating_bar/flutter_rating_bar.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/services/api_service.dart';

class ReviewsScreen extends StatefulWidget {
  /// Show reviews for an item or user depending on which param is set.
  final String? itemId;
  final String? userId;
  const ReviewsScreen({super.key, this.itemId, this.userId});

  @override
  State<ReviewsScreen> createState() => _ReviewsScreenState();
}

class _ReviewsScreenState extends State<ReviewsScreen> {
  final _api = ApiService();
  List<Map<String, dynamic>> _reviews = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final endpoint = widget.itemId != null
          ? '/reviews/item/${widget.itemId}'
          : '/reviews/user/${widget.userId}';
      final resp = await _api.get(endpoint);
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body);
        setState(() {
          _reviews = List<Map<String, dynamic>>.from(data['data']['reviews'] as List);
          _loading = false;
        });
      } else {
        setState(() { _loading = false; _error = 'Failed to load reviews'; });
      }
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.itemId != null ? 'Item Reviews' : 'User Reviews'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Text(_error!),
                  TextButton(onPressed: _load, child: const Text('Retry')),
                ]))
              : _reviews.isEmpty
                  ? const Center(child: Text('No reviews yet'))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _reviews.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (_, i) => _ReviewCard(review: _reviews[i]),
                      ),
                    ),
    );
  }
}

class _ReviewCard extends StatelessWidget {
  final Map<String, dynamic> review;
  const _ReviewCard({required this.review});

  @override
  Widget build(BuildContext context) {
    final author = review['author'] as Map<String, dynamic>?;
    final rating = (review['rating'] as num?)?.toDouble() ?? 0;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              CircleAvatar(
                radius: 18,
                backgroundColor: AppColors.primary.withValues(alpha: 0.12),
                backgroundImage: author?['profileImage'] != null
                    ? NetworkImage(author!['profileImage'] as String)
                    : null,
                child: author?['profileImage'] == null
                    ? Text(
                        (author?['firstName'] as String? ?? 'U').substring(0, 1),
                        style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.primaryDark),
                      )
                    : null,
              ),
              const SizedBox(width: 10),
              Expanded(child: Text(
                '${author?['firstName'] ?? ''} ${author?['lastName'] ?? ''}'.trim(),
                style: const TextStyle(fontWeight: FontWeight.w700),
              )),
              RatingBarIndicator(
                rating: rating,
                itemBuilder: (_, __) => const Icon(Icons.star, color: AppColors.warning),
                itemCount: 5,
                itemSize: 16,
              ),
            ]),
            if (review['comment'] != null && (review['comment'] as String).isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(review['comment'] as String, style: const TextStyle(color: AppColors.textSecondary)),
            ],
          ],
        ),
      ),
    );
  }
}

class PostReviewSheet extends StatefulWidget {
  final String rentalId;
  final String reviewType; // 'ITEM' or 'USER'
  const PostReviewSheet({super.key, required this.rentalId, required this.reviewType});

  @override
  State<PostReviewSheet> createState() => _PostReviewSheetState();
}

class _PostReviewSheetState extends State<PostReviewSheet> {
  final _api = ApiService();
  final _commentCtrl = TextEditingController();
  double _rating = 5;
  bool _submitting = false;

  Future<void> _submit() async {
    setState(() => _submitting = true);
    try {
      final resp = await _api.post('/reviews', {
        'rentalId': widget.rentalId,
        'rating': _rating.toInt(),
        'comment': _commentCtrl.text.trim().isEmpty ? null : _commentCtrl.text.trim(),
        'reviewType': widget.reviewType,
      });
      if (!mounted) return;
      if (resp.statusCode == 201) {
        Navigator.pop(context, true);
      } else {
        final data = jsonDecode(resp.body);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(data['error'] ?? 'Failed to submit review')),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  void dispose() {
    _commentCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16, right: 16, top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            widget.reviewType == 'ITEM' ? 'Review this Item' : 'Review this Owner',
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 12),
          Center(
            child: RatingBar.builder(
              initialRating: _rating,
              minRating: 1,
              direction: Axis.horizontal,
              allowHalfRating: false,
              itemCount: 5,
              itemBuilder: (_, __) => const Icon(Icons.star, color: AppColors.warning),
              onRatingUpdate: (r) => setState(() => _rating = r),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _commentCtrl,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Comment (optional)',
              hintText: 'Share your experience…',
            ),
          ),
          const SizedBox(height: 14),
          ElevatedButton(
            onPressed: _submitting ? null : _submit,
            style: ElevatedButton.styleFrom(minimumSize: const Size(double.infinity, 48)),
            child: _submitting
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Text('Submit Review'),
          ),
        ],
      ),
    );
  }
}
