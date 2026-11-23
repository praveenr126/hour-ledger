import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:hourledger_mobile/l10n/app_localizations.dart';
import 'package:hourledger_mobile/src/core/storage/token_storage.dart';
import 'package:hourledger_mobile/src/core/theme/app_theme.dart';
import 'package:hourledger_mobile/src/features/auth/auth_controller.dart';
import 'package:hourledger_mobile/src/features/jobs/job_detail_screen.dart';

typedef JsonMap = Map<String, dynamic>;

void main() {
  testWidgets('Phase 3 flow: Raising dispute freezes escrow at 200% text scale', (tester) async {
    String status = 'IN_PROGRESS';
    String? disputeReason;

    final client = MockClient((request) async {
      final path = request.url.path;
      if (path == '/v1/jobs') return http.Response(jsonEncode(<String, dynamic>{'jobs': <JsonMap>[]}), 200);
      if (path == '/v1/my/jobs') return http.Response(jsonEncode(<String, dynamic>{'posted': <JsonMap>[], 'applied': <JsonMap>[]}), 200);
      if (path == '/v1/wallet/ledger') return http.Response(jsonEncode(<String, dynamic>{'wallet_balance_paise': 40000, 'entries': <JsonMap>[]}), 200);
      if (path == '/v1/jobs/job-303/dispute') {
        final body = jsonDecode(request.body) as JsonMap;
        status = 'DISPUTED';
        disputeReason = body['reason'] as String;
        return http.Response(jsonEncode(<String, dynamic>{'status': 'DISPUTED'}), 201);
      }
      if (path == '/v1/jobs/job-303') {
        return http.Response(
          jsonEncode(<String, dynamic>{
            'id': 'job-303',
            'poster_id': 'u-poster',
            'poster_name': 'Asha Rao',
            'title': 'Cafe closing shift',
            'description': 'Clean counter',
            'checklist': <String>[],
            'hourly_rate_paise': 30000,
            'hours': 2,
            'total_paise': 60000,
            'escrow_held_paise': 60000,
            'lat': 12.9141,
            'lng': 74.8560,
            'address_text': 'Hampankatta, Mangaluru',
            'start_at': '2026-11-23T18:00:00.000Z',
            'status': status,
            'is_poster': false,
            'applications': <JsonMap>[],
            'my_application': <String, dynamic>{'id': 'app-303', 'status': 'accepted', 'respond_by': '2026-11-23T17:00:00.000Z'},
            'shift': <String, dynamic>{'worker_id': 'u-worker', 'checked_in_at': '2026-11-23T18:00:00.000Z', 'completed_checklist': <String>[]},
            'dispute': disputeReason == null ? null : <String, dynamic>{'raised_by': 'u-worker', 'reason': disputeReason, 'evidence_note': '', 'status': 'open'},
          }),
          200,
        );
      }
      return http.Response('{}', 404);
    });

    final storage = InMemoryTokenStorage();
    await storage.writeTokens(const AuthTokens(accessToken: 'access-initial', refreshToken: 'refresh-initial'));

    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(2.0)),
        child: ProviderScope(
          overrides: [
            apiBaseUrlProvider.overrideWithValue('http://localhost:3000/v1'),
            tokenStorageProvider.overrideWithValue(storage),
            httpClientProvider.overrideWithValue(client),
          ],
          child: MaterialApp(
            theme: buildAppTheme(),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const JobDetailScreen(jobId: 'job-303'),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('open_dispute_form_button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('open_dispute_form_button')));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('dispute_reason_input')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('dispute_reason_input')), 'Site locked halfway through shift');

    await tester.ensureVisible(find.byKey(const Key('submit_dispute_button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('submit_dispute_button')));
    await tester.pumpAndSettle();

    expect(find.text('DISPUTED'), findsOneWidget);
    expect(find.byKey(const Key('dispute_status_card')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
