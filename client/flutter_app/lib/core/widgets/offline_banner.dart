import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../constants/app_colors.dart';
import '../services/connectivity_controller.dart';

/// Persistent, app-wide offline indicator — checklist Stage 4.1's "airplane
/// mode shows the banner" requirement. Lives above every screen via
/// [MaterialApp.builder] rather than being added per-screen, so there is no
/// screen that can forget it.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final connectivity = context.watch<ConnectivityController>();
    return AnimatedSize(
      duration: const Duration(milliseconds: 200),
      alignment: Alignment.topCenter,
      child: connectivity.isOnline
          ? const SizedBox(width: double.infinity, height: 0)
          : Material(
              color: AppColors.warning,
              child: SafeArea(
                bottom: false,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 12),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.cloud_off_rounded, size: 14, color: Colors.white),
                      const SizedBox(width: 6),
                      Text(
                        "You're offline — showing saved data",
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: Colors.white,
                              fontWeight: FontWeight.w700,
                            ) ??
                            const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w700,
                              fontSize: 11,
                            ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
    );
  }
}
