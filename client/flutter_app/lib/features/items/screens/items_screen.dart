import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/models/item_model.dart';
import '../../../core/services/api_service.dart';
import '../models/item_service.dart';
import 'item_detail_screen.dart';

class ItemsScreen extends StatefulWidget {
  const ItemsScreen({super.key});

  @override
  State<ItemsScreen> createState() => _ItemsScreenState();
}

class _ItemsScreenState extends State<ItemsScreen> {
  final _service = ItemService();
  final _api = ApiService();
  final _searchController = TextEditingController();
  final _scrollController = ScrollController();

  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  List<ItemModel> _items = [];
  int _page = 1;
  int _totalPages = 1;
  String _activeQuery = '';

  @override
  void initState() {
    super.initState();
    _loadItems(reset: true);
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _searchController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >= _scrollController.position.maxScrollExtent - 200 &&
        !_loadingMore &&
        _page < _totalPages) {
      _loadMore();
    }
  }

  Future<void> _loadItems({bool reset = false, String? query}) async {
    if (reset) {
      _page = 1;
      _activeQuery = query ?? _activeQuery;
    }
    setState(() { _loading = reset; _error = null; });

    try {
      final q = _activeQuery.isNotEmpty ? '&search=${Uri.encodeComponent(_activeQuery)}' : '';
      final resp = await _api.get('/items?page=$_page&limit=10$q', authenticated: false);
      final data = jsonDecode(resp.body);
      if (!mounted) return;
      if (resp.statusCode == 200 && data['success'] == true) {
        final items = (data['data']['items'] as List<dynamic>)
            .map((j) => ItemModel.fromJson(j as Map<String, dynamic>))
            .toList();
        final pagination = data['data']['pagination'] as Map<String, dynamic>?;
        setState(() {
          _loading = false;
          _totalPages = (pagination?['totalPages'] as int?) ?? 1;
          if (reset) {
            _items = items;
          } else {
            _items.addAll(items);
          }
        });
      } else {
        // fall back to demo
        final result = await _service.getItems(query: _activeQuery);
        if (!mounted) return;
        setState(() {
          _loading = false;
          if (result['success'] == true) {
            _items = result['items'] as List<ItemModel>;
          } else {
            _error = result['error'] as String?;
          }
        });
      }
    } catch (e) {
      if (!mounted) return;
      final result = await _service.getItems(query: _activeQuery);
      setState(() {
        _loading = false;
        if (result['success'] == true) {
          _items = result['items'] as List<ItemModel>;
        } else {
          _error = e.toString();
        }
      });
    }
  }

  Future<void> _loadMore() async {
    setState(() { _loadingMore = true; _page++; });
    await _loadItems(reset: false);
    setState(() => _loadingMore = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Browse Items'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () => Navigator.pushNamed(context, '/items/create').then((_) => _loadItems(reset: true)),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Search by title or description',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchController.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _searchController.clear();
                          _loadItems(reset: true, query: '');
                        },
                      )
                    : IconButton(
                        icon: const Icon(Icons.arrow_forward),
                        onPressed: () => _loadItems(reset: true, query: _searchController.text.trim()),
                      ),
              ),
              onSubmitted: (v) => _loadItems(reset: true, query: v.trim()),
              onChanged: (_) => setState(() {}),
            ),
          ),
          const SizedBox(height: 6),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () => _loadItems(reset: true),
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                      ? ListView(children: [const SizedBox(height: 100), Center(child: Text(_error!))])
                      : _items.isEmpty
                          ? ListView(children: const [SizedBox(height: 100), Center(child: Text('No items found'))])
                          : ListView.separated(
                              controller: _scrollController,
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                              itemCount: _items.length + (_loadingMore ? 1 : 0),
                              separatorBuilder: (_, __) => const SizedBox(height: 10),
                              itemBuilder: (context, index) {
                                if (index == _items.length) {
                                  return const Center(child: Padding(
                                    padding: EdgeInsets.all(16),
                                    child: CircularProgressIndicator(),
                                  ));
                                }
                                return _ItemCard(
          item: _items[index],
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => ItemDetailScreen(item: _items[index]),
            ),
          ),
        );
                              },
                            ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ItemCard extends StatelessWidget {
  final ItemModel item;
  final VoidCallback onTap;
  const _ItemCard({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final categoryLabel = AppConstants.categories[item.category] ?? item.category;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: item.images.isNotEmpty
                    ? CachedNetworkImage(
                        imageUrl: item.images.first,
                        width: 70,
                        height: 70,
                        fit: BoxFit.cover,
                        errorWidget: (_, __, ___) => _placeholderIcon(),
                      )
                    : _placeholderIcon(),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Expanded(child: Text(item.title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700))),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: item.isAvailable
                              ? AppColors.secondary.withValues(alpha: 0.12)
                              : AppColors.warning.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          item.isAvailable ? 'Available' : 'In Use',
                          style: TextStyle(
                            color: item.isAvailable ? AppColors.secondaryDark : AppColors.accentDark,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ]),
                    const SizedBox(height: 3),
                    Text(categoryLabel, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                    const SizedBox(height: 4),
                    Text(item.description, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                    const SizedBox(height: 6),
                    Text('PHP ${item.pricePerDay.toStringAsFixed(0)}/day', style: const TextStyle(fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _placeholderIcon() {
    return Container(
      width: 70,
      height: 70,
      decoration: BoxDecoration(color: AppColors.primary.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
      child: const Icon(Icons.inventory_2, color: AppColors.primary, size: 32),
    );
  }
}
