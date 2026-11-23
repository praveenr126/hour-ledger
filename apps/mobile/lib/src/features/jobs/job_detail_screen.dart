import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../l10n/app_localizations.dart';
import '../../core/theme/app_theme.dart';
import '../profile/profile_models.dart';
import 'job_models.dart';
import 'jobs_controller.dart';

class JobDetailScreen extends ConsumerStatefulWidget {
  const JobDetailScreen({super.key, required this.jobId});

  final String jobId;

  @override
  ConsumerState<JobDetailScreen> createState() => _JobDetailScreenState();
}

class _JobDetailScreenState extends ConsumerState<JobDetailScreen> {
  JobDetail? _detail;
  bool _loading = true;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final d = await ref
          .read(jobsControllerProvider.notifier)
          .fetchJobDetail(widget.jobId);
      if (mounted) {
        setState(() {
          _detail = d;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loadError = e.toString();
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final jobsState = ref.watch(jobsControllerProvider);
    final controller = ref.read(jobsControllerProvider.notifier);
    final detail = _detail;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.jobDetailTitle)),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: _loading
                ? const Center(child: CircularProgressIndicator(color: AppTokens.ink))
                : detail == null
                    ? Padding(
                        padding: const EdgeInsets.all(AppTokens.s24),
                        child: Text(_loadError ?? l10n.networkErrorMessage),
                      )
                    : SingleChildScrollView(
                        padding: const EdgeInsets.all(AppTokens.s24),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: <Widget>[
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: <Widget>[
                                Container(
                                  key: const Key('job_status_badge'),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: AppTokens.s12,
                                    vertical: AppTokens.s4,
                                  ),
                                  decoration: BoxDecoration(
                                    color: detail.status == 'DRAFT'
                                        ? AppTokens.cautionTint
                                        : AppTokens.heldTint,
                                    borderRadius: AppTokens.borderRadius,
                                    border: Border.all(
                                      color: detail.status == 'DRAFT'
                                          ? AppTokens.caution
                                          : AppTokens.held,
                                    ),
                                  ),
                                  child: Text(
                                    detail.status,
                                    style: AppTokens.monoTabular.copyWith(
                                      fontSize: 13,
                                      color: detail.status == 'DRAFT'
                                          ? AppTokens.caution
                                          : AppTokens.held,
                                    ),
                                  ),
                                ),
                                Text(
                                  UserProfile.formatPaise(detail.totalPaise),
                                  style: AppTokens.monoTabular.copyWith(fontSize: 22),
                                ),
                              ],
                            ),
                            const SizedBox(height: AppTokens.s16),
                            Text(
                              detail.title,
                              style: Theme.of(context).textTheme.headlineMedium,
                            ),
                            const SizedBox(height: AppTokens.s8),
                            Text(
                              detail.description,
                              style: Theme.of(context).textTheme.bodyLarge,
                            ),
                            const SizedBox(height: AppTokens.s16),
                            Card(
                              child: Padding(
                                padding: const EdgeInsets.all(AppTokens.s16),
                                child: Column(
                                  children: <Widget>[
                                    _DetailRow(
                                      label: l10n.totalPayoutLabel,
                                      value:
                                          '${UserProfile.formatPaise(detail.hourlyRatePaise)}/hr × ${detail.hours}h = ${UserProfile.formatPaise(detail.totalPaise)}',
                                    ),
                                    const SizedBox(height: AppTokens.s8),
                                    _DetailRow(
                                      label: l10n.escrowHeldLabel,
                                      value: UserProfile.formatPaise(detail.escrowHeldPaise),
                                    ),
                                    if (detail.addressText.isNotEmpty) ...<Widget>[
                                      const SizedBox(height: AppTokens.s8),
                                      _DetailRow(
                                        label: l10n.addressLabel,
                                        value: detail.addressText,
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            ),
                            if (detail.checklist.isNotEmpty) ...<Widget>[
                              const SizedBox(height: AppTokens.s16),
                              ...detail.checklist.map(
                                (item) => Padding(
                                  padding: const EdgeInsets.only(bottom: AppTokens.s8),
                                  child: Row(
                                    children: <Widget>[
                                      const Icon(Icons.check_box_outline_blank, size: 18),
                                      const SizedBox(width: AppTokens.s8),
                                      Expanded(child: Text(item)),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                            const SizedBox(height: AppTokens.s24),
                            if (detail.isPoster && detail.status == 'DRAFT') ...<Widget>[
                              FilledButton(
                                key: const Key('fund_escrow_button'),
                                onPressed: jobsState.busy
                                    ? null
                                    : () async {
                                        final ok = await controller.fundJobEscrow(detail.id);
                                        if (ok) await _reload();
                                      },
                                child: Text(l10n.fundEscrowButton),
                              ),
                            ],
                            if (!detail.isPoster) ...<Widget>[
                              if (detail.myApplication != null)
                                Container(
                                  key: const Key('my_application_banner'),
                                  padding: const EdgeInsets.all(AppTokens.s16),
                                  decoration: BoxDecoration(
                                    color: AppTokens.heldTint,
                                    borderRadius: AppTokens.borderRadius,
                                    border: Border.all(color: AppTokens.held),
                                  ),
                                  child: Text(
                                    '${l10n.yourApplicationTitle}: ${detail.myApplication!.status.toUpperCase()}',
                                    style: AppTokens.monoTabular.copyWith(
                                      fontSize: 14,
                                      color: AppTokens.held,
                                    ),
                                  ),
                                )
                              else if (detail.status == 'OPEN')
                                FilledButton(
                                  key: const Key('apply_job_button'),
                                  onPressed: jobsState.busy
                                      ? null
                                      : () async {
                                          final ok = await controller.applyToJob(detail.id);
                                          if (ok) await _reload();
                                        },
                                  child: Text(l10n.applyJobButton),
                                ),
                            ],
                            if (detail.isPoster && detail.status != 'DRAFT') ...<Widget>[
                              Text(
                                l10n.applicantsSectionTitle,
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                              const SizedBox(height: AppTokens.s12),
                              if (detail.applications.isEmpty)
                                Text(l10n.noApplicantsYet)
                              else
                                ...detail.applications.map((appItem) {
                                  return Padding(
                                    padding: const EdgeInsets.only(bottom: AppTokens.s12),
                                    child: Card(
                                      child: Padding(
                                        padding: const EdgeInsets.all(AppTokens.s16),
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: <Widget>[
                                            Row(
                                              mainAxisAlignment:
                                                  MainAxisAlignment.spaceBetween,
                                              children: <Widget>[
                                                Text(
                                                  appItem.workerName,
                                                  style: Theme.of(context)
                                                      .textTheme
                                                      .titleMedium,
                                                ),
                                                Text(
                                                  appItem.status.toUpperCase(),
                                                  style: AppTokens.monoTabular.copyWith(
                                                    fontSize: 13,
                                                    color: AppTokens.held,
                                                  ),
                                                ),
                                              ],
                                            ),
                                            const SizedBox(height: AppTokens.s4),
                                            Text(
                                              'Trust ${appItem.workerTrustLevel} · Responsiveness ${appItem.workerResponsivenessScore}%',
                                              style: AppTokens.monoTabular.copyWith(fontSize: 12),
                                            ),
                                            if (detail.status == 'OPEN' &&
                                                appItem.status == 'pending') ...<Widget>[
                                              const SizedBox(height: AppTokens.s12),
                                              Row(
                                                children: <Widget>[
                                                  Expanded(
                                                    child: FilledButton(
                                                      key: Key('accept_applicant_${appItem.id}'),
                                                      onPressed: jobsState.busy
                                                          ? null
                                                          : () async {
                                                              final ok = await controller
                                                                  .acceptApplicant(
                                                                detail.id,
                                                                appItem.id,
                                                              );
                                                              if (ok) await _reload();
                                                            },
                                                      child: Text(l10n.acceptApplicantButton),
                                                    ),
                                                  ),
                                                  const SizedBox(width: AppTokens.s12),
                                                  OutlinedButton(
                                                    key: Key('reject_applicant_${appItem.id}'),
                                                    onPressed: jobsState.busy
                                                        ? null
                                                        : () async {
                                                            final ok = await controller
                                                                .rejectApplicant(
                                                              detail.id,
                                                              appItem.id,
                                                            );
                                                            if (ok) await _reload();
                                                          },
                                                    child: Text(l10n.rejectApplicantButton),
                                                  ),
                                                ],
                                              ),
                                            ],
                                          ],
                                        ),
                                      ),
                                    ),
                                  );
                                }),
                            ],
                            if (jobsState.errorMessage != null) ...<Widget>[
                              const SizedBox(height: AppTokens.s16),
                              Container(
                                key: const Key('job_detail_error_banner'),
                                padding: const EdgeInsets.all(AppTokens.s12),
                                decoration: BoxDecoration(
                                  color: AppTokens.dangerTint,
                                  borderRadius: AppTokens.borderRadius,
                                  border: Border.all(color: AppTokens.danger),
                                ),
                                child: Text(
                                  jobsState.errorMessage == 'NETWORK_ERROR'
                                      ? l10n.networkErrorMessage
                                      : jobsState.errorMessage!,
                                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                        color: AppTokens.danger,
                                      ),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
          ),
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: <Widget>[
        Flexible(child: Text(label, style: Theme.of(context).textTheme.bodyMedium)),
        const SizedBox(width: AppTokens.s12),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.end,
            style: AppTokens.monoTabular.copyWith(fontSize: 13),
          ),
        ),
      ],
    );
  }
}
