import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import '../../../core/models/item_model.dart';
import '../../../core/services/api_service.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../core/widgets/item_card.dart';
import '../models/item_service.dart';
import 'item_detail_screen.dart';

/// Browse — rebuilt as a shopping grid per mandate §2.2.
///
/// Structure follows the FlutterShop reference: search, a horizontal category
/// rail with visible active state, then a two-column product grid. Loading
/// shows skeleton cards rather than a centred spinner, and both the empty and
/// error cases render real components.
///
/// The paging/fetch logic below (`_loadItems`, `_loadMore`, the demo-service
/// fallback) is carried over unchanged — only the presentation is new.
class ItemsScreen extends StatefulWidget {
  final String? category;
  const ItemsScreen({super.key, this.category});

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
  String _activeCategory = '';
  String _activeQuery = '';
  int _page = 1;
  int _totalPages = 1;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _activeCategory = widget.category ?? '';
    _scrollController.addListener(_onScroll);
    _loadItems(reset: true);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
            _scrollController.position.maxScrollExtent - 300 &&
        !_loadingMore &&
        _page < _totalPages) {
      _loadMore();
    }
  }

  /// Debounced so typing doesn't fire a request per keystroke — the previous
  /// version searched on submit only, which made filtering feel unresponsive.
  void _onQueryChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      _loadItems(reset: true, query: value.trim());
    });
  }

  Future<void> _loadItems({bool reset = false, String? query}) async {
    if (reset) {
      _page = 1;
      _activeQuery = query ?? _activeQuery;
    }
    setState(() { _loading = reset; _error = null; });

    try {
      final q = _activeQuery.isNotEmpty ? '&search=${Uri.encodeComponent(_activeQuery)}' : '';
      final cat = _activeCategory.isNotEmpty ? '&category=${Uri.encodeComponent(_activeCategory)}' : '';
      final resp = await _api.get('/items?page=$_page&limit=10$q$cat', authenticated: false);
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
    setState(() => _loadingMore = true);
    _page++;
    await _loadItems();
    if (mounted) setState(() => _loadingMore = false);
  }

  void _selectCategory(String? key) {
    setState(() => _activeCategory = key ?? '');
    _loadItems(reset: true);
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            // Search header — sits outside the scroll view so filtering stays
            // reachable while the grid scrolls.
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md, AppSpacing.xs, AppSpacing.md, AppSpacing.sm),
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.arrow_back, size: 20),
                    onPressed: () => Navigator.pop(context),
                    visualDensity: VisualDensity.compact,
                  ),
                  Expanded(
                    child: TextField(
                      controller: _searchController,
                      onChanged: _onQueryChanged,
                      textInputAction: TextInputAction.search,
                      decoration: InputDecoration(
                        hintText: 'Search equipment…',
                        prefixIcon: const Icon(Icons.search, size: 19),
                        isDense: true,
                        suffixIcon: _searchController.text.isEmpty
                            ? null
                            : IconButton(
                                icon: const Icon(Icons.close, size: 17),
                                onPressed: () {
                                  _searchController.clear();
                                  _loadItems(reset: true, query: '');
                                },
                              ),
                      ),
                    ),
                  ),
                ],
              ),
            ),

            CategoryRail(
              selected: _activeCategory.isEmpty ? null : _activeCategory,
              onSelect: _selectCategory,
            ),
            const SizedBox(height: AppSpacing.sm),

            Expanded(child: _buildBody(p)),
          ],
        ),
      ),
    );
  }

  Widget _buildBody(AppPalette p) {
    if (_loading) {
      // Skeletons, not a spinner (§2.2) — keeps the grid layout stable and
      // tells the user what shape of content is coming.
      return GridView.builder(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.md, 0, AppSpacing.md, AppSpacing.md),
        gridDelegate: _gridDelegate(context),
        itemCount: 6,
        itemBuilder: (_, __) => const ItemCardSkeleton(),
      );
    }

    if (_error != null) {
      return AppEmptyState(
        icon: Icons.wifi_off_rounded,
        title: 'Couldn\'t load equipment',
        body: _error,
        action: OutlinedButton(
          onPressed: () => _loadItems(reset: true),
          child: const Text('Try again'),
        ),
      );
    }

    if (_items.isEmpty) {
      return AppEmptyState(
        icon: Icons.search_off_rounded,
        title: _activeQuery.isNotEmpty || _activeCategory.isNotEmpty
            ? 'Nothing matches that'
            : 'No equipment listed yet',
        body: _activeQuery.isNotEmpty || _activeCategory.isNotEmpty
            ? 'Try a different search or category.'
            : 'Be the first to list something for other students to rent.',
        action: (_activeQuery.isNotEmpty || _activeCategory.isNotEmpty)
            ? OutlinedButton(
                onPressed: () {
                  _searchController.clear();
                  setState(() => _activeCategory = '');
                  _loadItems(reset: true, query: '');
                },
                child: const Text('Clear filters'),
              )
            : ElevatedButton(
                onPressed: () => Navigator.pushNamed(context, '/items/create'),
                child: const Text('List an item'),
              ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => _loadItems(reset: true),
      child: GridView.builder(
        controller: _scrollController,
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.md, 0, AppSpacing.md, AppSpacing.md),
        gridDelegate: _gridDelegate(context),
        itemCount: _items.length + (_loadingMore ? 2 : 0),
        itemBuilder: (context, i) {
          if (i >= _items.length) return const ItemCardSkeleton();
          final item = _items[i];
          return Stagger(
            index: i,
            child: ItemCard(
              item: item,
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => ItemDetailScreen(item: item),
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  /// Two columns on a phone (§2.2), widening on tablets. childAspectRatio is
  /// tuned to the card's 4:3 image plus its fixed info block — too tall and
  /// cards clip their deposit line, too short and they letterbox.
  SliverGridDelegate _gridDelegate(BuildContext context) {
    final w = MediaQuery.of(context).size.width;
    final columns = w > 900 ? 4 : (w > 600 ? 3 : 2);
    return SliverGridDelegateWithFixedCrossAxisCount(
      crossAxisCount: columns,
      crossAxisSpacing: AppSpacing.sm,
      mainAxisSpacing: AppSpacing.sm,
      childAspectRatio: 0.63,
    );
  }
}
