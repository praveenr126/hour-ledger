import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import '../../core/network/api_client.dart';
import '../../core/storage/token_storage.dart';
import '../profile/profile_models.dart';

const String defaultApiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3000/v1',
);

final apiBaseUrlProvider = Provider<String>((ref) => defaultApiBaseUrl);

final tokenStorageProvider = Provider<TokenStorage>((ref) => KeystoreTokenStorage());

final httpClientProvider = Provider<http.Client>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return client;
});

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    baseUrl: ref.watch(apiBaseUrlProvider),
    tokenStorage: ref.watch(tokenStorageProvider),
    httpClient: ref.watch(httpClientProvider),
  );
});

enum AuthStage {
  loading,
  unauthenticated,
  otpSent,
  authenticated,
}

class AuthState {
  const AuthState({
    required this.stage,
    this.pendingPhone,
    this.devOtp,
    this.profile,
    this.busy = false,
    this.errorMessage,
  });

  final AuthStage stage;
  final String? pendingPhone;
  final String? devOtp;
  final UserProfile? profile;
  final bool busy;
  final String? errorMessage;

  AuthState copyWith({
    AuthStage? stage,
    String? pendingPhone,
    String? devOtp,
    UserProfile? profile,
    bool? busy,
    String? errorMessage,
    bool clearError = false,
    bool clearDevOtp = false,
  }) {
    return AuthState(
      stage: stage ?? this.stage,
      pendingPhone: pendingPhone ?? this.pendingPhone,
      devOtp: clearDevOtp ? null : (devOtp ?? this.devOtp),
      profile: profile ?? this.profile,
      busy: busy ?? this.busy,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }
}

final authControllerProvider =
    StateNotifierProvider<AuthController, AuthState>((ref) {
  return AuthController(
    apiClient: ref.watch(apiClientProvider),
    tokenStorage: ref.watch(tokenStorageProvider),
  );
});

class AuthController extends StateNotifier<AuthState> {
  AuthController({
    required ApiClient apiClient,
    required TokenStorage tokenStorage,
  })  : _api = apiClient,
        _storage = tokenStorage,
        super(const AuthState(stage: AuthStage.loading)) {
    restoreSession();
  }

  final ApiClient _api;
  final TokenStorage _storage;

  Future<void> restoreSession() async {
    final saved = await _storage.readTokens();
    if (saved == null) {
      state = const AuthState(stage: AuthStage.unauthenticated);
      return;
    }

    try {
      final profileJson = await _api.getJson('/profile', authenticated: true);
      state = AuthState(
        stage: AuthStage.authenticated,
        profile: UserProfile.fromJson(profileJson),
      );
    } on ApiException {
      await _storage.clearTokens();
      state = const AuthState(stage: AuthStage.unauthenticated);
    } catch (_) {
      state = const AuthState(
        stage: AuthStage.unauthenticated,
        errorMessage: 'NETWORK_ERROR',
      );
    }
  }

  Future<void> requestOtp(String phone) async {
    if (state.busy) return;
    final trimmed = phone.trim();
    state = state.copyWith(busy: true, clearError: true);

    try {
      final res = await _api.postJson('/auth/otp/request', <String, dynamic>{
        'phone': trimmed,
      });
      state = AuthState(
        stage: AuthStage.otpSent,
        pendingPhone: trimmed,
        devOtp: res['dev_otp'] as String?,
        busy: false,
      );
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, errorMessage: e.message);
    } catch (_) {
      state = state.copyWith(busy: false, errorMessage: 'NETWORK_ERROR');
    }
  }

  Future<void> verifyOtp(String code) async {
    if (state.busy || state.pendingPhone == null) return;
    state = state.copyWith(busy: true, clearError: true);

    try {
      final verifyRes = await _api.postJson('/auth/otp/verify', <String, dynamic>{
        'phone': state.pendingPhone!,
        'code': code.trim(),
      });

      await _storage.writeTokens(
        AuthTokens(
          accessToken: verifyRes['access_token'] as String,
          refreshToken: verifyRes['refresh_token'] as String,
        ),
      );

      final profileJson = await _api.getJson('/profile', authenticated: true);
      state = AuthState(
        stage: AuthStage.authenticated,
        profile: UserProfile.fromJson(profileJson),
        busy: false,
      );
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, errorMessage: e.message);
    } catch (_) {
      state = state.copyWith(busy: false, errorMessage: 'NETWORK_ERROR');
    }
  }

  void resetToPhoneEntry() {
    state = const AuthState(stage: AuthStage.unauthenticated);
  }

  Future<void> submitVerification({
    required String verifiedName,
    required String dob,
    required String idType,
    required String idNumber,
    required bool livenessPassed,
    required String livenessPrompt,
  }) async {
    if (state.busy) return;
    state = state.copyWith(busy: true, clearError: true);

    try {
      await _api.postJson(
        '/profile/verify',
        <String, dynamic>{
          'verified_name': verifiedName.trim(),
          'dob': dob.trim(),
          'id_type': idType,
          'id_number': idNumber.trim(),
          'liveness_passed': livenessPassed,
          'liveness_prompt': livenessPrompt,
        },
        authenticated: true,
      );

      final profileJson = await _api.getJson('/profile', authenticated: true);
      state = AuthState(
        stage: AuthStage.authenticated,
        profile: UserProfile.fromJson(profileJson),
        busy: false,
      );
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, errorMessage: e.message);
    } catch (_) {
      state = state.copyWith(busy: false, errorMessage: 'NETWORK_ERROR');
    }
  }

  Future<void> logout() async {
    final saved = await _storage.readTokens();
    if (saved != null) {
      try {
        await _api.postJson('/auth/logout', <String, dynamic>{
          'refresh_token': saved.refreshToken,
        });
      } catch (_) {
        // Best-effort server revocation; always clear local Keystore tokens.
      }
    }
    await _storage.clearTokens();
    state = const AuthState(stage: AuthStage.unauthenticated);
  }
}
