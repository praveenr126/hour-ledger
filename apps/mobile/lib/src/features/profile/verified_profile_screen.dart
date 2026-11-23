import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../l10n/app_localizations.dart';
import '../../core/theme/app_theme.dart';
import '../auth/auth_controller.dart';
import 'profile_models.dart';

class VerifiedProfileScreen extends ConsumerWidget {
  const VerifiedProfileScreen({super.key, required this.profile});

  final UserProfile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context)!;
    final controller = ref.read(authControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.appTitle),
        actions: <Widget>[
          IconButton(
            key: const Key('logout_button'),
            tooltip: l10n.signOutButton,
            onPressed: () => controller.logout(),
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
                    key: const Key('verified_status_badge'),
                    padding: const EdgeInsets.all(AppTokens.s12),
                    decoration: BoxDecoration(
                      color: AppTokens.heldTint,
                      borderRadius: AppTokens.borderRadius,
                      border: Border.all(color: AppTokens.held, width: 1.0),
                    ),
                    child: Row(
                      children: <Widget>[
                        const Icon(Icons.verified_outlined, color: AppTokens.held, size: 20),
                        const SizedBox(width: AppTokens.s8),
                        Expanded(
                          child: Text(
                            l10n.verifiedStatusLabel,
                            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                  color: AppTokens.held,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppTokens.s16),
                  Text(
                    profile.verifiedName ?? profile.phone,
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: AppTokens.s4),
                  Text(
                    profile.phone,
                    style: AppTokens.monoTabular.copyWith(fontSize: 15),
                  ),
                  const SizedBox(height: AppTokens.s24),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(AppTokens.s16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            l10n.availableBalanceLabel,
                            style: Theme.of(context).textTheme.bodyMedium,
                          ),
                          const SizedBox(height: AppTokens.s8),
                          Text(
                            UserProfile.formatPaise(profile.walletBalancePaise),
                            key: const Key('wallet_balance_text'),
                            style: AppTokens.monoTabular.copyWith(fontSize: 28),
                          ),
                          const SizedBox(height: AppTokens.s16),
                          const Divider(),
                          const SizedBox(height: AppTokens.s12),
                          _LedgerRow(
                            label: l10n.verifiedIdLabel,
                            value: '${(profile.idType ?? '').toUpperCase()} ****${profile.idLast4 ?? ''}',
                          ),
                          const SizedBox(height: AppTokens.s8),
                          _LedgerRow(
                            label: l10n.trustLevelLabel,
                            value: 'Level ${profile.trustLevel}',
                          ),
                          const SizedBox(height: AppTokens.s8),
                          _LedgerRow(
                            label: l10n.responsivenessLabel,
                            value: '${profile.responsivenessScore}%',
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _LedgerRow extends StatelessWidget {
  const _LedgerRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: <Widget>[
        Flexible(
          child: Text(label, style: Theme.of(context).textTheme.bodyMedium),
        ),
        const SizedBox(width: AppTokens.s12),
        Text(value, style: AppTokens.monoTabular.copyWith(fontSize: 14)),
      ],
    );
  }
}
