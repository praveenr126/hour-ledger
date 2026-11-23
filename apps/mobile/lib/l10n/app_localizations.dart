import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_kn.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
      : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations? of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations);
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('kn')
  ];

  /// No description provided for @appTitle.
  ///
  /// In en, this message translates to:
  /// **'HourLedger'**
  String get appTitle;

  /// No description provided for @ledgerSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Time card and escrow ledger'**
  String get ledgerSubtitle;

  /// No description provided for @signInTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in with your mobile number'**
  String get signInTitle;

  /// No description provided for @signInSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Every job is funded into escrow before it opens. Enter your number to receive a 6-digit verification code.'**
  String get signInSubtitle;

  /// No description provided for @phoneLabel.
  ///
  /// In en, this message translates to:
  /// **'Mobile number (E.164 format)'**
  String get phoneLabel;

  /// No description provided for @phoneHint.
  ///
  /// In en, this message translates to:
  /// **'+919876543210'**
  String get phoneHint;

  /// No description provided for @sendCodeButton.
  ///
  /// In en, this message translates to:
  /// **'Send verification code'**
  String get sendCodeButton;

  /// No description provided for @devOtpBannerTitle.
  ///
  /// In en, this message translates to:
  /// **'Demo verification code'**
  String get devOtpBannerTitle;

  /// No description provided for @otpCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'6-digit code'**
  String get otpCodeLabel;

  /// No description provided for @verifySignInButton.
  ///
  /// In en, this message translates to:
  /// **'Verify and sign in'**
  String get verifySignInButton;

  /// No description provided for @changePhoneButton.
  ///
  /// In en, this message translates to:
  /// **'Change mobile number'**
  String get changePhoneButton;

  /// No description provided for @verifyIdentityTitle.
  ///
  /// In en, this message translates to:
  /// **'Complete 18+ verification'**
  String get verifyIdentityTitle;

  /// No description provided for @verifyIdentitySubtitle.
  ///
  /// In en, this message translates to:
  /// **'Verify your age and identity once before posting or applying for hourly work. Raw ID numbers and selfie frames are never stored.'**
  String get verifyIdentitySubtitle;

  /// No description provided for @fullNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Full name (must match payout account)'**
  String get fullNameLabel;

  /// No description provided for @dobLabel.
  ///
  /// In en, this message translates to:
  /// **'Date of birth (YYYY-MM-DD)'**
  String get dobLabel;

  /// No description provided for @dobHint.
  ///
  /// In en, this message translates to:
  /// **'2001-08-15'**
  String get dobHint;

  /// No description provided for @idTypeLabel.
  ///
  /// In en, this message translates to:
  /// **'Government or college ID'**
  String get idTypeLabel;

  /// No description provided for @idTypePan.
  ///
  /// In en, this message translates to:
  /// **'PAN card'**
  String get idTypePan;

  /// No description provided for @idTypeDrivingLicence.
  ///
  /// In en, this message translates to:
  /// **'Driving licence'**
  String get idTypeDrivingLicence;

  /// No description provided for @idTypeCollegeId.
  ///
  /// In en, this message translates to:
  /// **'College ID'**
  String get idTypeCollegeId;

  /// No description provided for @idNumberLabel.
  ///
  /// In en, this message translates to:
  /// **'ID number'**
  String get idNumberLabel;

  /// No description provided for @livenessSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Live presence check'**
  String get livenessSectionTitle;

  /// No description provided for @livenessPromptBlink.
  ///
  /// In en, this message translates to:
  /// **'Prompt: Blink both eyes once'**
  String get livenessPromptBlink;

  /// No description provided for @livenessPromptHeadTurn.
  ///
  /// In en, this message translates to:
  /// **'Prompt: Turn your head slowly to the right'**
  String get livenessPromptHeadTurn;

  /// No description provided for @runLivenessButton.
  ///
  /// In en, this message translates to:
  /// **'Complete liveness check'**
  String get runLivenessButton;

  /// No description provided for @livenessPassedLabel.
  ///
  /// In en, this message translates to:
  /// **'Liveness check passed'**
  String get livenessPassedLabel;

  /// No description provided for @submitVerificationButton.
  ///
  /// In en, this message translates to:
  /// **'Submit verification'**
  String get submitVerificationButton;

  /// No description provided for @profileTitle.
  ///
  /// In en, this message translates to:
  /// **'Time card and ledger profile'**
  String get profileTitle;

  /// No description provided for @verifiedStatusLabel.
  ///
  /// In en, this message translates to:
  /// **'Age and ID verified'**
  String get verifiedStatusLabel;

  /// No description provided for @unverifiedStatusLabel.
  ///
  /// In en, this message translates to:
  /// **'Verification required'**
  String get unverifiedStatusLabel;

  /// No description provided for @availableBalanceLabel.
  ///
  /// In en, this message translates to:
  /// **'Available wallet balance'**
  String get availableBalanceLabel;

  /// No description provided for @trustLevelLabel.
  ///
  /// In en, this message translates to:
  /// **'Trust level'**
  String get trustLevelLabel;

  /// No description provided for @responsivenessLabel.
  ///
  /// In en, this message translates to:
  /// **'Responsiveness score'**
  String get responsivenessLabel;

  /// No description provided for @verifiedIdLabel.
  ///
  /// In en, this message translates to:
  /// **'Verified ID'**
  String get verifiedIdLabel;

  /// No description provided for @signOutButton.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get signOutButton;

  /// No description provided for @networkErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'Could not reach the HourLedger server. Check that the local API is running.'**
  String get networkErrorMessage;

  /// No description provided for @tabBrowse.
  ///
  /// In en, this message translates to:
  /// **'Browse'**
  String get tabBrowse;

  /// No description provided for @tabMyJobs.
  ///
  /// In en, this message translates to:
  /// **'My jobs'**
  String get tabMyJobs;

  /// No description provided for @tabPostJob.
  ///
  /// In en, this message translates to:
  /// **'Post job'**
  String get tabPostJob;

  /// No description provided for @tabWalletProfile.
  ///
  /// In en, this message translates to:
  /// **'Wallet'**
  String get tabWalletProfile;

  /// No description provided for @browseJobsTitle.
  ///
  /// In en, this message translates to:
  /// **'Open jobs nearby'**
  String get browseJobsTitle;

  /// No description provided for @noOpenJobsTitle.
  ///
  /// In en, this message translates to:
  /// **'No open jobs right now'**
  String get noOpenJobsTitle;

  /// No description provided for @noOpenJobsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Post a funded job or check back shortly for new hourly shifts.'**
  String get noOpenJobsSubtitle;

  /// No description provided for @postJobTitle.
  ///
  /// In en, this message translates to:
  /// **'Post an hourly job'**
  String get postJobTitle;

  /// No description provided for @postJobSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Save a draft job first, then fund escrow from your wallet to open it for applicants.'**
  String get postJobSubtitle;

  /// No description provided for @jobTitleLabel.
  ///
  /// In en, this message translates to:
  /// **'Job title'**
  String get jobTitleLabel;

  /// No description provided for @jobTitleHint.
  ///
  /// In en, this message translates to:
  /// **'Store inventory count'**
  String get jobTitleHint;

  /// No description provided for @jobDescriptionLabel.
  ///
  /// In en, this message translates to:
  /// **'Work description'**
  String get jobDescriptionLabel;

  /// No description provided for @jobDescriptionHint.
  ///
  /// In en, this message translates to:
  /// **'Describe tasks, dress code, and check-in point'**
  String get jobDescriptionHint;

  /// No description provided for @hourlyRateLabel.
  ///
  /// In en, this message translates to:
  /// **'Hourly rate (Rs)'**
  String get hourlyRateLabel;

  /// No description provided for @hoursLabel.
  ///
  /// In en, this message translates to:
  /// **'Duration (hours)'**
  String get hoursLabel;

  /// No description provided for @addressLabel.
  ///
  /// In en, this message translates to:
  /// **'Work location'**
  String get addressLabel;

  /// No description provided for @addressHint.
  ///
  /// In en, this message translates to:
  /// **'MG Road, Mangaluru'**
  String get addressHint;

  /// No description provided for @startsInHoursLabel.
  ///
  /// In en, this message translates to:
  /// **'Starts in (hours from now)'**
  String get startsInHoursLabel;

  /// No description provided for @checklistItemLabel.
  ///
  /// In en, this message translates to:
  /// **'Checklist task (optional)'**
  String get checklistItemLabel;

  /// No description provided for @createDraftButton.
  ///
  /// In en, this message translates to:
  /// **'Save draft job'**
  String get createDraftButton;

  /// No description provided for @jobDetailTitle.
  ///
  /// In en, this message translates to:
  /// **'Job and escrow details'**
  String get jobDetailTitle;

  /// No description provided for @escrowHeldLabel.
  ///
  /// In en, this message translates to:
  /// **'Escrow held'**
  String get escrowHeldLabel;

  /// No description provided for @totalPayoutLabel.
  ///
  /// In en, this message translates to:
  /// **'Total payout'**
  String get totalPayoutLabel;

  /// No description provided for @fundEscrowButton.
  ///
  /// In en, this message translates to:
  /// **'Fund escrow and open job'**
  String get fundEscrowButton;

  /// No description provided for @applyJobButton.
  ///
  /// In en, this message translates to:
  /// **'Apply for this job'**
  String get applyJobButton;

  /// No description provided for @applicantsSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Applicants'**
  String get applicantsSectionTitle;

  /// No description provided for @noApplicantsYet.
  ///
  /// In en, this message translates to:
  /// **'No applicants yet.'**
  String get noApplicantsYet;

  /// No description provided for @acceptApplicantButton.
  ///
  /// In en, this message translates to:
  /// **'Accept'**
  String get acceptApplicantButton;

  /// No description provided for @rejectApplicantButton.
  ///
  /// In en, this message translates to:
  /// **'Reject'**
  String get rejectApplicantButton;

  /// No description provided for @yourApplicationTitle.
  ///
  /// In en, this message translates to:
  /// **'Your application'**
  String get yourApplicationTitle;

  /// No description provided for @myJobsTitle.
  ///
  /// In en, this message translates to:
  /// **'Posted and applied jobs'**
  String get myJobsTitle;

  /// No description provided for @postedJobsSection.
  ///
  /// In en, this message translates to:
  /// **'Jobs you posted'**
  String get postedJobsSection;

  /// No description provided for @appliedJobsSection.
  ///
  /// In en, this message translates to:
  /// **'Jobs you applied to'**
  String get appliedJobsSection;

  /// No description provided for @noPostedJobs.
  ///
  /// In en, this message translates to:
  /// **'You have not posted any jobs yet.'**
  String get noPostedJobs;

  /// No description provided for @noAppliedJobs.
  ///
  /// In en, this message translates to:
  /// **'You have not applied to any jobs yet.'**
  String get noAppliedJobs;

  /// No description provided for @simulateTopupButton.
  ///
  /// In en, this message translates to:
  /// **'Add Rs 1,000 demo funds'**
  String get simulateTopupButton;

  /// No description provided for @ledgerHistoryTitle.
  ///
  /// In en, this message translates to:
  /// **'Wallet ledger entries'**
  String get ledgerHistoryTitle;

  /// No description provided for @noLedgerEntries.
  ///
  /// In en, this message translates to:
  /// **'No wallet transactions yet.'**
  String get noLedgerEntries;

  /// No description provided for @refreshButton.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get refreshButton;

  /// No description provided for @generateCheckinQrButton.
  ///
  /// In en, this message translates to:
  /// **'Show check-in QR code'**
  String get generateCheckinQrButton;

  /// No description provided for @checkinQrCardTitle.
  ///
  /// In en, this message translates to:
  /// **'Signed check-in QR code'**
  String get checkinQrCardTitle;

  /// No description provided for @copyQrPayloadButton.
  ///
  /// In en, this message translates to:
  /// **'Copy QR payload'**
  String get copyQrPayloadButton;

  /// No description provided for @workerCheckinCardTitle.
  ///
  /// In en, this message translates to:
  /// **'On-site QR and GPS check-in'**
  String get workerCheckinCardTitle;

  /// No description provided for @qrPayloadLabel.
  ///
  /// In en, this message translates to:
  /// **'Check-in QR payload'**
  String get qrPayloadLabel;

  /// No description provided for @checkinNowButton.
  ///
  /// In en, this message translates to:
  /// **'Check in and start shift'**
  String get checkinNowButton;

  /// No description provided for @liveTimeCardTitle.
  ///
  /// In en, this message translates to:
  /// **'Active shift time card'**
  String get liveTimeCardTitle;

  /// No description provided for @clockOutButton.
  ///
  /// In en, this message translates to:
  /// **'Clock out and submit time card'**
  String get clockOutButton;

  /// No description provided for @settlementCardTitle.
  ///
  /// In en, this message translates to:
  /// **'Time card settlement summary'**
  String get settlementCardTitle;

  /// No description provided for @payableMinutesLabel.
  ///
  /// In en, this message translates to:
  /// **'Payable minutes'**
  String get payableMinutesLabel;

  /// No description provided for @workerPayoutLabel.
  ///
  /// In en, this message translates to:
  /// **'Worker payout (95%)'**
  String get workerPayoutLabel;

  /// No description provided for @platformFeeLabel.
  ///
  /// In en, this message translates to:
  /// **'Platform fee (5%)'**
  String get platformFeeLabel;

  /// No description provided for @posterRefundLabel.
  ///
  /// In en, this message translates to:
  /// **'Unused escrow refund'**
  String get posterRefundLabel;

  /// No description provided for @approvePayoutButton.
  ///
  /// In en, this message translates to:
  /// **'Approve time card and release payout'**
  String get approvePayoutButton;

  /// No description provided for @rateExperienceTitle.
  ///
  /// In en, this message translates to:
  /// **'Rate this completed shift'**
  String get rateExperienceTitle;

  /// No description provided for @ratingCommentLabel.
  ///
  /// In en, this message translates to:
  /// **'Feedback comment (optional)'**
  String get ratingCommentLabel;

  /// No description provided for @submitRatingButton.
  ///
  /// In en, this message translates to:
  /// **'Submit rating'**
  String get submitRatingButton;

  /// No description provided for @ratingSubmittedBanner.
  ///
  /// In en, this message translates to:
  /// **'Rating recorded on the ledger'**
  String get ratingSubmittedBanner;

  /// No description provided for @raiseDisputeButton.
  ///
  /// In en, this message translates to:
  /// **'Raise dispute and freeze escrow'**
  String get raiseDisputeButton;

  /// No description provided for @disputeCardTitle.
  ///
  /// In en, this message translates to:
  /// **'Escrow dispute'**
  String get disputeCardTitle;

  /// No description provided for @disputeReasonLabel.
  ///
  /// In en, this message translates to:
  /// **'Dispute reason'**
  String get disputeReasonLabel;

  /// No description provided for @disputeEvidenceLabel.
  ///
  /// In en, this message translates to:
  /// **'Supporting note (optional)'**
  String get disputeEvidenceLabel;

  /// No description provided for @submitDisputeButton.
  ///
  /// In en, this message translates to:
  /// **'Freeze escrow and submit dispute'**
  String get submitDisputeButton;

  /// No description provided for @disputeFrozenBanner.
  ///
  /// In en, this message translates to:
  /// **'Escrow is frozen pending admin review'**
  String get disputeFrozenBanner;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'kn'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'kn':
      return AppLocalizationsKn();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}
