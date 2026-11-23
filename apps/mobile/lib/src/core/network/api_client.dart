import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../storage/token_storage.dart';

typedef JsonMap = Map<String, dynamic>;

class ApiException implements Exception {
  ApiException({
    required this.statusCode,
    required this.code,
    required this.message,
  });

  final int statusCode;
  final String code;
  final String message;

  @override
  String toString() => 'ApiException($statusCode, $code:$message)';
}

class ApiClient {
  ApiClient({
    required this.baseUrl,
    required this.tokenStorage,
    http.Client? httpClient,
    this.onSessionExpired,
  }) : _http = httpClient ?? http.Client();

  final String baseUrl;
  final TokenStorage tokenStorage;
  final http.Client _http;
  final Future<void> Function()? onSessionExpired;

  Future<bool>? _refreshInFlight;

  Uri _uri(String path) => Uri.parse('$baseUrl$path');

  Future<JsonMap> postJson(
    String path,
    JsonMap body, {
    bool authenticated = false,
    String? idempotencyKey,
  }) async {
    final res = await _sendWithAutoRefresh(
      authenticated: authenticated,
      send: (accessToken) => _http.post(
        _uri(path),
        headers: _headers(accessToken, idempotencyKey: idempotencyKey),
        body: jsonEncode(body),
      ),
    );
    return _decodeResponse(res);
  }

  Future<JsonMap> getJson(
    String path, {
    bool authenticated = true,
  }) async {
    final res = await _sendWithAutoRefresh(
      authenticated: authenticated,
      send: (accessToken) => _http.get(
        _uri(path),
        headers: _headers(accessToken),
      ),
    );
    return _decodeResponse(res);
  }

  Map<String, String> _headers(String? accessToken, {String? idempotencyKey}) {
    return <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      if (accessToken != null) 'Authorization': 'Bearer $accessToken',
      if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey,
    };
  }

  Future<http.Response> _sendWithAutoRefresh({
    required bool authenticated,
    required Future<http.Response> Function(String? accessToken) send,
  }) async {
    String? accessToken;
    if (authenticated) {
      final tokens = await tokenStorage.readTokens();
      accessToken = tokens?.accessToken;
    }

    var response = await send(accessToken);
    if (authenticated && response.statusCode == 401) {
      final refreshed = await _refreshTokensSingleFlight();
      if (refreshed) {
        final updated = await tokenStorage.readTokens();
        response = await send(updated?.accessToken);
      }
    }
    return response;
  }

  Future<bool> _refreshTokensSingleFlight() {
    if (_refreshInFlight != null) {
      return _refreshInFlight!;
    }
    final completer = Completer<bool>();
    _refreshInFlight = completer.future;

    () async {
      try {
        final current = await tokenStorage.readTokens();
        if (current == null) {
          completer.complete(false);
          return;
        }
        final res = await _http.post(
          _uri('/auth/refresh'),
          headers: _headers(null),
          body: jsonEncode(<String, dynamic>{'refresh_token': current.refreshToken}),
        );
        if (res.statusCode == 200) {
          final data = jsonDecode(res.body) as JsonMap;
          await tokenStorage.writeTokens(
            AuthTokens(
              accessToken: data['access_token'] as String,
              refreshToken: data['refresh_token'] as String,
            ),
          );
          completer.complete(true);
        } else {
          await tokenStorage.clearTokens();
          if (onSessionExpired != null) {
            await onSessionExpired!();
          }
          completer.complete(false);
        }
      } catch (_) {
        completer.complete(false);
      } finally {
        _refreshInFlight = null;
      }
    }();

    return completer.future;
  }

  JsonMap _decodeResponse(http.Response res) {
    final decoded = res.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(res.body) as JsonMap;

    if (res.statusCode >= 200 && res.statusCode < 300) {
      return decoded;
    }

    throw ApiException(
      statusCode: res.statusCode,
      code: (decoded['error'] as String?) ?? 'HTTP_${res.statusCode}',
      message: (decoded['message'] as String?) ?? 'Request failed',
    );
  }
}
