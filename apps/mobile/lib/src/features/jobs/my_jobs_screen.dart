import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../l10n/app_localizations.dart';
import '../../core/theme/app_theme.dart';
import '../profile/profile_models.dart';
import 'job_detail_screen.dart';
import 'jobs_controller.dart';

class MyJobsScreen extends ConsumerWidget {
  const MyJobsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context)!;
    final state = ref.watch(jobsControllerProvider);
    final controller = ref.read(jobsControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.myJobsTitle),
        actions: <Widget>[
          IconButton(
            tooltip: l10n.refreshButton,
            onPressed: () => controller.refreshAll(),
            icon: const Icon(Icons.refresh_outlined),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: ListView(
              padding: const EdgeInsets.all(AppTokens.s16),
              children: <Widget>[
                Text(
                  l10n.postedJobsSection,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: AppTokens.s12),
                if (state.myJobs.posted.isEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(AppTokens.s16),
                      child: Text(l10n.noPostedJobs),
                    ),
                  )
                else
                  ...state.myJobs.posted.map((job) {
                    return Padding(
                      padding: const EdgeInsets.only(bottom: AppTokens.s12),
                      child: InkWell(
                        key: Key('posted_job_${job.id}'),
                        borderRadius: AppTokens.borderRadius,
                        onTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => JobDetailScreen(jobId: job.id),
                            ),
                          );
                        },
                        child: Card(
                          child: Padding(
                            padding: const EdgeInsets.all(AppTokens.s16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: <Widget>[
                                    Text(
                                      job.status,
                                      style: AppTokens.monoTabular.copyWith(
                                        fontSize: 13,
                                        color: job.status == 'DRAFT'
                                            ? AppTokens.caution
                                            : AppTokens.held,
                                      ),
                                    ),
                                    Text(
                                      UserProfile.formatPaise(job.totalPaise),
                                      style: AppTokens.monoTabular.copyWith(fontSize: 16),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: AppTokens.s8),
                                Text(job.title, style: Theme.of(context).textTheme.titleMedium),
                                const SizedBox(height: AppTokens.s4),
                                Text(
                                  '${l10n.applicantsSectionTitle}: ${job.pendingApplications}',
                                  style: Theme.of(context).textTheme.bodyMedium,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    );
                  }),
                const SizedBox(height: AppTokens.s24),
                Text(
                  l10n.appliedJobsSection,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: AppTokens.s12),
                if (state.myJobs.applied.isEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(AppTokens.s16),
                      child: Text(l10n.noAppliedJobs),
                    ),
                  )
                else
                  ...state.myJobs.applied.map((item) {
                    return Padding(
                      padding: const EdgeInsets.only(bottom: AppTokens.s12),
                      child: InkWell(
                        key: Key('applied_job_${item.jobId}'),
                        borderRadius: AppTokens.borderRadius,
                        onTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => JobDetailScreen(jobId: item.jobId),
                            ),
                          );
                        },
                        child: Card(
                          child: Padding(
                            padding: const EdgeInsets.all(AppTokens.s16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: <Widget>[
                                    Text(
                                      item.applicationStatus.toUpperCase(),
                                      style: AppTokens.monoTabular.copyWith(
                                        fontSize: 13,
                                        color: AppTokens.held,
                                      ),
                                    ),
                                    Text(
                                      UserProfile.formatPaise(item.totalPaise),
                                      style: AppTokens.monoTabular.copyWith(fontSize: 16),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: AppTokens.s8),
                                Text(item.title, style: Theme.of(context).textTheme.titleMedium),
                              ],
                            ),
                          ),
                        ),
                      ),
                    );
                  }),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
