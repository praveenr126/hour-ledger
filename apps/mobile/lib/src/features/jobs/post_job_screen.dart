import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../l10n/app_localizations.dart';
import '../../core/theme/app_theme.dart';
import 'job_detail_screen.dart';
import 'jobs_controller.dart';

class PostJobScreen extends ConsumerStatefulWidget {
  const PostJobScreen({super.key});

  @override
  ConsumerState<PostJobScreen> createState() => _PostJobScreenState();
}

class _PostJobScreenState extends ConsumerState<PostJobScreen> {
  final _titleController = TextEditingController();
  final _descController = TextEditingController();
  final _rateController = TextEditingController(text: '250');
  final _hoursController = TextEditingController(text: '2');
  final _addressController = TextEditingController(text: 'MG Road, Mangaluru');
  final _startsInController = TextEditingController(text: '3');
  final _checklistController = TextEditingController();

  @override
  void dispose() {
    _titleController.dispose();
    _descController.dispose();
    _rateController.dispose();
    _hoursController.dispose();
    _addressController.dispose();
    _startsInController.dispose();
    _checklistController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final rupees = int.tryParse(_rateController.text.trim()) ?? 0;
    final hours = int.tryParse(_hoursController.text.trim()) ?? 0;
    final startsIn = int.tryParse(_startsInController.text.trim()) ?? 2;

    final jobId = await ref.read(jobsControllerProvider.notifier).createDraftJob(
          title: _titleController.text,
          description: _descController.text,
          hourlyRatePaise: rupees * 100,
          hours: hours,
          addressText: _addressController.text,
          startsInHours: startsIn < 1 ? 1 : startsIn,
          checklistTask: _checklistController.text,
        );

    if (jobId != null && mounted) {
      _titleController.clear();
      _descController.clear();
      _checklistController.clear();
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => JobDetailScreen(jobId: jobId),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final state = ref.watch(jobsControllerProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.postJobTitle)),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppTokens.s24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Text(
                    l10n.postJobSubtitle,
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
                  const SizedBox(height: AppTokens.s24),
                  TextField(
                    key: const Key('job_title_input'),
                    controller: _titleController,
                    decoration: InputDecoration(
                      labelText: l10n.jobTitleLabel,
                      hintText: l10n.jobTitleHint,
                    ),
                  ),
                  const SizedBox(height: AppTokens.s16),
                  TextField(
                    key: const Key('job_desc_input'),
                    controller: _descController,
                    maxLines: 2,
                    decoration: InputDecoration(
                      labelText: l10n.jobDescriptionLabel,
                      hintText: l10n.jobDescriptionHint,
                    ),
                  ),
                  const SizedBox(height: AppTokens.s16),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: TextField(
                          key: const Key('job_rate_input'),
                          controller: _rateController,
                          keyboardType: TextInputType.number,
                          style: AppTokens.monoTabular.copyWith(fontSize: 16),
                          decoration: InputDecoration(labelText: l10n.hourlyRateLabel),
                        ),
                      ),
                      const SizedBox(width: AppTokens.s12),
                      Expanded(
                        child: TextField(
                          key: const Key('job_hours_input'),
                          controller: _hoursController,
                          keyboardType: TextInputType.number,
                          style: AppTokens.monoTabular.copyWith(fontSize: 16),
                          decoration: InputDecoration(labelText: l10n.hoursLabel),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppTokens.s16),
                  TextField(
                    key: const Key('job_address_input'),
                    controller: _addressController,
                    decoration: InputDecoration(
                      labelText: l10n.addressLabel,
                      hintText: l10n.addressHint,
                    ),
                  ),
                  const SizedBox(height: AppTokens.s16),
                  TextField(
                    key: const Key('job_starts_in_input'),
                    controller: _startsInController,
                    keyboardType: TextInputType.number,
                    style: AppTokens.monoTabular.copyWith(fontSize: 16),
                    decoration: InputDecoration(labelText: l10n.startsInHoursLabel),
                  ),
                  const SizedBox(height: AppTokens.s16),
                  TextField(
                    key: const Key('job_checklist_input'),
                    controller: _checklistController,
                    decoration: InputDecoration(labelText: l10n.checklistItemLabel),
                  ),
                  const SizedBox(height: AppTokens.s24),
                  FilledButton(
                    key: const Key('create_draft_job_button'),
                    onPressed: state.busy ? null : _submit,
                    child: Text(l10n.createDraftButton),
                  ),
                  if (state.errorMessage != null) ...<Widget>[
                    const SizedBox(height: AppTokens.s16),
                    Container(
                      padding: const EdgeInsets.all(AppTokens.s12),
                      decoration: BoxDecoration(
                        color: AppTokens.dangerTint,
                        borderRadius: AppTokens.borderRadius,
                        border: Border.all(color: AppTokens.danger),
                      ),
                      child: Text(
                        state.errorMessage == 'NETWORK_ERROR'
                            ? l10n.networkErrorMessage
                            : state.errorMessage!,
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
