import '../../core/network/api_client.dart';

class LedgerEntryItem {
  const LedgerEntryItem({
    required this.id,
    required this.txnId,
    required this.amountPaise,
    required this.reason,
    required this.jobId,
    required this.createdAt,
  });

  final String id;
  final String txnId;
  final int amountPaise;
  final String reason;
  final String? jobId;
  final String createdAt;

  factory LedgerEntryItem.fromJson(JsonMap json) {
    return LedgerEntryItem(
      id: json['id'] as String,
      txnId: json['txn_id'] as String,
      amountPaise: (json['amount_paise'] as num).toInt(),
      reason: json['reason'] as String,
      jobId: json['job_id'] as String?,
      createdAt: json['created_at'] as String,
    );
  }
}

class WalletLedgerState {
  const WalletLedgerState({
    required this.balancePaise,
    required this.entries,
  });

  final int balancePaise;
  final List<LedgerEntryItem> entries;

  factory WalletLedgerState.fromJson(JsonMap json) {
    final raw = (json['entries'] as List<dynamic>?) ?? <dynamic>[];
    return WalletLedgerState(
      balancePaise: (json['wallet_balance_paise'] as num?)?.toInt() ?? 0,
      entries: raw
          .map((item) => LedgerEntryItem.fromJson(item as JsonMap))
          .toList(),
    );
  }
}

class JobSummary {
  const JobSummary({
    required this.id,
    required this.posterId,
    required this.posterName,
    required this.posterTrustLevel,
    required this.title,
    required this.description,
    required this.hourlyRatePaise,
    required this.hours,
    required this.totalPaise,
    required this.addressText,
    required this.startAt,
    required this.status,
  });

  final String id;
  final String posterId;
  final String posterName;
  final int posterTrustLevel;
  final String title;
  final String description;
  final int hourlyRatePaise;
  final int hours;
  final int totalPaise;
  final String addressText;
  final String startAt;
  final String status;

  factory JobSummary.fromJson(JsonMap json) {
    return JobSummary(
      id: json['id'] as String,
      posterId: json['poster_id'] as String,
      posterName: (json['poster_name'] as String?) ?? 'Verified poster',
      posterTrustLevel: (json['poster_trust_level'] as num?)?.toInt() ?? 0,
      title: json['title'] as String,
      description: (json['description'] as String?) ?? '',
      hourlyRatePaise: (json['hourly_rate_paise'] as num).toInt(),
      hours: (json['hours'] as num).toInt(),
      totalPaise: (json['total_paise'] as num).toInt(),
      addressText: (json['address_text'] as String?) ?? '',
      startAt: json['start_at'] as String,
      status: json['status'] as String,
    );
  }
}

class JobApplicant {
  const JobApplicant({
    required this.id,
    required this.workerId,
    required this.workerName,
    required this.workerTrustLevel,
    required this.workerResponsivenessScore,
    required this.status,
    required this.respondBy,
  });

  final String id;
  final String workerId;
  final String workerName;
  final int workerTrustLevel;
  final int workerResponsivenessScore;
  final String status;
  final String respondBy;

  factory JobApplicant.fromJson(JsonMap json) {
    return JobApplicant(
      id: json['id'] as String,
      workerId: json['worker_id'] as String,
      workerName: (json['worker_name'] as String?) ?? 'Verified worker',
      workerTrustLevel: (json['worker_trust_level'] as num?)?.toInt() ?? 0,
      workerResponsivenessScore:
          (json['worker_responsiveness_score'] as num?)?.toInt() ?? 100,
      status: json['status'] as String,
      respondBy: json['respond_by'] as String,
    );
  }
}

class MyJobApplication {
  const MyJobApplication({
    required this.id,
    required this.status,
    required this.respondBy,
  });

  final String id;
  final String status;
  final String respondBy;

  factory MyJobApplication.fromJson(JsonMap json) {
    return MyJobApplication(
      id: json['id'] as String,
      status: json['status'] as String,
      respondBy: json['respond_by'] as String,
    );
  }
}

class JobDetail {
  const JobDetail({
    required this.id,
    required this.posterId,
    required this.posterName,
    required this.title,
    required this.description,
    required this.checklist,
    required this.hourlyRatePaise,
    required this.hours,
    required this.totalPaise,
    required this.escrowHeldPaise,
    required this.addressText,
    required this.startAt,
    required this.status,
    required this.isPoster,
    required this.applications,
    required this.myApplication,
  });

  final String id;
  final String posterId;
  final String posterName;
  final String title;
  final String description;
  final List<String> checklist;
  final int hourlyRatePaise;
  final int hours;
  final int totalPaise;
  final int escrowHeldPaise;
  final String addressText;
  final String startAt;
  final String status;
  final bool isPoster;
  final List<JobApplicant> applications;
  final MyJobApplication? myApplication;

  factory JobDetail.fromJson(JsonMap json) {
    final rawChecklist = (json['checklist'] as List<dynamic>?) ?? <dynamic>[];
    final rawApps = (json['applications'] as List<dynamic>?) ?? <dynamic>[];
    final rawMine = json['my_application'] as JsonMap?;

    return JobDetail(
      id: json['id'] as String,
      posterId: json['poster_id'] as String,
      posterName: (json['poster_name'] as String?) ?? 'Verified poster',
      title: json['title'] as String,
      description: (json['description'] as String?) ?? '',
      checklist: rawChecklist.map((e) => e.toString()).toList(),
      hourlyRatePaise: (json['hourly_rate_paise'] as num).toInt(),
      hours: (json['hours'] as num).toInt(),
      totalPaise: (json['total_paise'] as num).toInt(),
      escrowHeldPaise: (json['escrow_held_paise'] as num?)?.toInt() ?? 0,
      addressText: (json['address_text'] as String?) ?? '',
      startAt: json['start_at'] as String,
      status: json['status'] as String,
      isPoster: (json['is_poster'] as bool?) ?? false,
      applications: rawApps
          .map((item) => JobApplicant.fromJson(item as JsonMap))
          .toList(),
      myApplication: rawMine == null ? null : MyJobApplication.fromJson(rawMine),
    );
  }
}

class PostedJobSummary {
  const PostedJobSummary({
    required this.id,
    required this.title,
    required this.hourlyRatePaise,
    required this.hours,
    required this.totalPaise,
    required this.addressText,
    required this.startAt,
    required this.status,
    required this.pendingApplications,
  });

  final String id;
  final String title;
  final int hourlyRatePaise;
  final int hours;
  final int totalPaise;
  final String addressText;
  final String startAt;
  final String status;
  final int pendingApplications;

  factory PostedJobSummary.fromJson(JsonMap json) {
    return PostedJobSummary(
      id: json['id'] as String,
      title: json['title'] as String,
      hourlyRatePaise: (json['hourly_rate_paise'] as num).toInt(),
      hours: (json['hours'] as num).toInt(),
      totalPaise: (json['total_paise'] as num).toInt(),
      addressText: (json['address_text'] as String?) ?? '',
      startAt: json['start_at'] as String,
      status: json['status'] as String,
      pendingApplications:
          (json['pending_applications'] as num?)?.toInt() ?? 0,
    );
  }
}

class AppliedJobSummary {
  const AppliedJobSummary({
    required this.applicationId,
    required this.applicationStatus,
    required this.respondBy,
    required this.jobId,
    required this.title,
    required this.totalPaise,
    required this.addressText,
    required this.jobStatus,
  });

  final String applicationId;
  final String applicationStatus;
  final String respondBy;
  final String jobId;
  final String title;
  final int totalPaise;
  final String addressText;
  final String jobStatus;

  factory AppliedJobSummary.fromJson(JsonMap json) {
    return AppliedJobSummary(
      applicationId: json['application_id'] as String,
      applicationStatus: json['application_status'] as String,
      respondBy: json['respond_by'] as String,
      jobId: json['job_id'] as String,
      title: json['title'] as String,
      totalPaise: (json['total_paise'] as num).toInt(),
      addressText: (json['address_text'] as String?) ?? '',
      jobStatus: json['job_status'] as String,
    );
  }
}

class MyJobsState {
  const MyJobsState({
    required this.posted,
    required this.applied,
  });

  final List<PostedJobSummary> posted;
  final List<AppliedJobSummary> applied;

  factory MyJobsState.fromJson(JsonMap json) {
    final rawPosted = (json['posted'] as List<dynamic>?) ?? <dynamic>[];
    final rawApplied = (json['applied'] as List<dynamic>?) ?? <dynamic>[];
    return MyJobsState(
      posted: rawPosted
          .map((e) => PostedJobSummary.fromJson(e as JsonMap))
          .toList(),
      applied: rawApplied
          .map((e) => AppliedJobSummary.fromJson(e as JsonMap))
          .toList(),
    );
  }
}
