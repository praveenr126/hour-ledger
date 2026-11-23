import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthTokens {
  const AuthTokens({
    required this.accessToken,
    required this.refreshToken,
  });

  final String accessToken;
  final String refreshToken;
}

abstract class TokenStorage {
  Future<AuthTokens?> readTokens();
  Future<void> writeTokens(AuthTokens tokens);
  Future<void> clearTokens();
}

/// Stores access and refresh tokens in Android Keystore via flutter_secure_storage.
class KeystoreTokenStorage implements TokenStorage {
  KeystoreTokenStorage([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  static const _kAccessKey = 'hl_access_token';
  static const _kRefreshKey = 'hl_refresh_token';

  final FlutterSecureStorage _storage;

  @override
  Future<AuthTokens?> readTokens() async {
    final access = await _storage.read(key: _kAccessKey);
    final refresh = await _storage.read(key: _kRefreshKey);
    if (access == null || access.isEmpty || refresh == null || refresh.isEmpty) {
      return null;
    }
    return AuthTokens(accessToken: access, refreshToken: refresh);
  }

  @override
  Future<void> writeTokens(AuthTokens tokens) async {
    await _storage.write(key: _kAccessKey, value: tokens.accessToken);
    await _storage.write(key: _kRefreshKey, value: tokens.refreshToken);
  }

  @override
  Future<void> clearTokens() async {
    await _storage.delete(key: _kAccessKey);
    await _storage.delete(key: _kRefreshKey);
  }
}

/// In-memory Keystore simulation for fast unit/widget tests across ProviderContainer restarts.
class InMemoryTokenStorage implements TokenStorage {
  AuthTokens? _tokens;

  @override
  Future<AuthTokens?> readTokens() async => _tokens;

  @override
  Future<void> writeTokens(AuthTokens tokens) async {
    _tokens = tokens;
  }

  @override
  Future<void> clearTokens() async {
    _tokens = null;
  }
}
