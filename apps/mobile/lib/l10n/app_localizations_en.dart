// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'HourLedger';

  @override
  String get ledgerSubtitle => 'Time card and escrow ledger';

  @override
  String get signInTitle => 'Sign in with your mobile number';

  @override
  String get signInSubtitle =>
      'Every job is funded into escrow before it opens. Enter your number to receive a 6-digit verification code.';

  @override
  String get phoneLabel => 'Mobile number (E.164 format)';

  @override
  String get phoneHint => '+919876543210';

  @override
  String get sendCodeButton => 'Send verification code';

  @override
  String get devOtpBannerTitle => 'Demo verification code';

  @override
  String get otpCodeLabel => '6-digit code';

  @override
  String get verifySignInButton => 'Verify and sign in';

  @override
  String get changePhoneButton => 'Change mobile number';

  @override
  String get verifyIdentityTitle => 'Complete 18+ verification';

  @override
  String get verifyIdentitySubtitle =>
      'Verify your age and identity once before posting or applying for hourly work. Raw ID numbers and selfie frames are never stored.';

  @override
  String get fullNameLabel => 'Full name (must match payout account)';

  @override
  String get dobLabel => 'Date of birth (YYYY-MM-DD)';

  @override
  String get dobHint => '2001-08-15';

  @override
  String get idTypeLabel => 'Government or college ID';

  @override
  String get idTypePan => 'PAN card';

  @override
  String get idTypeDrivingLicence => 'Driving licence';

  @override
  String get idTypeCollegeId => 'College ID';

  @override
  String get idNumberLabel => 'ID number';

  @override
  String get livenessSectionTitle => 'Live presence check';

  @override
  String get livenessPromptBlink => 'Prompt: Blink both eyes once';

  @override
  String get livenessPromptHeadTurn =>
      'Prompt: Turn your head slowly to the right';

  @override
  String get runLivenessButton => 'Complete liveness check';

  @override
  String get livenessPassedLabel => 'Liveness check passed';

  @override
  String get submitVerificationButton => 'Submit verification';

  @override
  String get profileTitle => 'Time card and ledger profile';

  @override
  String get verifiedStatusLabel => 'Age and ID verified';

  @override
  String get unverifiedStatusLabel => 'Verification required';

  @override
  String get availableBalanceLabel => 'Available wallet balance';

  @override
  String get trustLevelLabel => 'Trust level';

  @override
  String get responsivenessLabel => 'Responsiveness score';

  @override
  String get verifiedIdLabel => 'Verified ID';

  @override
  String get signOutButton => 'Sign out';

  @override
  String get networkErrorMessage =>
      'Could not reach the HourLedger server. Check that the local API is running.';
}
