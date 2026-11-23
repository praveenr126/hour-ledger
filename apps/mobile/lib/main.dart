import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'l10n/app_localizations.dart';
import 'src/core/theme/app_theme.dart';
import 'src/features/auth/auth_controller.dart';
import 'src/features/auth/login_screen.dart';
import 'src/features/profile/verification_screen.dart';
import 'src/features/profile/verified_profile_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: HourLedgerApp()));
}

class HourLedgerApp extends ConsumerWidget {
  const HourLedgerApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);

    return MaterialApp(
      onGenerateTitle: (ctx) => AppLocalizations.of(ctx)!.appTitle,
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: switch (auth.stage) {
        AuthStage.loading => const Scaffold(
            body: Center(child: CircularProgressIndicator(color: AppTokens.ink)),
          ),
        AuthStage.unauthenticated || AuthStage.otpSent => const LoginScreen(),
        AuthStage.authenticated => auth.profile != null && auth.profile!.ageVerified
            ? VerifiedProfileScreen(profile: auth.profile!)
            : const VerificationScreen(),
      },
    );
  }
}
