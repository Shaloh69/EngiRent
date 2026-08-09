import 'dart:async';
import 'dart:io';
import '../services/api_exceptions.dart';

/// Turns whatever a `catch (e)` block caught into text a student can
/// actually act on — mandate §2.10.1's "no screen displays a raw error".
///
/// Before this, every service's catch block did `error: e.toString()`,
/// which for a dropped connection reads as
/// `SocketException: Failed host lookup: 'desktop-gklhcri' (OS Error: ...)`
/// surfaced verbatim in a toast. That tells a student nothing they can act
/// on and reads as the app being broken rather than the wifi being out.
String friendlyErrorMessage(Object error) {
  if (error is ApiUnreachableException) {
    return "Can't reach EngiRent. Check your connection and try again.";
  }
  if (error is TimeoutException) {
    return 'That took too long. Check your connection and try again.';
  }
  if (error is SocketException) {
    return "Can't reach EngiRent. Check your connection and try again.";
  }
  if (error is FormatException) {
    // A malformed response body — a real bug, but "the server sent back
    // something we couldn't read" is still more honest and less alarming
    // than a raw parser exception.
    return 'Something went wrong reading the response. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}
