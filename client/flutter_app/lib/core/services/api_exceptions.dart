/// Thrown by [ApiService] when a request never reached the server at all —
/// distinct from the server responding with an error status, which is a
/// normal, handleable outcome. Callers that want a specific "you're
/// offline" message rather than a generic failure should catch this.
class ApiUnreachableException implements Exception {
  const ApiUnreachableException(this.cause);
  final String cause;

  @override
  String toString() => 'ApiUnreachableException: $cause';
}
