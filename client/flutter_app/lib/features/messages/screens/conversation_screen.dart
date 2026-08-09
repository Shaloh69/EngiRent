import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/models/message_model.dart';
import '../../../core/services/socket_service.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/utils/toast_utils.dart';
import '../../../core/widgets/app_avatar.dart';
import '../../../core/widgets/app_widgets.dart';
import '../models/message_service.dart';

/// Checklist Stage 5.2 — the thread for a single rental's conversation.
///
/// Deliberately not a general chat screen: it only ever exists in the
/// context of one rental, reachable from that rental's detail screen (and,
/// where an active rental exists for the item being viewed, from item
/// detail). That scoping is what makes "attach the transcript to disputes"
/// possible at all — a general DM system would have no single rental to
/// attach.
class ConversationScreen extends StatefulWidget {
  const ConversationScreen({
    super.key,
    required this.rentalId,
    required this.otherPartyName,
    this.otherPartyImage,
    this.currentUserId,
  });

  final String rentalId;
  final String otherPartyName;
  final String? otherPartyImage;
  final String? currentUserId;

  @override
  State<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends State<ConversationScreen> {
  final _service = MessageService();
  final _bodyCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  StreamSubscription<Map<String, dynamic>>? _sub;

  bool _loading = true;
  String? _error;
  bool _sending = false;
  List<MessageModel> _messages = [];
  String? _myId;

  @override
  void initState() {
    super.initState();
    _myId = widget.currentUserId ?? SocketService.instance.currentUserId;
    _load();
    _sub = SocketService.instance.onNewMessage.listen(_onSocketMessage);
  }

  @override
  void dispose() {
    _sub?.cancel();
    _bodyCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  void _onSocketMessage(Map<String, dynamic> data) {
    if (data['rentalId'] != widget.rentalId) return;
    final msg = data['message'] as Map<String, dynamic>?;
    if (msg == null) return;
    if (!mounted) return;
    setState(() => _messages.add(MessageModel.fromJson(msg)));
    _scrollToBottom();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final result = await _service.getConversation(widget.rentalId);
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (result['success'] == true) {
        _messages = result['messages'] as List<MessageModel>;
      } else {
        _error = result['error'] as String?;
      }
    });
    _scrollToBottom(animate: false);
  }

  void _scrollToBottom({bool animate = true}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollCtrl.hasClients) return;
      final target = _scrollCtrl.position.maxScrollExtent;
      if (animate) {
        _scrollCtrl.animateTo(target,
            duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      } else {
        _scrollCtrl.jumpTo(target);
      }
    });
  }

  Future<void> _send() async {
    final text = _bodyCtrl.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    final result = await _service.sendMessage(widget.rentalId, text);
    if (!mounted) return;
    setState(() => _sending = false);
    if (result['success'] == true) {
      _bodyCtrl.clear();
      final sent = result['message'] as MessageModel;
      // Only append locally if the socket echo hasn't already delivered it —
      // the sender is never in their own `user:{id}` room broadcast target
      // (the server only emits to the recipient), so this is always needed,
      // but the guard keeps this correct even if that changes later.
      if (!_messages.any((m) => m.id == sent.id)) {
        setState(() => _messages.add(sent));
      }
      _scrollToBottom();
    } else {
      if (mounted) {
        AppToast.error(context, 'Could not send message',
            (result['error'] as String?) ?? 'Please try again.');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          children: [
            AppAvatar(name: widget.otherPartyName, imageUrl: widget.otherPartyImage, radius: 16),
            const SizedBox(width: AppSpacing.xs),
            Expanded(
              child: Text(widget.otherPartyName, overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(child: _buildBody(p)),
          _ComposeBar(
            controller: _bodyCtrl,
            sending: _sending,
            onSend: _send,
          ),
        ],
      ),
    );
  }

  Widget _buildBody(AppPalette p) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return AppEmptyState(
        icon: Icons.wifi_off_rounded,
        title: 'Couldn\'t load this conversation',
        body: _error,
        action: OutlinedButton(onPressed: _load, child: const Text('Try again')),
      );
    }
    if (_messages.isEmpty) {
      return AppEmptyState(
        icon: Icons.forum_outlined,
        title: 'No messages yet',
        body: 'Send ${widget.otherPartyName} a message about this rental.',
      );
    }
    return ListView.builder(
      controller: _scrollCtrl,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
      itemCount: _messages.length,
      itemBuilder: (context, i) {
        final msg = _messages[i];
        final mine = msg.sender.id == _myId;
        final showSenderName = !mine &&
            (i == 0 || _messages[i - 1].sender.id != msg.sender.id);
        return _MessageBubble(message: msg, mine: mine, showSenderName: showSenderName);
      },
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message, required this.mine, required this.showSenderName});
  final MessageModel message;
  final bool mine;
  final bool showSenderName;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.xs),
      child: Column(
        crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          if (showSenderName)
            Padding(
              padding: const EdgeInsets.only(left: AppSpacing.xs, bottom: 2),
              child: Text(message.sender.fullName,
                  style: TextStyle(fontSize: 11, color: p.muted, fontWeight: FontWeight.w600)),
            ),
          Row(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisAlignment: mine ? MainAxisAlignment.end : MainAxisAlignment.start,
            children: [
              ConstrainedBox(
                constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.72),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: mine ? AppColors.primary : p.surfaceAlt,
                    borderRadius: BorderRadius.only(
                      topLeft: const Radius.circular(AppRadius.md),
                      topRight: const Radius.circular(AppRadius.md),
                      bottomLeft: Radius.circular(mine ? AppRadius.md : 4),
                      bottomRight: Radius.circular(mine ? 4 : AppRadius.md),
                    ),
                  ),
                  child: Text(
                    message.body,
                    style: TextStyle(
                      fontSize: 14,
                      height: 1.3,
                      color: mine ? Colors.white : p.ink,
                    ),
                  ),
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(top: 2, left: AppSpacing.xs, right: AppSpacing.xs),
            child: Text(
              DateFormat('h:mm a').format(message.createdAt),
              style: TextStyle(fontSize: 9.5, color: p.muted),
            ),
          ),
        ],
      ),
    );
  }
}

class _ComposeBar extends StatelessWidget {
  const _ComposeBar({required this.controller, required this.sending, required this.onSend});
  final TextEditingController controller;
  final bool sending;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.of(context);
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(AppSpacing.sm, AppSpacing.xs, AppSpacing.sm, AppSpacing.xs),
        decoration: BoxDecoration(
          color: p.surface,
          border: Border(top: BorderSide(color: p.border)),
        ),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: controller,
                minLines: 1,
                maxLines: 4,
                maxLength: 2000,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  hintText: 'Message…',
                  counterText: '',
                  isDense: true,
                ),
                onSubmitted: (_) => onSend(),
              ),
            ),
            const SizedBox(width: AppSpacing.xs),
            IconButton.filled(
              onPressed: sending ? null : onSend,
              icon: sending
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.send_rounded, size: 18),
            ),
          ],
        ),
      ),
    );
  }
}
