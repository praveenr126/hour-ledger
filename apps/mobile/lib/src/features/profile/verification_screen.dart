import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../l10n/app_localizations.dart';
import '../../core/theme/app_theme.dart';
import '../auth/auth_controller.dart';

class VerificationScreen extends ConsumerStatefulWidget {
  const VerificationScreen({super.key});

  @override
  ConsumerState<VerificationScreen> createState() => _VerificationScreenState();
}

class _VerificationScreenState extends ConsumerState<VerificationScreen> {
  final _nameController = TextEditingController();
  final _dobController = TextEditingController();
  final _idNumberController = TextEditingController();

  String _idType = 'pan';
  final String _livenessPrompt = 'blink';
  bool _livenessPassed = false;

  @override
  void dispose() {
    _nameController.dispose();
    _dobController.dispose();
    _idNumberController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = ref.watch(authControllerProvider);
    final controller = ref.read(authControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.verifyIdentityTitle),
        actions: <Widget>[
          IconButton(
            tooltip: l10n.signOutButton,
            onPressed: auth.busy ? null : () => controller.logout(),
            icon: const Icon(Icons.logout_outlined),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppTokens.s24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Container(
                    padding: const EdgeInsets.all(AppTokens.s12),
                    decoration: BoxDecoration(
                      color: AppTokens.cautionTint,
                      borderRadius: AppTokens.borderRadius,
                      border: Border.all(color: AppTokens.caution, width: 1.0),
                    ),
                    child: Row(
                      children: <Widget>[
                        const Icon(Icons.schedule_outlined, color: AppTokens.caution, size: 20),
                        const SizedBox(width: AppTokens.s8),
                        Expanded(
                          child: Text(
                            l10n.unverifiedStatusLabel,
                            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                  color: AppTokens.caution,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppTokens.s16),
                  Text(
                    l10n.verifyIdentitySubtitle,
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
                  const SizedBox(height: AppTokens.s24),
                  TextField(
                    key: const Key('verified_name_input'),
                    controller: _nameController,
                    textCapitalization: TextCapitalization.words,
                    decoration: InputDecoration(labelText: l10n.fullNameLabel),
                  ),
                  const SizedBox(height: AppTokens.s16),
                  TextField(
                    key: const Key('dob_input'),
                    controller: _dobController,
                    keyboardType: TextInputType.datetime,
                    decoration: InputDecoration(
                      labelText: l10n.dobLabel,
                      hintText: l10n.dobHint,
                    ),
                  ),
                  const SizedBox(height: AppTokens.s16),
                  DropdownButtonFormField<String>(
                    key: const Key('id_type_dropdown'),
                    initialValue: _idType,
                    decoration: InputDecoration(labelText: l10n.idTypeLabel),
                    items: <DropdownMenuItem<String>>[
                      DropdownMenuItem<String>(value: 'pan', child: Text(l10n.idTypePan)),
                      DropdownMenuItem<String>(
                        value: 'driving_licence',
                        child: Text(l10n.idTypeDrivingLicence),
                      ),
                      DropdownMenuItem<String>(
                        value: 'college_id',
                        child: Text(l10n.idTypeCollegeId),
                      ),
                    ],
                    onChanged: (val) {
                      if (val != null) setState(() => _idType = val);
                    },
                  ),
                  const SizedBox(height: AppTokens.s16),
                  TextField(
                    key: const Key('id_number_input'),
                    controller: _idNumberController,
                    textCapitalization: TextCapitalization.characters,
                    style: AppTokens.monoTabular.copyWith(fontSize: 16),
                    decoration: InputDecoration(labelText: l10n.idNumberLabel),
                  ),
                  const SizedBox(height: AppTokens.s24),
                  Container(
                    padding: const EdgeInsets.all(AppTokens.s16),
                    decoration: BoxDecoration(
                      color: _livenessPassed ? AppTokens.heldTint : AppTokens.paperInset,
                      borderRadius: AppTokens.borderRadius,
                      border: Border.all(
                        color: _livenessPassed ? AppTokens.held : AppTokens.hairline,
                        width: 1.0,
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        Row(
                          children: <Widget>[
                            Icon(
                              _livenessPassed
                                  ? Icons.verified_user_outlined
                                  : Icons.face_retouching_natural_outlined,
                              color: _livenessPassed ? AppTokens.held : AppTokens.ink,
                              size: 20,
                            ),
                            const SizedBox(width: AppTokens.s8),
                            Expanded(
                              child: Text(
                                l10n.livenessSectionTitle,
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppTokens.s8),
                        Text(
                          _livenessPassed ? l10n.livenessPassedLabel : l10n.livenessPromptBlink,
                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                color: _livenessPassed ? AppTokens.held : AppTokens.ink,
                              ),
                        ),
                        if (!_livenessPassed) ...<Widget>[
                          const SizedBox(height: AppTokens.s12),
                          OutlinedButton(
                            key: const Key('liveness_button'),
                            onPressed: () => setState(() => _livenessPassed = true),
                            child: Text(l10n.runLivenessButton),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: AppTokens.s24),
                  FilledButton(
                    key: const Key('submit_verification_button'),
                    onPressed: auth.busy
                        ? null
                        : () => controller.submitVerification(
                              verifiedName: _nameController.text,
                              dob: _dobController.text,
                              idType: _idType,
                              idNumber: _idNumberController.text,
                              livenessPassed: _livenessPassed,
                              livenessPrompt: _livenessPrompt,
                            ),
                    child: Text(l10n.submitVerificationButton),
                  ),
                  if (auth.errorMessage != null) ...<Widget>[
                    const SizedBox(height: AppTokens.s16),
                    Container(
                      key: const Key('verify_error_banner'),
                      padding: const EdgeInsets.all(AppTokens.s12),
                      decoration: BoxDecoration(
                        color: AppTokens.dangerTint,
                        borderRadius: AppTokens.borderRadius,
                        border: Border.all(color: AppTokens.danger, width: 1.0),
                      ),
                      child: Row(
                        children: <Widget>[
                          const Icon(Icons.error_outline, color: AppTokens.danger, size: 20),
                          const SizedBox(width: AppTokens.s8),
                          Expanded(
                            child: Text(
                              auth.errorMessage == 'NETWORK_ERROR'
                                  ? l10n.networkErrorMessage
                                  : auth.errorMessage!,
                              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                    color: AppTokens.danger,
                                  ),
                            ),
                          ),
                        ],
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
