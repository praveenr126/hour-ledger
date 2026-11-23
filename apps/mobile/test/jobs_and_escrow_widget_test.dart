import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:hourledger_mobile/main.dart';
import 'package:hourledger_mobile/src/core/storage/token_storage.dart';
import 'package:hourledger_mobile/src/features/auth/auth_controller.dart';

typedef JsonMap = Map<String, dynamic>;

class MockMarketplaceBackend {
  int balancePaise = 0;
  int topupCalls = 0;
  int fundCalls = 0;
  String jobStatus = 'DRAFT';
  int escrowHeldPaise = 0;
  String appStatus = 'pending';
  final List<JsonMap> ledger = <JsonMap>[];

  http.Client createClient() {
    return MockClient((request) async {
      final path = request.url.path;

      if (path.endsWith('/profile')) {
        return http.Response(
          jsonEncode(<String, dynamic>{
            'id': 'u-poster',
            'phone': '+919876543210',
            'role': 'both',
            'status': 'active',
            'verified_name': 'Asha Rao',
            'age_verified': true,
            'id_type': 'pan',
            'id_last4': '876K',
            'trust_level': 0,
            'responsiveness_score': 100,
            'wallet_balance_paise': balancePaise,
          }),
          200,
        );
      }

      if (path.endsWith('/wallet/topup')) {
        topupCalls++;
        expect(request.headers['Idempotency-Key'], isNotEmpty);
        balancePaise += 100000;
        ledger.insert(0, <String, dynamic>{
          'id': 'le-$topupCalls',
          'txn_id': 'txn-$topupCalls',
          'amount_paise': 100000,
          'reason': 'simulated_topup',
          'job_id': null,
          'created_at': '2026-11-23T14:00:00.000Z',
        });
        return http.Response(
          jsonEncode(<String, dynamic>{
            'txn_id': 'txn-$topupCalls',
            'amount_paise': 100000,
            'wallet_balance_paise': balancePaise,
          }),
          200,
        );
      }

      if (path.endsWith('/wallet/ledger')) {
        return http.Response(
          jsonEncode(<String, dynamic>{
            'wallet_balance_paise': balancePaise,
            'entries': ledger,
          }),
          200,
        );
      }

      if (path == '/v1/jobs' && request.method == 'POST') {
        return http.Response(
          jsonEncode(<String, dynamic>{
            'id': 'job-101',
            'status': 'DRAFT',
            'total_paise': 50000,
          }),
          201,
        );
      }

      if (path == '/v1/jobs' && request.method == 'GET') {
        final open = jobStatus == 'OPEN'
            ? <JsonMap>[
                <String, dynamic>{
                  'id': 'job-101',
                  'poster_id': 'u-poster',
                  'poster_name': 'Asha Rao',
                  'poster_trust_level': 0,
                  'title': 'Stock shelves',
                  'description': 'Organize backroom shelves',
                  'hourly_rate_paise': 25000,
                  'hours': 2,
                  'total_paise': 50000,
                  'address_text': 'MG Road, Mangaluru',
                  'start_at': '2026-11-23T18:00:00.000Z',
                  'status': 'OPEN',
                }
              ]
            : <JsonMap>[];
        return http.Response(jsonEncode(<String, dynamic>{'jobs': open}), 200);
      }

      if (path == '/v1/my/jobs') {
        return http.Response(
          jsonEncode(<String, dynamic>{
            'posted': <JsonMap>[
              <String, dynamic>{
                'id': 'job-101',
                'title': 'Stock shelves',
                'hourly_rate_paise': 25000,
                'hours': 2,
                'total_paise': 50000,
                'address_text': 'MG Road, Mangaluru',
                'start_at': '2026-11-23T18:00:00.000Z',
                'status': jobStatus,
                'pending_applications': appStatus == 'pending' ? 1 : 0,
              }
            ],
            'applied': <JsonMap>[],
          }),
          200,
        );
      }

      if (path == '/v1/jobs/job-101' && request.method == 'GET') {
        return http.Response(
          jsonEncode(<String, dynamic>{
            'id': 'job-101',
            'poster_id': 'u-poster',
            'poster_name': 'Asha Rao',
            'title': 'Stock shelves',
            'description': 'Organize backroom shelves',
            'checklist': <String>['Check aisle 1'],
            'hourly_rate_paise': 25000,
            'hours': 2,
            'total_paise': 50000,
            'escrow_held_paise': escrowHeldPaise,
            'address_text': 'MG Road, Mangaluru',
            'start_at': '2026-11-23T18:00:00.000Z',
            'status': jobStatus,
            'is_poster': true,
            'applications': jobStatus == 'DRAFT'
                ? <JsonMap>[]
                : <JsonMap>[
                    <String, dynamic>{
                      'id': 'app-1',
                      'worker_id': 'u-worker',
                      'worker_name': 'Kiran Nair',
                      'worker_trust_level': 0,
                      'worker_responsiveness_score': 100,
                      'status': appStatus,
                      'respond_by': '2026-11-23T16:00:00.000Z',
                    }
                  ],
            'my_application': null,
          }),
          200,
        );
      }

      if (path == '/v1/jobs/job-101/fund') {
        fundCalls++;
        expect(request.headers['Idempotency-Key'], isNotEmpty);
        balancePaise -= 50000;
        escrowHeldPaise = 50000;
        jobStatus = 'OPEN';
        ledger.insert(0, <String, dynamic>{
          'id': 'le-fund-$fundCalls',
          'txn_id': 'txn-fund-$fundCalls',
          'amount_paise': -50000,
          'reason': 'fund_job_escrow',
          'job_id': 'job-101',
          'created_at': '2026-11-23T14:05:00.000Z',
        });
        return http.Response(
          jsonEncode(<String, dynamic>{
            'job_id': 'job-101',
            'status': 'OPEN',
            'escrow_held_paise': 50000,
            'wallet_balance_paise': balancePaise,
          }),
          200,
        );
      }

      if (path == '/v1/jobs/job-101/applications/app-1/accept') {
        expect(request.headers['Idempotency-Key'], isNotEmpty);
        appStatus = 'accepted';
        jobStatus = 'FILLED';
        return http.Response(
          jsonEncode(<String, dynamic>{
            'job_id': 'job-101',
            'job_status': 'FILLED',
            'accepted_application_id': 'app-1',
            'worker_id': 'u-worker',
          }),
          200,
        );
      }

      return http.Response('{}', 404);
    });
  }
}

void main() {
  testWidgets('Phase 1 flow: Top-up wallet -> Post draft -> Fund escrow -> Accept applicant',
      (tester) async {
    final backend = MockMarketplaceBackend();
    final storage = InMemoryTokenStorage();
    await storage.writeTokens(
      const AuthTokens(accessToken: 'access-initial', refreshToken: 'refresh-initial'),
    );

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

    // 1. Open Wallet tab and simulate Rs 1,000 top-up
    await tester.tap(find.byKey(const Key('nav_wallet_tab')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('simulate_topup_button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('simulate_topup_button')));
    await tester.pumpAndSettle();

    expect(find.text('Rs 1000.00'), findsOneWidget);
    expect(find.text('+Rs 1000.00'), findsOneWidget);

    // 2. Open Post Job tab, create DRAFT job -> lands on JobDetailScreen
    await tester.tap(find.byKey(const Key('nav_post_job_tab')));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('job_title_input')), 'Stock shelves');
    await tester.enterText(find.byKey(const Key('job_desc_input')), 'Organize backroom shelves');
    await tester.ensureVisible(find.byKey(const Key('create_draft_job_button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('create_draft_job_button')));
    await tester.pumpAndSettle();

    expect(find.text('DRAFT'), findsOneWidget);

    // 3. Fund escrow (DRAFT -> OPEN) and accept applicant (OPEN -> FILLED)
    await tester.ensureVisible(find.byKey(const Key('fund_escrow_button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('fund_escrow_button')));
    await tester.pumpAndSettle();

    expect(find.text('OPEN'), findsOneWidget);
    expect(find.text('Kiran Nair'), findsOneWidget);

    await tester.ensureVisible(find.byKey(const Key('accept_applicant_app-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('accept_applicant_app-1')));
    await tester.pumpAndSettle();

    expect(find.text('FILLED'), findsOneWidget);
    expect(find.text('ACCEPTED'), findsOneWidget);
    expect(backend.balancePaise, 50000);
  });
}
