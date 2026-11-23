import 'dart:math';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/network/api_client.dart';
import '../auth/auth_controller.dart';
import 'job_models.dart';

String _newIdempotencyKey(String prefix) {
  final rand = Random.secure();
  final n1 = rand.nextInt(1 << 30);
  final n2 = rand.nextInt(1 << 30);
  return '$prefix-${DateTime.now().microsecondsSinceEpoch}-$n1-$n2';
}

class JobsState {
  const JobsState({
    this.openJobs = const <JobSummary>[],
    this.myJobs = const MyJobsState(posted: <PostedJobSummary>[], applied: <AppliedJobSummary>[]),
    this.ledger = const WalletLedgerState(balancePaise: 0, entries: <LedgerEntryItem>[]),
    this.busy = false,
    this.errorMessage,
  });

  final List<JobSummary> openJobs;
  final MyJobsState myJobs;
  final WalletLedgerState ledger;
  final bool busy;
  final String? errorMessage;

  JobsState copyWith({
    List<JobSummary>? openJobs,
    MyJobsState? myJobs,
    WalletLedgerState? ledger,
    bool? busy,
    String? errorMessage,
    bool clearError = false,
  }) {
    return JobsState(
      openJobs: openJobs ?? this.openJobs,
      myJobs: myJobs ?? this.myJobs,
      ledger: ledger ?? this.ledger,
      busy: busy ?? this.busy,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }
}

final jobsControllerProvider =
    StateNotifierProvider<JobsController, JobsState>((ref) {
  return JobsController(ref.watch(apiClientProvider));
});

class JobsController extends StateNotifier<JobsState> {
  JobsController(this._api) : super(const JobsState()) {
    refreshAll();
  }

  final ApiClient _api;

  Future<void> refreshAll() async {
    try {
      final results = await Future.wait<JsonMap>(<Future<JsonMap>>[
        _api.getJson('/jobs'),
        _api.getJson('/my/jobs'),
        _api.getJson('/wallet/ledger'),
      ]);
      final rawJobs = (results[0]['jobs'] as List<dynamic>?) ?? <dynamic>[];
      state = state.copyWith(
        openJobs: rawJobs.map((e) => JobSummary.fromJson(e as JsonMap)).toList(),
        myJobs: MyJobsState.fromJson(results[1]),
        ledger: WalletLedgerState.fromJson(results[2]),
        clearError: true,
      );
    } on ApiException catch (e) {
      state = state.copyWith(errorMessage: e.message);
    } catch (_) {
      state = state.copyWith(errorMessage: 'NETWORK_ERROR');
    }
  }

  Future<void> topupDemoWallet({int amountPaise = 100000}) async {
    if (state.busy) return;
    state = state.copyWith(busy: true, clearError: true);
    try {
      await _api.postJson(
        '/wallet/topup',
        <String, dynamic>{'amount_paise': amountPaise},
        authenticated: true,
        idempotencyKey: _newIdempotencyKey('topup'),
      );
      await refreshAll();
      state = state.copyWith(busy: false);
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, errorMessage: e.message);
    } catch (_) {
      state = state.copyWith(busy: false, errorMessage: 'NETWORK_ERROR');
    }
  }

  Future<String?> createDraftJob({
    required String title,
    required String description,
    required int hourlyRatePaise,
    required int hours,
    required String addressText,
    required int startsInHours,
    String? checklistTask,
  }) async {
    if (state.busy) return null;
    state = state.copyWith(busy: true, clearError: true);
    try {
      final startAt = DateTime.now()
          .toUtc()
          .add(Duration(hours: startsInHours))
          .toIso8601String();
      final checklist = <String>[
        if (checklistTask != null && checklistTask.trim().isNotEmpty)
          checklistTask.trim(),
      ];
      final res = await _api.postJson(
        '/jobs',
        <String, dynamic>{
          'title': title.trim(),
          'description': description.trim(),
          'checklist': checklist,
          'hourly_rate_paise': hourlyRatePaise,
          'hours': hours,
          'lat': 12.9141,
          'lng': 74.8560,
          'address_text': addressText.trim(),
          'start_at': startAt,
        },
        authenticated: true,
      );
      await refreshAll();
      state = state.copyWith(busy: false);
      return res['id'] as String;
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, errorMessage: e.message);
      return null;
    } catch (_) {
      state = state.copyWith(busy: false, errorMessage: 'NETWORK_ERROR');
      return null;
    }
  }

  Future<JobDetail> fetchJobDetail(String jobId) async {
    final json = await _api.getJson('/jobs/$jobId');
    return JobDetail.fromJson(json);
  }

  Future<bool> fundJobEscrow(String jobId) async {
    if (state.busy) return false;
    state = state.copyWith(busy: true, clearError: true);
    try {
      await _api.postJson(
        '/jobs/$jobId/fund',
        <String, dynamic>{},
        authenticated: true,
        idempotencyKey: _newIdempotencyKey('fund-$jobId'),
      );
      await refreshAll();
      state = state.copyWith(busy: false);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, errorMessage: e.message);
      return false;
    } catch (_) {
      state = state.copyWith(busy: false, errorMessage: 'NETWORK_ERROR');
      return false;
    }
  }

  Future<bool> applyToJob(String jobId) async {
    if (state.busy) return false;
    state = state.copyWith(busy: true, clearError: true);
    try {
      await _api.postJson(
        '/jobs/$jobId/apply',
        <String, dynamic>{},
        authenticated: true,
      );
      await refreshAll();
      state = state.copyWith(busy: false);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, errorMessage: e.message);
      return false;
    } catch (_) {
      state = state.copyWith(busy: false, errorMessage: 'NETWORK_ERROR');
      return false;
    }
  }

  Future<bool> acceptApplicant(String jobId, String applicationId) async {
    if (state.busy) return false;
    state = state.copyWith(busy: true, clearError: true);
    try {
      await _api.postJson(
        '/jobs/$jobId/applications/$applicationId/accept',
        <String, dynamic>{},
        authenticated: true,
        idempotencyKey: _newIdempotencyKey('accept-$applicationId'),
      );
      await refreshAll();
      state = state.copyWith(busy: false);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, errorMessage: e.message);
      return false;
    } catch (_) {
      state = state.copyWith(busy: false, errorMessage: 'NETWORK_ERROR');
      return false;
    }
  }

  Future<bool> rejectApplicant(String jobId, String applicationId) async {
    if (state.busy) return false;
    state = state.copyWith(busy: true, clearError: true);
    try {
      await _api.postJson(
        '/jobs/$jobId/applications/$applicationId/reject',
        <String, dynamic>{},
        authenticated: true,
      );
      await refreshAll();
      state = state.copyWith(busy: false);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, errorMessage: e.message);
      return false;
    } catch (_) {
      state = state.copyWith(busy: false, errorMessage: 'NETWORK_ERROR');
      return false;
    }
  }

  Future<String?> fetchCheckinQr(String jobId) async {
    if (state.busy) return null;
    state = state.copyWith(busy: true, clearError: true);
    try {
      final res = await _api.getJson('/jobs/$jobId/checkin-qr');
      state = state.copyWith(busy: false);
      return res['qr_payload'] as String;
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, errorMessage: e.message);
      return null;
    } catch (_) {
      state = state.copyWith(busy: false, errorMessage: 'NETWORK_ERROR');
      return null;
    }
  }

  Future<bool> checkInToJob({
    required String jobId,
    required String qrPayload,
    required double lat,
    required double lng,
  }) async {
    if (state.busy) return false;
    state = state.copyWith(busy: true, clearError: true);
    try {
      await _api.postJson(
        '/jobs/$jobId/checkin',
        <String, dynamic>{
          'qr_payload': qrPayload.trim(),
          'lat': lat,
          'lng': lng,
        },
        authenticated: true,
      );
      await refreshAll();
      state = state.copyWith(busy: false);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, errorMessage: e.message);
      return false;
    } catch (_) {
      state = state.copyWith(busy: false, errorMessage: 'NETWORK_ERROR');
      return false;
    }
  }

  Future<bool> updateChecklist(String jobId, List<String> completedItems) async {
    if (state.busy) return false;
    state = state.copyWith(busy: true, clearError: true);
    try {
      await _api.postJson(
        '/jobs/$jobId/checklist',
        <String, dynamic>{'completed_items': completedItems},
        authenticated: true,
      );
      state = state.copyWith(busy: false);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, errorMessage: e.message);
      return false;
    } catch (_) {
      state = state.copyWith(busy: false, errorMessage: 'NETWORK_ERROR');
      return false;
    }
  }

  Future<bool> checkOutFromJob(String jobId) async {
    if (state.busy) return false;
    state = state.copyWith(busy: true, clearError: true);
    try {
      await _api.postJson(
        '/jobs/$jobId/checkout',
        <String, dynamic>{},
        authenticated: true,
      );
      await refreshAll();
      state = state.copyWith(busy: false);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, errorMessage: e.message);
      return false;
    } catch (_) {
      state = state.copyWith(busy: false, errorMessage: 'NETWORK_ERROR');
      return false;
    }
  }

  Future<bool> approveShiftPayout(String jobId) async {
    if (state.busy) return false;
    state = state.copyWith(busy: true, clearError: true);
    try {
      await _api.postJson(
        '/jobs/$jobId/approve',
        <String, dynamic>{},
        authenticated: true,
        idempotencyKey: _newIdempotencyKey('approve-$jobId'),
      );
      await refreshAll();
      state = state.copyWith(busy: false);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, errorMessage: e.message);
      return false;
    } catch (_) {
      state = state.copyWith(busy: false, errorMessage: 'NETWORK_ERROR');
      return false;
    }
  }

  Future<bool> rateCompletedJob({
    required String jobId,
    required int stars,
    String? comment,
  }) async {
    if (state.busy) return false;
    state = state.copyWith(busy: true, clearError: true);
    try {
      await _api.postJson(
        '/jobs/$jobId/rate',
        <String, dynamic>{
          'stars': stars,
          if (comment != null && comment.trim().isNotEmpty)
            'comment': comment.trim(),
        },
        authenticated: true,
      );
      await refreshAll();
      state = state.copyWith(busy: false);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, errorMessage: e.message);
      return false;
    } catch (_) {
      state = state.copyWith(busy: false, errorMessage: 'NETWORK_ERROR');
      return false;
    }
  }
  Future<bool> raiseDispute({
    required String jobId,
    required String reason,
    String? evidenceNote,
  }) async {
    if (state.busy) return false;
    state = state.copyWith(busy: true, clearError: true);
    try {
      await _api.postJson(
        "/jobs/$jobId/dispute",
        <String, dynamic>{
          "reason": reason.trim(),
          if (evidenceNote != null && evidenceNote.trim().isNotEmpty)
            "evidence_note": evidenceNote.trim(),
        },
        authenticated: true,
      );
      await refreshAll();
      state = state.copyWith(busy: false);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, errorMessage: e.message);
      return false;
    } catch (_) {
      state = state.copyWith(busy: false, errorMessage: "NETWORK_ERROR");
      return false;
    }
  }
}
