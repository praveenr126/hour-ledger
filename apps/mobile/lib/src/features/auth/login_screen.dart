import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../l10n/app_localizations.dart';
import '../../core/theme/app_theme.dart';
import 'auth_controller.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _phoneController = TextEditingController(text: '+91');
  final _otpController = TextEditingController();

  @override
  void dispose() {
    _phoneController.dispose();
    _otpController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = ref.watch(authControllerProvider);
    final controller = ref.read(authControllerProvider.notifier);
    final isOtpStep = auth.stage == AuthStage.otpSent;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppTokens.s24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      const Icon(Icons.receipt_long_outlined, color: AppTokens.ink, size: 22),
                      const SizedBox(width: AppTokens.s8),
                      Expanded(
                        child: Text(
                          l10n.ledgerSubtitle,
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppTokens.s12),
                  Text(
                    l10n.signInTitle,
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: AppTokens.s8),
                  Text(
                    l10n.signInSubtitle,
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
                  const SizedBox(height: AppTokens.s24),
                  if (!isOtpStep) ...<Widget>[
                    TextField(
                      key: const Key('phone_input'),
                      controller: _phoneController,
                      keyboardType: TextInputType.phone,
                      decoration: InputDecoration(
                        labelText: l10n.phoneLabel,
                        hintText: l10n.phoneHint,
                      ),
                    ),
                    const SizedBox(height: AppTokens.s16),
                    FilledButton(
                      key: const Key('send_otp_button'),
                      onPressed: auth.busy
                          ? null
                          : () => controller.requestOtp(_phoneController.text),
                      child: Text(l10n.sendCodeButton),
                    ),
                  ] else ...<Widget>[
                    if (auth.devOtp != null) ...<Widget>[
                      Container(
                        key: const Key('dev_otp_banner'),
                        padding: const EdgeInsets.all(AppTokens.s16),
                        decoration: BoxDecoration(
                          color: AppTokens.cautionTint,
                          borderRadius: AppTokens.borderRadius,
                          border: Border.all(color: AppTokens.caution, width: 1.0),
                        ),
                        child: Row(
                          children: <Widget>[
                            const Icon(Icons.key_outlined, color: AppTokens.caution, size: 20),
                            const SizedBox(width: AppTokens.s12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: <Widget>[
                                  Text(
                                    l10n.devOtpBannerTitle,
                                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                          color: AppTokens.caution,
                                          fontWeight: FontWeight.w600,
                                        ),
                                  ),
                                  const SizedBox(height: AppTokens.s4),
                                  Text(
                                    auth.devOtp!,
                                    style: AppTokens.monoTabular.copyWith(fontSize: 22),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: AppTokens.s16),
                    ],
                    TextField(
                      key: const Key('otp_input'),
                      controller: _otpController,
                      keyboardType: TextInputType.number,
                      maxLength: 6,
                      style: AppTokens.monoTabular.copyWith(fontSize: 20),
                      decoration: InputDecoration(
                        labelText: l10n.otpCodeLabel,
                        counterText: '',
                      ),
                    ),
                    const SizedBox(height: AppTokens.s16),
                    FilledButton(
                      key: const Key('verify_otp_button'),
                      onPressed: auth.busy
                          ? null
                          : () => controller.verifyOtp(_otpController.text),
                      child: Text(l10n.verifySignInButton),
                    ),
                    const SizedBox(height: AppTokens.s12),
                    OutlinedButton(
                      onPressed: auth.busy
                          ? null
                          : () {
                              _otpController.clear();
                              controller.resetToPhoneEntry();
                            },
                      child: Text(l10n.changePhoneButton),
                    ),
                  ],
                  if (auth.errorMessage != null) ...<Widget>[
                    const SizedBox(height: AppTokens.s16),
                    Container(
                      key: const Key('auth_error_banner'),
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
