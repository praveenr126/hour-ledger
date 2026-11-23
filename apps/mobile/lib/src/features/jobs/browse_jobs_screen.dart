import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../l10n/app_localizations.dart';
import '../../core/theme/app_theme.dart';
import '../profile/profile_models.dart';
import 'job_detail_screen.dart';
import 'jobs_controller.dart';

class BrowseJobsScreen extends ConsumerWidget {
  const BrowseJobsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context)!;
    final state = ref.watch(jobsControllerProvider);
    final controller = ref.read(jobsControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.browseJobsTitle),
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
            child: state.openJobs.isEmpty
                ? ListView(
                    padding: const EdgeInsets.all(AppTokens.s24),
                    children: <Widget>[
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(AppTokens.s24),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              const Icon(Icons.work_outline, color: AppTokens.ink, size: 24),
                              const SizedBox(height: AppTokens.s12),
                              Text(
                                l10n.noOpenJobsTitle,
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                              const SizedBox(height: AppTokens.s8),
                              Text(
                                l10n.noOpenJobsSubtitle,
                                style: Theme.of(context).textTheme.bodyLarge,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  )
                : ListView.separated(
                    padding: const EdgeInsets.all(AppTokens.s16),
                    itemCount: state.openJobs.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppTokens.s12),
                    itemBuilder: (context, index) {
                      final job = state.openJobs[index];
                      return InkWell(
                        key: Key('open_job_card_${job.id}'),
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
                                  children: <Widget>[
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: AppTokens.s8,
                                        vertical: AppTokens.s4,
                                      ),
                                      decoration: BoxDecoration(
                                        color: AppTokens.heldTint,
                                        borderRadius: AppTokens.borderRadius,
                                        border: Border.all(color: AppTokens.held),
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: <Widget>[
                                          const Icon(Icons.lock_outline, size: 14, color: AppTokens.held),
                                          const SizedBox(width: AppTokens.s4),
                                          Text(
                                            job.status,
                                            style: AppTokens.monoTabular.copyWith(
                                              fontSize: 12,
                                              color: AppTokens.held,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    const Spacer(),
                                    Text(
                                      UserProfile.formatPaise(job.totalPaise),
                                      style: AppTokens.monoTabular.copyWith(fontSize: 18),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: AppTokens.s12),
                                Text(
                                  job.title,
                                  style: Theme.of(context).textTheme.titleLarge,
                                ),
                                const SizedBox(height: AppTokens.s4),
                                Text(
                                  '${UserProfile.formatPaise(job.hourlyRatePaise)}/hr · ${job.hours}h',
                                  style: AppTokens.monoTabular.copyWith(fontSize: 13),
                                ),
                                if (job.addressText.isNotEmpty) ...<Widget>[
                                  const SizedBox(height: AppTokens.s8),
                                  Row(
                                    children: <Widget>[
                                      const Icon(Icons.place_outlined, size: 16, color: AppTokens.ink),
                                      const SizedBox(width: AppTokens.s4),
                                      Expanded(
                                        child: Text(
                                          job.addressText,
                                          style: Theme.of(context).textTheme.bodyMedium,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ),
      ),
    );
  }
}
