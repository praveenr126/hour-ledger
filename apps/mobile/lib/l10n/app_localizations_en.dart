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

  @override
  String get tabBrowse => 'Browse';

  @override
  String get tabMyJobs => 'My jobs';

  @override
  String get tabPostJob => 'Post job';

  @override
  String get tabWalletProfile => 'Wallet';

  @override
  String get browseJobsTitle => 'Open jobs nearby';

  @override
  String get noOpenJobsTitle => 'No open jobs right now';

  @override
  String get noOpenJobsSubtitle =>
      'Post a funded job or check back shortly for new hourly shifts.';

  @override
  String get postJobTitle => 'Post an hourly job';

  @override
  String get postJobSubtitle =>
      'Save a draft job first, then fund escrow from your wallet to open it for applicants.';

  @override
  String get jobTitleLabel => 'Job title';

  @override
  String get jobTitleHint => 'Store inventory count';

  @override
  String get jobDescriptionLabel => 'Work description';

  @override
  String get jobDescriptionHint =>
      'Describe tasks, dress code, and check-in point';

  @override
  String get hourlyRateLabel => 'Hourly rate (Rs)';

  @override
  String get hoursLabel => 'Duration (hours)';

  @override
  String get addressLabel => 'Work location';

  @override
  String get addressHint => 'MG Road, Mangaluru';

  @override
  String get startsInHoursLabel => 'Starts in (hours from now)';

  @override
  String get checklistItemLabel => 'Checklist task (optional)';

  @override
  String get createDraftButton => 'Save draft job';

  @override
  String get jobDetailTitle => 'Job and escrow details';

  @override
  String get escrowHeldLabel => 'Escrow held';

  @override
  String get totalPayoutLabel => 'Total payout';

  @override
  String get fundEscrowButton => 'Fund escrow and open job';

  @override
  String get applyJobButton => 'Apply for this job';

  @override
  String get applicantsSectionTitle => 'Applicants';

  @override
  String get noApplicantsYet => 'No applicants yet.';

  @override
  String get acceptApplicantButton => 'Accept';

  @override
  String get rejectApplicantButton => 'Reject';

  @override
  String get yourApplicationTitle => 'Your application';

  @override
  String get myJobsTitle => 'Posted and applied jobs';

  @override
  String get postedJobsSection => 'Jobs you posted';

  @override
  String get appliedJobsSection => 'Jobs you applied to';

  @override
  String get noPostedJobs => 'You have not posted any jobs yet.';

  @override
  String get noAppliedJobs => 'You have not applied to any jobs yet.';

  @override
  String get simulateTopupButton => 'Add Rs 1,000 demo funds';

  @override
  String get ledgerHistoryTitle => 'Wallet ledger entries';

  @override
  String get noLedgerEntries => 'No wallet transactions yet.';

  @override
  String get refreshButton => 'Refresh';

  @override
  String get generateCheckinQrButton => 'Show check-in QR code';

  @override
  String get checkinQrCardTitle => 'Signed check-in QR code';

  @override
  String get copyQrPayloadButton => 'Copy QR payload';

  @override
  String get workerCheckinCardTitle => 'On-site QR and GPS check-in';

  @override
  String get qrPayloadLabel => 'Check-in QR payload';

  @override
  String get checkinNowButton => 'Check in and start shift';

  @override
  String get liveTimeCardTitle => 'Active shift time card';

  @override
  String get clockOutButton => 'Clock out and submit time card';

  @override
  String get settlementCardTitle => 'Time card settlement summary';

  @override
  String get payableMinutesLabel => 'Payable minutes';

  @override
  String get workerPayoutLabel => 'Worker payout (95%)';

  @override
  String get platformFeeLabel => 'Platform fee (5%)';

  @override
  String get posterRefundLabel => 'Unused escrow refund';

  @override
  String get approvePayoutButton => 'Approve time card and release payout';

  @override
  String get rateExperienceTitle => 'Rate this completed shift';

  @override
  String get ratingCommentLabel => 'Feedback comment (optional)';

  @override
  String get submitRatingButton => 'Submit rating';

  @override
  String get ratingSubmittedBanner => 'Rating recorded on the ledger';
}
