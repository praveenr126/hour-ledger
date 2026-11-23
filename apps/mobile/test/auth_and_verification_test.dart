import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:hourledger_mobile/l10n/app_localizations.dart';
import 'package:hourledger_mobile/main.dart';
import 'package:hourledger_mobile/src/core/network/api_client.dart';
import 'package:hourledger_mobile/src/core/storage/token_storage.dart';
import 'package:hourledger_mobile/src/features/auth/auth_controller.dart';

class FakeBackend {
  int otpRequestCalls = 0;
  int otpVerifyCalls = 0;
  int verifyProfileCalls = 0;
  int refreshCalls = 0;
  String activeAccessToken = 'access-initial';
  String activeRefreshToken = 'refresh-initial';
  bool ageVerified = false;
  String? verifiedName;
  String? idType;
  String? idLast4;

  http.Client createClient() {
    return MockClient((request) async {
      final path = request.url.path;

      if (path.endsWith('/auth/otp/request')) {
        otpRequestCalls++;
        await Future<void>.delayed(const Duration(milliseconds: 20));
        return http.Response(
          jsonEncode(<String, dynamic>{
            'status': 'sent',
            'expires_at': '2026-11-23T14:00:00.000Z',
            'dev_otp': '482910',
          }),
          200,
        );
      }

      if (path.endsWith('/auth/otp/verify')) {
        otpVerifyCalls++;
        await Future<void>.delayed(const Duration(milliseconds: 20));
        return http.Response(
          jsonEncode(<String, dynamic>{
            'access_token': activeAccessToken,
            'refresh_token': activeRefreshToken,
            'refresh_expires_at': '2026-12-23T14:00:00.000Z',
            'is_new_user': true,
            'user': <String, dynamic>{'id': 'u-1', 'role': 'both', 'status': 'active'},
          }),
          200,
        );
      }

      if (path.endsWith('/auth/refresh')) {
        refreshCalls++;
        await Future<void>.delayed(const Duration(milliseconds: 30));
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        if (body['refresh_token'] != activeRefreshToken) {
          return http.Response(
            jsonEncode(<String, dynamic>{'error': 'REFRESH_INVALID', 'message': 'Used token'}),
            401,
          );
        }
        activeAccessToken = 'access-rotated-$refreshCalls';
        activeRefreshToken = 'refresh-rotated-$refreshCalls';
        return http.Response(
          jsonEncode(<String, dynamic>{
            'access_token': activeAccessToken,
            'refresh_token': activeRefreshToken,
            'refresh_expires_at': '2026-12-23T14:00:00.000Z',
          }),
          200,
        );
      }

      if (path.endsWith('/profile/verify')) {
        verifyProfileCalls++;
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        final rawId = (body['id_number'] as String).replaceAll(' ', '').toUpperCase();
        ageVerified = true;
        verifiedName = body['verified_name'] as String;
        idType = body['id_type'] as String;
        idLast4 = rawId.substring(rawId.length - 4);
        return http.Response(
          jsonEncode(<String, dynamic>{
            'id': 'u-1',
            'verified_name': verifiedName,
            'age_verified': true,
            'id_type': idType,
            'id_last4': idLast4,
            'trust_level': 0,
          }),
          200,
        );
      }

      if (path.endsWith('/profile')) {
        final authHeader = request.headers['Authorization'];
        if (authHeader != 'Bearer $activeAccessToken') {
          return http.Response(
            jsonEncode(<String, dynamic>{'error': 'UNAUTHORIZED', 'message': 'Expired'}),
            401,
          );
        }
        return http.Response(
          jsonEncode(<String, dynamic>{
            'id': 'u-1',
            'phone': '+919876543210',
            'role': 'both',
            'status': 'active',
            'verified_name': verifiedName,
            'age_verified': ageVerified,
            'id_type': idType,
            'id_last4': idLast4,
            'trust_level': 0,
            'responsiveness_score': 100,
            'wallet_balance_paise': 0,
          }),
          200,
        );
      }

      if (path.endsWith('/jobs')) {
        return http.Response(jsonEncode(<String, dynamic>{'jobs': <dynamic>[]}), 200);
      }

      if (path.endsWith('/my/jobs')) {
        return http.Response(
          jsonEncode(<String, dynamic>{'posted': <dynamic>[], 'applied': <dynamic>[]}),
          200,
        );
      }

      if (path.endsWith('/wallet/ledger')) {
        return http.Response(
          jsonEncode(<String, dynamic>{'wallet_balance_paise': 0, 'entries': <dynamic>[]}),
          200,
        );
      }

      if (path.endsWith('/auth/logout')) {
        return http.Response(jsonEncode(<String, dynamic>{'status': 'logged_out'}), 200);
      }

      return http.Response('{}', 404);
    });
  }
}

void main() {
  testWidgets('Phase 0 flow: OTP sign up -> 18+ verification -> verified profile', (tester) async {
    final backend = FakeBackend();
    final storage = InMemoryTokenStorage();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiBaseUrlProvider.overrideWithValue('http://localhost:3000/v1'),
          tokenStorageProvider.overrideWithValue(storage),
          httpClientProvider.overrideWithValue(backend.createClient()),
        ],
        child: const HourLedgerApp(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('phone_input')), '+919876543210');
    await tester.tap(find.byKey(const Key('send_otp_button')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('dev_otp_banner')), findsOneWidget);
    expect(find.text('482910'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('otp_input')), '482910');
    await tester.tap(find.byKey(const Key('verify_otp_button')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('verified_name_input')), findsOneWidget);

    await tester.enterText(find.byKey(const Key('verified_name_input')), 'Asha Rao');
    await tester.enterText(find.byKey(const Key('dob_input')), '2001-08-15');
    await tester.enterText(find.byKey(const Key('id_number_input')), 'PQRSX9876K');

    await tester.ensureVisible(find.byKey(const Key('liveness_button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('liveness_button')));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('submit_verification_button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('submit_verification_button')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('nav_wallet_tab')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('verified_status_badge')), findsOneWidget);
    expect(find.text('Asha Rao'), findsOneWidget);
    expect(find.text('PAN ****876K'), findsOneWidget);
    expect(find.text('Rs 0.00'), findsOneWidget);
  });

  testWidgets('Idempotency: rapid double-tap on Send OTP sends only one request', (tester) async {
    final backend = FakeBackend();
    final storage = InMemoryTokenStorage();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiBaseUrlProvider.overrideWithValue('http://localhost:3000/v1'),
          tokenStorageProvider.overrideWithValue(storage),
          httpClientProvider.overrideWithValue(backend.createClient()),
        ],
        child: const HourLedgerApp(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('phone_input')), '+919876543210');
    await tester.tap(find.byKey(const Key('send_otp_button')));
    await tester.tap(find.byKey(const Key('send_otp_button')));
    await tester.pumpAndSettle();

    expect(backend.otpRequestCalls, 1);
  });

  test('Concurrency: 5 simultaneous 401 requests coalesce into 1 refresh call', () async {
    final backend = FakeBackend();
    final storage = InMemoryTokenStorage();
    await storage.writeTokens(
      const AuthTokens(accessToken: 'expired-token', refreshToken: 'refresh-initial'),
    );

    final client = ApiClient(
      baseUrl: 'http://localhost:3000/v1',
      tokenStorage: storage,
      httpClient: backend.createClient(),
    );

    final results = await Future.wait(
      [for (var i = 0; i < 5; i++) client.getJson('/profile')],
    );

    expect(results, hasLength(5));
    expect(backend.refreshCalls, 1);
    final updated = await storage.readTokens();
    expect(updated?.accessToken, 'access-rotated-1');
  });

  testWidgets('Restart persistence: verified session restores across ProviderContainer restart',
      (tester) async {
    final backend = FakeBackend()
      ..ageVerified = true
      ..verifiedName = 'Kiran Nair'
      ..idType = 'college_id'
      ..idLast4 = '6001';

    final sharedKeystore = InMemoryTokenStorage();
    await sharedKeystore.writeTokens(
      const AuthTokens(accessToken: 'access-initial', refreshToken: 'refresh-initial'),
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiBaseUrlProvider.overrideWithValue('http://localhost:3000/v1'),
          tokenStorageProvider.overrideWithValue(sharedKeystore),
          httpClientProvider.overrideWithValue(backend.createClient()),
        ],
        child: const HourLedgerApp(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('nav_wallet_tab')));
    await tester.pumpAndSettle();
    expect(find.text('Kiran Nair'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiBaseUrlProvider.overrideWithValue('http://localhost:3000/v1'),
          tokenStorageProvider.overrideWithValue(sharedKeystore),
          httpClientProvider.overrideWithValue(backend.createClient()),
        ],
        child: const HourLedgerApp(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('nav_wallet_tab')));
    await tester.pumpAndSettle();

    expect(find.text('Kiran Nair'), findsOneWidget);
    expect(find.text('COLLEGE_ID ****6001'), findsOneWidget);
  });

  testWidgets('Accessibility & UI guardrails: 200% text scale has no overflow and zero banned strings',
      (tester) async {
    final backend = FakeBackend()
      ..ageVerified = true
      ..verifiedName = 'Asha Rao'
      ..idType = 'pan'
      ..idLast4 = '876K';
    final storage = InMemoryTokenStorage();
    await storage.writeTokens(
      const AuthTokens(accessToken: 'access-initial', refreshToken: 'refresh-initial'),
    );

    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(2.0)),
        child: ProviderScope(
          overrides: [
            apiBaseUrlProvider.overrideWithValue('http://localhost:3000/v1'),
            tokenStorageProvider.overrideWithValue(storage),
            httpClientProvider.overrideWithValue(backend.createClient()),
          ],
          child: const HourLedgerApp(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    await tester.tap(find.byKey(const Key('nav_wallet_tab')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    final ctx = tester.element(find.byType(NavigationBar));
    final l10n = AppLocalizations.of(ctx)!;
    final sampleStrings = <String>[
      l10n.appTitle,
      l10n.browseJobsTitle,
      l10n.postJobSubtitle,
      l10n.fundEscrowButton,
      l10n.simulateTopupButton,
      l10n.networkErrorMessage,
    ];
    for (final s in sampleStrings) {
      expect(s.contains('!'), isFalse);
      expect(s.toLowerCase().contains('oops'), isFalse);
    }
  });
}
