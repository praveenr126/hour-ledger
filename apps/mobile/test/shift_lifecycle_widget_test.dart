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

class MockShiftBackend {
  String status = 'FILLED';
  bool isPoster = false;
  List<String> completedChecklist = <String>[];
  bool hasRated = false;
  int approveCalls = 0;

  http.Client createClient() {
    return MockClient((request) async {
      final path = request.url.path;

      if (path == '/v1/jobs') {
        return http.Response(jsonEncode(<String, dynamic>{'jobs': <JsonMap>[]}), 200);
      }
      if (path == '/v1/my/jobs') {
        return http.Response(
          jsonEncode(<String, dynamic>{'posted': <JsonMap>[], 'applied': <JsonMap>[]}),
          200,
        );
      }
      if (path == '/v1/wallet/ledger') {
        return http.Response(
          jsonEncode(<String, dynamic>{'wallet_balance_paise': 28500, 'entries': <JsonMap>[]}),
          200,
        );
      }

      if (path == '/v1/jobs/job-202' && request.method == 'GET') {
        return http.Response(
          jsonEncode(<String, dynamic>{
            'id': 'job-202',
            'poster_id': 'u-poster',
            'poster_name': 'Asha Rao',
            'title': 'Warehouse sorting',
            'description': 'Sort cartons by zone',
            'checklist': <String>['Scan barcodes'],
            'hourly_rate_paise': 30000,
            'hours': 2,
            'total_paise': 60000,
            'escrow_held_paise': status == 'COMPLETED' ? 0 : 60000,
            'lat': 12.9141,
            'lng': 74.8560,
            'address_text': 'Port Road, Mangaluru',
            'start_at': '2026-11-23T18:00:00.000Z',
            'status': status,
            'is_poster': isPoster,
            'applications': <JsonMap>[],
            'my_application': <String, dynamic>{
              'id': 'app-202',
              'status': 'accepted',
              'respond_by': '2026-11-23T17:00:00.000Z',
            },
            'shift': status == 'FILLED'
                ? null
                : <String, dynamic>{
                    'worker_id': 'u-worker',
                    'checked_in_at': '2026-11-23T18:00:00.000Z',
                    'checkin_distance_m': 12,
                    'completed_checklist': completedChecklist,
                    'checked_out_at':
                        status == 'IN_PROGRESS' ? null : '2026-11-23T19:00:00.000Z',
                    'actual_minutes': status == 'IN_PROGRESS' ? null : 60,
                    'payable_minutes': status == 'IN_PROGRESS' ? null : 60,
                    'gross_earned_paise': status == 'IN_PROGRESS' ? null : 30000,
                    'worker_payout_paise': status == 'IN_PROGRESS' ? null : 28500,
                    'platform_fee_paise': status == 'IN_PROGRESS' ? null : 1500,
                    'poster_refund_paise': status == 'IN_PROGRESS' ? null : 30000,
                    'approved_at':
                        status == 'COMPLETED' ? '2026-11-23T19:05:00.000Z' : null,
                  },
            'my_rating': hasRated ? <String, dynamic>{'id': 'rat-1'} : null,
          }),
          200,
        );
      }

      if (path.endsWith('/checkin')) {
        status = 'IN_PROGRESS';
        return http.Response(
          jsonEncode(<String, dynamic>{'job_id': 'job-202', 'status': 'IN_PROGRESS'}),
          200,
        );
      }

      if (path.endsWith('/checklist')) {
        final body = jsonDecode(request.body) as JsonMap;
        completedChecklist = (body['completed_items'] as List<dynamic>)
            .map((e) => e.toString())
            .toList();
        return http.Response(
          jsonEncode(<String, dynamic>{'completed_checklist': completedChecklist}),
          200,
        );
      }

      if (path.endsWith('/checkout')) {
        status = 'AWAITING_APPROVAL';
        return http.Response(
          jsonEncode(<String, dynamic>{
            'job_id': 'job-202',
            'status': 'AWAITING_APPROVAL',
            'payable_minutes': 60,
            'worker_payout_paise': 28500,
          }),
          200,
        );
      }

      if (path.endsWith('/approve')) {
        approveCalls++;
        expect(request.headers['Idempotency-Key'], isNotEmpty);
        status = 'COMPLETED';
        return http.Response(
          jsonEncode(<String, dynamic>{
            'job_id': 'job-202',
            'status': 'COMPLETED',
            'worker_payout_paise': 28500,
          }),
          200,
        );
      }

      if (path.endsWith('/rate')) {
        hasRated = true;
        return http.Response(jsonEncode(<String, dynamic>{'id': 'rat-1'}), 201);
      }

      return http.Response('{}', 404);
    });
  }
}

void main() {
  testWidgets(
      'Phase 2 flow: Check-in -> Checklist -> Clock-out -> Poster approve -> Mutual rating (at 200% text scale)',
      (tester) async {
    final backend = MockShiftBackend();
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
          child: MaterialApp(
            theme: buildAppTheme(),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const JobDetailScreen(jobId: 'job-202'),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // 1. Worker checks in on FILLED job
    await tester.ensureVisible(find.byKey(const Key('qr_payload_input')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('qr_payload_input')),
      '{"v":1,"job_id":"job-202","ts":1795440000,"sig":"0123456789abcdef0123456789abcdef"}',
    );
    await tester.ensureVisible(find.byKey(const Key('checkin_now_button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('checkin_now_button')));
    await tester.pumpAndSettle();

    expect(find.text('IN_PROGRESS'), findsOneWidget);

    // 2. Worker checks checklist item & clocks out
    await tester.ensureVisible(find.byKey(const Key('checklist_item_Scan barcodes')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('checklist_item_Scan barcodes')));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('clock_out_button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('clock_out_button')));
    await tester.pumpAndSettle();

    expect(find.text('AWAITING_APPROVAL'), findsOneWidget);
    expect(find.text('Rs 285.00'), findsOneWidget);

    // 3. Switch to Poster view and approve payout
    backend.isPoster = true;
    await tester.tap(find.byIcon(Icons.refresh_outlined));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('approve_payout_button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('approve_payout_button')));
    await tester.pumpAndSettle();

    expect(find.text('COMPLETED'), findsOneWidget);
    expect(backend.approveCalls, 1);

    // 4. Submit rating on COMPLETED shift and verify zero overflow at 200% scale
    await tester.ensureVisible(find.byKey(const Key('submit_rating_button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('submit_rating_button')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('rating_submitted_banner')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
