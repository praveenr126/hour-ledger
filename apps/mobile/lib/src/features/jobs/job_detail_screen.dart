import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
  String? _generatedQrPayload;
  int _selectedStars = 5;
  bool _showDisputeForm = false;

  final _qrInputController = TextEditingController();
  final _ratingCommentController = TextEditingController();
  final _disputeReasonController = TextEditingController();
  final _disputeEvidenceController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _qrInputController.dispose();
    _ratingCommentController.dispose();
    _disputeReasonController.dispose();
    _disputeEvidenceController.dispose();
    super.dispose();
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
    final isDangerStatus = detail?.status == 'DISPUTED';
    final isCautionStatus = detail?.status == 'DRAFT';

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.jobDetailTitle),
        actions: <Widget>[
          IconButton(
            tooltip: l10n.refreshButton,
            onPressed: _reload,
            icon: const Icon(Icons.refresh_outlined),
          ),
        ],
      ),
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
                            Wrap(
                              alignment: WrapAlignment.spaceBetween,
                              crossAxisAlignment: WrapCrossAlignment.center,
                              spacing: AppTokens.s12,
                              runSpacing: AppTokens.s8,
                              children: <Widget>[
                                Container(
                                  key: const Key('job_status_badge'),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: AppTokens.s12,
                                    vertical: AppTokens.s4,
                                  ),
                                  decoration: BoxDecoration(
                                    color: isDangerStatus
                                        ? AppTokens.dangerTint
                                        : isCautionStatus
                                            ? AppTokens.cautionTint
                                            : AppTokens.heldTint,
                                    borderRadius: AppTokens.borderRadius,
                                    border: Border.all(
                                      color: isDangerStatus
                                          ? AppTokens.danger
                                          : isCautionStatus
                                              ? AppTokens.caution
                                              : AppTokens.held,
                                    ),
                                  ),
                                  child: Text(
                                    detail.status,
                                    style: AppTokens.monoTabular.copyWith(
                                      fontSize: 13,
                                      color: isDangerStatus
                                          ? AppTokens.danger
                                          : isCautionStatus
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
                            Text(detail.title, style: Theme.of(context).textTheme.headlineMedium),
                            const SizedBox(height: AppTokens.s8),
                            Text(detail.description, style: Theme.of(context).textTheme.bodyLarge),
                            const SizedBox(height: AppTokens.s16),
                            Card(
                              child: Padding(
                                padding: const EdgeInsets.all(AppTokens.s16),
                                child: Column(
                                  children: <Widget>[
                                    _DetailRow(
                                      label: l10n.totalPayoutLabel,
                                      value:
                                          '${UserProfile.formatPaise(detail.hourlyRatePaise)}/hr × ${detail.hours}h =${UserProfile.formatPaise(detail.totalPaise)}',
                                    ),
                                    const SizedBox(height: AppTokens.s8),
                                    _DetailRow(
                                      label: l10n.escrowHeldLabel,
                                      value: UserProfile.formatPaise(detail.escrowHeldPaise),
                                    ),
                                    if (detail.addressText.isNotEmpty) ...<Widget>[
                                      const SizedBox(height: AppTokens.s8),
                                      _DetailRow(label: l10n.addressLabel, value: detail.addressText),
                                    ],
                                  ],
                                ),
                              ),
                            ),
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
                            if (!detail.isPoster && detail.status == 'OPEN') ...<Widget>[
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
                                    '${l10n.yourApplicationTitle}:${detail.myApplication!.status.toUpperCase()}',
                                    style: AppTokens.monoTabular.copyWith(fontSize: 14, color: AppTokens.held),
                                  ),
                                )
                              else
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
                            if (detail.status == 'FILLED') ...<Widget>[
                              if (detail.isPoster) ...<Widget>[
                                OutlinedButton.icon(
                                  key: const Key('generate_qr_button'),
                                  onPressed: jobsState.busy
                                      ? null
                                      : () async {
                                          final qr = await controller.fetchCheckinQr(detail.id);
                                          if (qr != null && mounted) {
                                            setState(() => _generatedQrPayload = qr);
                                          }
                                        },
                                  icon: const Icon(Icons.qr_code_2_outlined, size: 20),
                                  label: Text(l10n.generateCheckinQrButton),
                                ),
                                if (_generatedQrPayload != null) ...<Widget>[
                                  const SizedBox(height: AppTokens.s12),
                                  Card(
                                    key: const Key('generated_qr_card'),
                                    child: Padding(
                                      padding: const EdgeInsets.all(AppTokens.s16),
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.stretch,
                                        children: <Widget>[
                                          Text(l10n.checkinQrCardTitle, style: Theme.of(context).textTheme.titleMedium),
                                          const SizedBox(height: AppTokens.s8),
                                          SelectableText(_generatedQrPayload!, style: AppTokens.monoTabular.copyWith(fontSize: 12)),
                                          const SizedBox(height: AppTokens.s12),
                                          OutlinedButton.icon(
                                            key: const Key('copy_qr_button'),
                                            onPressed: () => Clipboard.setData(ClipboardData(text: _generatedQrPayload!)),
                                            icon: const Icon(Icons.copy_outlined, size: 18),
                                            label: Text(l10n.copyQrPayloadButton),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                ],
                              ] else if (detail.myApplication?.status == 'accepted') ...<Widget>[
                                Card(
                                  key: const Key('worker_checkin_card'),
                                  child: Padding(
                                    padding: const EdgeInsets.all(AppTokens.s16),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.stretch,
                                      children: <Widget>[
                                        Text(l10n.workerCheckinCardTitle, style: Theme.of(context).textTheme.titleMedium),
                                        const SizedBox(height: AppTokens.s12),
                                        TextField(
                                          key: const Key('qr_payload_input'),
                                          controller: _qrInputController,
                                          style: AppTokens.monoTabular.copyWith(fontSize: 13),
                                          decoration: InputDecoration(labelText: l10n.qrPayloadLabel),
                                        ),
                                        const SizedBox(height: AppTokens.s16),
                                        FilledButton(
                                          key: const Key('checkin_now_button'),
                                          onPressed: jobsState.busy
                                              ? null
                                              : () async {
                                                  final ok = await controller.checkInToJob(
                                                    jobId: detail.id,
                                                    qrPayload: _qrInputController.text,
                                                    lat: detail.lat,
                                                    lng: detail.lng,
                                                  );
                                                  if (ok) await _reload();
                                                },
                                          child: Text(l10n.checkinNowButton),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                            ],
                            if (detail.status == 'IN_PROGRESS') ...<Widget>[
                              Card(
                                key: const Key('live_time_card'),
                                child: Padding(
                                  padding: const EdgeInsets.all(AppTokens.s16),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.stretch,
                                    children: <Widget>[
                                      Text(l10n.liveTimeCardTitle, style: Theme.of(context).textTheme.titleLarge),
                                      if (detail.shift?.checkedInAt != null) ...<Widget>[
                                        const SizedBox(height: AppTokens.s8),
                                        Text('Checked in: ${detail.shift!.checkedInAt}', style: AppTokens.monoTabular.copyWith(fontSize: 12)),
                                      ],
                                      if (detail.checklist.isNotEmpty) ...<Widget>[
                                        const SizedBox(height: AppTokens.s12),
                                        ...detail.checklist.map((item) {
                                          final done = detail.shift?.completedChecklist.contains(item) ?? false;
                                          return InkWell(
                                            key: Key('checklist_item_$item'),
                                            onTap: detail.isPoster || jobsState.busy
                                                ? null
                                                : () async {
                                                    final next = List<String>.from(detail.shift?.completedChecklist ?? <String>[]);
                                                    done ? next.remove(item) : next.add(item);
                                                    final ok = await controller.updateChecklist(detail.id, next);
                                                    if (ok) await _reload();
                                                  },
                                            child: Padding(
                                              padding: const EdgeInsets.symmetric(vertical: AppTokens.s8),
                                              child: Row(
                                                children: <Widget>[
                                                  Icon(done ? Icons.check_box_outlined : Icons.check_box_outline_blank,
                                                      color: done ? AppTokens.held : AppTokens.ink, size: 20),
                                                  const SizedBox(width: AppTokens.s8),
                                                  Expanded(child: Text(item)),
                                                ],
                                              ),
                                            ),
                                          );
                                        }),
                                      ],
                                      if (!detail.isPoster) ...<Widget>[
                                        const SizedBox(height: AppTokens.s16),
                                        FilledButton(
                                          key: const Key('clock_out_button'),
                                          onPressed: jobsState.busy
                                              ? null
                                              : () async {
                                                  final ok = await controller.checkOutFromJob(detail.id);
                                                  if (ok) await _reload();
                                                },
                                          child: Text(l10n.clockOutButton),
                                        ),
                                      ],
                                    ],
                                  ),
                                ),
                              ),
                            ],
                            if ((detail.status == 'AWAITING_APPROVAL' || detail.status == 'COMPLETED') &&
                                detail.shift != null &&
                                detail.shift!.payableMinutes != null) ...<Widget>[
                              Card(
                                key: const Key('settlement_summary_card'),
                                child: Padding(
                                  padding: const EdgeInsets.all(AppTokens.s16),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.stretch,
                                    children: <Widget>[
                                      Text(l10n.settlementCardTitle, style: Theme.of(context).textTheme.titleLarge),
                                      const SizedBox(height: AppTokens.s12),
                                      _DetailRow(label: l10n.payableMinutesLabel, value: '${detail.shift!.payableMinutes ?? 0} min'),
                                      const SizedBox(height: AppTokens.s8),
                                      _DetailRow(label: l10n.workerPayoutLabel, value: UserProfile.formatPaise(detail.shift!.workerPayoutPaise ?? 0)),
                                      const SizedBox(height: AppTokens.s8),
                                      _DetailRow(label: l10n.platformFeeLabel, value: UserProfile.formatPaise(detail.shift!.platformFeePaise ?? 0)),
                                      const SizedBox(height: AppTokens.s8),
                                      _DetailRow(label: l10n.posterRefundLabel, value: UserProfile.formatPaise(detail.shift!.posterRefundPaise ?? 0)),
                                      if (detail.isPoster && detail.status == 'AWAITING_APPROVAL') ...<Widget>[
                                        const SizedBox(height: AppTokens.s16),
                                        FilledButton(
                                          key: const Key('approve_payout_button'),
                                          onPressed: jobsState.busy
                                              ? null
                                              : () async {
                                                  final ok = await controller.approveShiftPayout(detail.id);
                                                  if (ok) await _reload();
                                                },
                                          child: Text(l10n.approvePayoutButton),
                                        ),
                                      ],
                                    ],
                                  ),
                                ),
                              ),
                            ],
                            if (detail.dispute != null) ...<Widget>[
                              const SizedBox(height: AppTokens.s16),
                              Container(
                                key: const Key('dispute_status_card'),
                                padding: const EdgeInsets.all(AppTokens.s16),
                                decoration: BoxDecoration(
                                  color: detail.dispute!.status == 'open' ? AppTokens.dangerTint : AppTokens.heldTint,
                                  borderRadius: AppTokens.borderRadius,
                                  border: Border.all(color: detail.dispute!.status == 'open' ? AppTokens.danger : AppTokens.held),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: <Widget>[
                                    Text(
                                      detail.dispute!.status == 'open'
                                          ? l10n.disputeFrozenBanner
                                          : '${l10n.disputeCardTitle}: ${detail.dispute!.status.toUpperCase()}',
                                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                            color: detail.dispute!.status == 'open' ? AppTokens.danger : AppTokens.held,
                                          ),
                                    ),
                                    const SizedBox(height: AppTokens.s8),
                                    Text(detail.dispute!.reason),
                                    if (detail.dispute!.resolutionNote != null) ...<Widget>[
                                      const SizedBox(height: AppTokens.s8),
                                      Text(detail.dispute!.resolutionNote!),
                                    ],
                                  ],
                                ),
                              ),
                            ],
                            if (detail.status == 'IN_PROGRESS' || detail.status == 'AWAITING_APPROVAL') ...<Widget>[
                              const SizedBox(height: AppTokens.s16),
                              if (!_showDisputeForm)
                                OutlinedButton.icon(
                                  key: const Key('open_dispute_form_button'),
                                  onPressed: () => setState(() => _showDisputeForm = true),
                                  icon: const Icon(Icons.gavel_outlined, size: 18),
                                  label: Text(l10n.raiseDisputeButton),
                                )
                              else
                                Card(
                                  key: const Key('dispute_form_card'),
                                  child: Padding(
                                    padding: const EdgeInsets.all(AppTokens.s16),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.stretch,
                                      children: <Widget>[
                                        Text(l10n.disputeCardTitle, style: Theme.of(context).textTheme.titleMedium),
                                        const SizedBox(height: AppTokens.s12),
                                        TextField(
                                          key: const Key('dispute_reason_input'),
                                          controller: _disputeReasonController,
                                          decoration: InputDecoration(labelText: l10n.disputeReasonLabel),
                                        ),
                                        const SizedBox(height: AppTokens.s12),
                                        TextField(
                                          key: const Key('dispute_evidence_input'),
                                          controller: _disputeEvidenceController,
                                          decoration: InputDecoration(labelText: l10n.disputeEvidenceLabel),
                                        ),
                                        const SizedBox(height: AppTokens.s16),
                                        FilledButton(
                                          key: const Key('submit_dispute_button'),
                                          onPressed: jobsState.busy
                                              ? null
                                              : () async {
                                                  final ok = await controller.raiseDispute(
                                                    jobId: detail.id,
                                                    reason: _disputeReasonController.text,
                                                    evidenceNote: _disputeEvidenceController.text,
                                                  );
                                                  if (ok && mounted) {
                                                    setState(() => _showDisputeForm = false);
                                                    await _reload();
                                                  }
                                                },
                                          child: Text(l10n.submitDisputeButton),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                            ],
                            if (detail.status == 'COMPLETED') ...<Widget>[
                              const SizedBox(height: AppTokens.s16),
                              if (detail.hasRated)
                                Container(
                                  key: const Key('rating_submitted_banner'),
                                  padding: const EdgeInsets.all(AppTokens.s16),
                                  decoration: BoxDecoration(
                                    color: AppTokens.heldTint,
                                    borderRadius: AppTokens.borderRadius,
                                    border: Border.all(color: AppTokens.held),
                                  ),
                                  child: Text(
                                    l10n.ratingSubmittedBanner,
                                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppTokens.held, fontWeight: FontWeight.w600),
                                  ),
                                )
                              else
                                Card(
                                  key: const Key('rating_form_card'),
                                  child: Padding(
                                    padding: const EdgeInsets.all(AppTokens.s16),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.stretch,
                                      children: <Widget>[
                                        Text(l10n.rateExperienceTitle, style: Theme.of(context).textTheme.titleMedium),
                                        const SizedBox(height: AppTokens.s12),
                                        Wrap(
                                          spacing: AppTokens.s8,
                                          children: <Widget>[
                                            for (var s = 1; s <= 5; s++)
                                              OutlinedButton(
                                                key: Key('star_button_$s'),
                                                onPressed: () => setState(() => _selectedStars = s),
                                                style: OutlinedButton.styleFrom(
                                                  backgroundColor: _selectedStars == s ? AppTokens.paperInset : AppTokens.paper,
                                                  side: BorderSide(color: _selectedStars == s ? AppTokens.action : AppTokens.hairline),
                                                ),
                                                child: Text('$s ★'),
                                              ),
                                          ],
                                        ),
                                        const SizedBox(height: AppTokens.s12),
                                        TextField(
                                          key: const Key('rating_comment_input'),
                                          controller: _ratingCommentController,
                                          decoration: InputDecoration(labelText: l10n.ratingCommentLabel),
                                        ),
                                        const SizedBox(height: AppTokens.s16),
                                        FilledButton(
                                          key: const Key('submit_rating_button'),
                                          onPressed: jobsState.busy
                                              ? null
                                              : () async {
                                                  final ok = await controller.rateCompletedJob(
                                                    jobId: detail.id,
                                                    stars: _selectedStars,
                                                    comment: _ratingCommentController.text,
                                                  );
                                                  if (ok) await _reload();
                                                },
                                          child: Text(l10n.submitRatingButton),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                            ],
                            if (detail.isPoster && detail.status != 'DRAFT') ...<Widget>[
                              const SizedBox(height: AppTokens.s24),
                              Text(l10n.applicantsSectionTitle, style: Theme.of(context).textTheme.titleLarge),
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
                                            Wrap(
                                              alignment: WrapAlignment.spaceBetween,
                                              crossAxisAlignment: WrapCrossAlignment.center,
                                              spacing: AppTokens.s12,
                                              runSpacing: AppTokens.s4,
                                              children: <Widget>[
                                                Text(appItem.workerName, style: Theme.of(context).textTheme.titleMedium),
                                                Text(appItem.status.toUpperCase(), style: AppTokens.monoTabular.copyWith(fontSize: 13, color: AppTokens.held)),
                                              ],
                                            ),
                                            const SizedBox(height: AppTokens.s4),
                                            Text('Trust ${appItem.workerTrustLevel} · Responsiveness ${appItem.workerResponsivenessScore}%', style: AppTokens.monoTabular.copyWith(fontSize: 12)),
                                            if (detail.status == 'OPEN' && appItem.status == 'pending') ...<Widget>[
                                              const SizedBox(height: AppTokens.s12),
                                              Row(
                                                children: <Widget>[
                                                  Expanded(
                                                    child: FilledButton(
                                                      key: Key('accept_applicant_${appItem.id}'),
                                                      onPressed: jobsState.busy
                                                          ? null
                                                          : () async {
                                                              final ok = await controller.acceptApplicant(detail.id, appItem.id);
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
                                                            final ok = await controller.rejectApplicant(detail.id, appItem.id);
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
                                  jobsState.errorMessage == 'NETWORK_ERROR' ? l10n.networkErrorMessage : jobsState.errorMessage!,
                                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppTokens.danger),
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
        Flexible(child: Text(value, textAlign: TextAlign.end, style: AppTokens.monoTabular.copyWith(fontSize: 13))),
      ],
    );
  }
}
