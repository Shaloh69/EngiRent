import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import 'pii_scrubber.dart';

/// Crash reporting — mandate §2.10.1, the single biggest hole in the app.
///
/// Before this, a crash on a student's phone was invisible: no reporter, and
/// no `FlutterError.onError` handler either, so a framework error printed to a
/// console nobody was attached to and the app carried on in a broken state.
///
/// The DSN is supplied at build time and is **not** committed:
///
///   flutter build apk --dart-define=SENTRY_DSN=https://…@…ingest.sentry.io/…
///
/// With no DSN the app still installs the global handlers and logs to the
/// console. That is deliberate: the failure mode of a missing DSN should be
/// "reports go nowhere", never "the app won't start" or "errors are silently
/// swallowed". It also means debug runs and the demo build need no secret.
class CrashReporting {
  CrashReporting._();

  static const String dsn = String.fromEnvironment('SENTRY_DSN');

  /// Sampling. 1.0 in debug so a deliberate test throw is never dropped while
  /// you are looking for it; 0.25 traces in release because performance spans
  /// are the expensive part of the quota and crashes are what matter here.
  static const double _tracesSampleRate = kDebugMode ? 1.0 : 0.25;

  static bool get isEnabled => dsn.isNotEmpty;

  static String _release = 'unknown';
  static String get release => _release;

  /// Wraps app startup. Everything inside [appRunner] — including async errors
  /// on the same zone — is captured.
  static Future<void> run(FutureOr<void> Function() appRunner) async {
    WidgetsFlutterBinding.ensureInitialized();
    await _loadRelease();

    if (!isEnabled) {
      _installFallbackHandlers();
      if (kDebugMode) {
        debugPrint(
          'CrashReporting: no SENTRY_DSN supplied — errors will be logged '
          'locally only. Pass --dart-define=SENTRY_DSN=… to enable reporting.',
        );
      }
      await appRunner();
      return;
    }

    await SentryFlutter.init(
      (options) {
        options.dsn = dsn;
        // Tagged with the real pubspec version+build, not a hardcoded string —
        // a report you can't tie to a build is close to useless.
        options.release = 'engirent@$_release';
        options.environment = kDebugMode ? 'debug' : 'production';
        options.tracesSampleRate = _tracesSampleRate;

        // Ship as little as possible by default, then redact what remains.
        options.sendDefaultPii = false;
        options.attachScreenshot = false; // could contain an ID photo
        options.attachViewHierarchy = false;

        options.beforeSend = (event, hint) => _scrubEvent(event);
        options.beforeBreadcrumb = (breadcrumb, hint) => _scrubBreadcrumb(breadcrumb);
      },
      appRunner: appRunner,
    );
  }

  static Future<void> _loadRelease() async {
    try {
      final info = await PackageInfo.fromPlatform();
      _release = '${info.version}+${info.buildNumber}';
    } catch (_) {
      // Web and some desktop targets can fail here; a missing version must not
      // stop the app from starting.
      _release = 'unknown';
    }
  }

  /// Handlers for the no-DSN case, so an uncaught error is at least visible in
  /// a `flutter logs` session instead of vanishing.
  static void _installFallbackHandlers() {
    FlutterError.onError = (details) {
      FlutterError.presentError(details);
      debugPrint('Uncaught Flutter error: ${scrubText(details.exceptionAsString())}');
    };
    PlatformDispatcher.instance.onError = (error, stack) {
      debugPrint('Uncaught platform error: ${scrubText(error.toString())}');
      return true;
    };
  }

  static SentryEvent? _scrubEvent(SentryEvent event) {
    // SentryEvent's fields are final and copyWith keeps the original whenever
    // an argument is null, so every branch below has to pass a real value or
    // leave the field out entirely.
    return event.copyWith(
      request: _scrubRequest(event.request),
      tags: _scrubbedStringMap(event.tags),
      message: event.message == null
          ? null
          : SentryMessage(
              scrubText(event.message!.formatted),
              template: event.message!.template,
              params: event.message!.params
                  ?.map((p) => p is String ? scrubText(p) : p)
                  .toList(),
            ),
      // The exception's own value string is the field most likely to carry a
      // token: "401 for GET /items with Authorization: Bearer …".
      exceptions: event.exceptions
          ?.map((e) => e.copyWith(value: e.value == null ? null : scrubText(e.value!)))
          .toList(),
      // The user is identified by their opaque ID only. Email, username and IP
      // would each re-identify a student from a crash report.
      user: event.user == null
          ? null
          : SentryUser(
              id: event.user!.id,
              data: _scrubbedMapOrNull(event.user!.data),
            ),
    );
  }

  static SentryRequest? _scrubRequest(SentryRequest? request) {
    if (request == null) return null;
    return request.copyWith(
      headers: _scrubbedStringMap(request.headers) ?? const {},
      // Query strings carry signed media tokens; bodies carry credentials.
      queryString: request.queryString == null ? null : scrubText(request.queryString!),
      url: request.url == null ? null : scrubText(request.url!),
      data: request.data == null ? null : scrubValue(request.data),
    );
  }

  static Breadcrumb? _scrubBreadcrumb(Breadcrumb? breadcrumb) {
    if (breadcrumb == null) return null;
    return breadcrumb.copyWith(
      message: breadcrumb.message == null ? null : scrubText(breadcrumb.message!),
      data: _scrubbedMapOrNull(breadcrumb.data),
    );
  }

  static Map<String, dynamic>? _scrubbedMapOrNull(Map<String, dynamic>? input) {
    if (input == null) return null;
    return scrubValue(input) as Map<String, dynamic>;
  }

  static Map<String, String>? _scrubbedStringMap(Map<String, String>? input) {
    if (input == null) return null;
    return input.map(
      (k, v) => MapEntry(k, isSensitiveKey(k) ? redacted : scrubText(v)),
    );
  }

  /// Records a handled error — something caught and recovered from, which is
  /// worth knowing about but is not a crash.
  static Future<void> recordError(
    Object error,
    StackTrace? stack, {
    String? context,
  }) async {
    if (!isEnabled) {
      debugPrint('Handled error${context == null ? '' : ' ($context)'}: '
          '${scrubText(error.toString())}');
      return;
    }
    await Sentry.captureException(
      error,
      stackTrace: stack,
      withScope: (scope) {
        if (context != null) scope.setContexts('where', scrubText(context));
      },
    );
  }

  /// A deliberate throw, so the pipeline can be proven end-to-end from a real
  /// build rather than assumed. Wired to a long-press on the Profile tab's
  /// version row in debug builds.
  static Future<void> sendTestEvent() async {
    await recordError(
      Exception('EngiRent test exception — crash reporting is wired correctly'),
      StackTrace.current,
      context: 'manual test from Profile',
    );
  }
}
