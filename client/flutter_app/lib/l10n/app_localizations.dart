import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_ceb.dart';
import 'app_localizations_en.dart';
import 'app_localizations_fil.dart';

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
    Locale('ceb'),
    Locale('en'),
    Locale('fil'),
  ];

  /// Sign-in screen heading, and the label on the submit button.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get signIn;

  /// Email field label on the sign-in screen.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get email;

  /// Password field label on the sign-in screen.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get password;

  /// Button on the sign-in screen that navigates to registration.
  ///
  /// In en, this message translates to:
  /// **'Create an account'**
  String get createAccount;

  /// Divider label above the create-account button on the sign-in screen.
  ///
  /// In en, this message translates to:
  /// **'New here?'**
  String get newHere;

  /// Bottom navigation tab label.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get navHome;

  /// Bottom navigation tab label.
  ///
  /// In en, this message translates to:
  /// **'Rentals'**
  String get navRentals;

  /// Bottom navigation tab label.
  ///
  /// In en, this message translates to:
  /// **'Alerts'**
  String get navAlerts;

  /// Bottom navigation tab label.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get navProfile;

  /// Home tab secondary action — starts the create-listing flow.
  ///
  /// In en, this message translates to:
  /// **'List an item'**
  String get listAnItem;

  /// Home tab secondary action — opens the kiosk QR scanner.
  ///
  /// In en, this message translates to:
  /// **'Scan kiosk'**
  String get scanKiosk;

  /// Home tab secondary action label that switches to the Rentals tab.
  ///
  /// In en, this message translates to:
  /// **'My rentals'**
  String get myRentalsAction;

  /// Home tab secondary action — opens the owner's own listings.
  ///
  /// In en, this message translates to:
  /// **'My listings'**
  String get myListingsAction;

  /// Button shown alongside a failed-to-load message on the Home tab.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get retry;

  /// Section heading on the Home tab above the category rail.
  ///
  /// In en, this message translates to:
  /// **'Browse by category'**
  String get browseByCategory;

  /// Link next to the category section heading.
  ///
  /// In en, this message translates to:
  /// **'See all'**
  String get seeAll;

  /// App bar title on the Rentals tab.
  ///
  /// In en, this message translates to:
  /// **'My Rentals'**
  String get myRentalsTitle;

  /// Error state title on the Rentals tab when the request fails.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load your rentals'**
  String get couldNotLoadRentals;

  /// Retry button on the Rentals tab error state.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get tryAgain;

  /// Empty state title on the Rentals tab when the student has no rentals.
  ///
  /// In en, this message translates to:
  /// **'No rentals yet'**
  String get noRentalsYet;

  /// Call-to-action button on the Rentals tab empty state.
  ///
  /// In en, this message translates to:
  /// **'Browse equipment'**
  String get browseEquipment;

  /// Status pill shown on an item that can currently be rented.
  ///
  /// In en, this message translates to:
  /// **'Available'**
  String get available;

  /// Compact status pill on an item card when the item is currently rented out.
  ///
  /// In en, this message translates to:
  /// **'Rented'**
  String get rented;

  /// Status pill on the item detail screen when the item is currently rented out.
  ///
  /// In en, this message translates to:
  /// **'Rented out'**
  String get rentedOut;

  /// Primary call-to-action button on the item detail screen.
  ///
  /// In en, this message translates to:
  /// **'Request rental'**
  String get requestRental;

  /// Disabled call-to-action label on the item detail screen when the item can't be rented.
  ///
  /// In en, this message translates to:
  /// **'Unavailable'**
  String get unavailable;

  /// Cancel button in the delete-account confirmation dialog.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// Profile tile title, and the language picker bottom sheet title.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get language;

  /// Subtitle shown under the Language profile tile.
  ///
  /// In en, this message translates to:
  /// **'Choose your preferred app language'**
  String get languageSubtitle;

  /// English option in the language picker.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get languageEnglish;

  /// Filipino/Tagalog option in the language picker.
  ///
  /// In en, this message translates to:
  /// **'Filipino'**
  String get languageFilipino;

  /// Cebuano/Bisaya option in the language picker.
  ///
  /// In en, this message translates to:
  /// **'Bisaya'**
  String get languageBisaya;
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
      <String>['ceb', 'en', 'fil'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ceb':
      return AppLocalizationsCeb();
    case 'en':
      return AppLocalizationsEn();
    case 'fil':
      return AppLocalizationsFil();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
