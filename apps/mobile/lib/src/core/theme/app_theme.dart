import 'package:flutter/material.dart';

/// Strict Time Card & Ledger design tokens.
/// Only these six base colors, three fonts, 10 px radius, hairline borders, and zero shadows.
class AppTokens {
  AppTokens._();

  static const Color paper = Color(0xFFF5F1E8);
  static const Color ink = Color(0xFF16181D);
  static const Color action = Color(0xFFC2410C);
  static const Color held = Color(0xFF1B6B5A);
  static const Color caution = Color(0xFF8A5A00);
  static const Color danger = Color(0xFFB42318);

  // Derived hairline and subtle tint fills strictly from the 6 base tokens.
  static const Color hairline = Color(0x2E16181D);
  static const Color paperInset = Color(0x0D16181D);
  static const Color heldTint = Color(0x141B6B5A);
  static const Color cautionTint = Color(0x148A5A00);
  static const Color dangerTint = Color(0x14B42318);

  static const double radius = 10.0;
  static const BorderRadius borderRadius = BorderRadius.all(Radius.circular(radius));

  // 4-point spacing scale
  static const double s4 = 4.0;
  static const double s8 = 8.0;
  static const double s12 = 12.0;
  static const double s16 = 16.0;
  static const double s24 = 24.0;
  static const double s32 = 32.0;
  static const double minTouchTarget = 48.0;

  static const String displayFont = 'BricolageGrotesque';
  static const String bodyFont = 'InstrumentSans';
  static const String monoFont = 'IBMPlexMono';

  static const TextStyle monoTabular = TextStyle(
    fontFamily: monoFont,
    fontWeight: FontWeight.w500,
    color: ink,
    fontFeatures: <FontFeature>[FontFeature.tabularFigures()],
  );
}

ThemeData buildAppTheme() {
  const outlineSide = BorderSide(color: AppTokens.hairline, width: 1.0);
  const focusedSide = BorderSide(color: AppTokens.ink, width: 1.5);
  const errorSide = BorderSide(color: AppTokens.danger, width: 1.5);

  return ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: AppTokens.paper,
    fontFamily: AppTokens.bodyFont,
    colorScheme: const ColorScheme(
      brightness: Brightness.light,
      primary: AppTokens.ink,
      onPrimary: AppTokens.paper,
      secondary: AppTokens.action,
      onSecondary: AppTokens.paper,
      error: AppTokens.danger,
      onError: AppTokens.paper,
      surface: AppTokens.paper,
      onSurface: AppTokens.ink,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: AppTokens.paper,
      foregroundColor: AppTokens.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontFamily: AppTokens.displayFont,
        fontSize: 20,
        fontWeight: FontWeight.w700,
        color: AppTokens.ink,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: AppTokens.paper,
      elevation: 0,
      shadowColor: Colors.transparent,
      indicatorColor: AppTokens.paperInset,
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return TextStyle(
          fontFamily: AppTokens.bodyFont,
          fontSize: 12,
          fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          color: selected ? AppTokens.action : AppTokens.ink,
        );
      }),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return IconThemeData(
          color: selected ? AppTokens.action : AppTokens.ink,
          size: 22,
        );
      }),
    ),
    cardTheme: const CardThemeData(
      color: AppTokens.paper,
      elevation: 0,
      shadowColor: Colors.transparent,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: AppTokens.borderRadius,
        side: BorderSide(color: AppTokens.hairline, width: 1.0),
      ),
    ),
    dividerTheme: const DividerThemeData(
      color: AppTokens.hairline,
      thickness: 1.0,
      space: 1.0,
    ),
    textTheme: const TextTheme(
      headlineMedium: TextStyle(
        fontFamily: AppTokens.displayFont,
        fontSize: 26,
        fontWeight: FontWeight.w700,
        height: 1.2,
        color: AppTokens.ink,
      ),
      titleLarge: TextStyle(
        fontFamily: AppTokens.displayFont,
        fontSize: 20,
        fontWeight: FontWeight.w700,
        height: 1.25,
        color: AppTokens.ink,
      ),
      titleMedium: TextStyle(
        fontFamily: AppTokens.bodyFont,
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: AppTokens.ink,
      ),
      bodyLarge: TextStyle(
        fontFamily: AppTokens.bodyFont,
        fontSize: 16,
        height: 1.4,
        color: AppTokens.ink,
      ),
      bodyMedium: TextStyle(
        fontFamily: AppTokens.bodyFont,
        fontSize: 14,
        height: 1.4,
        color: AppTokens.ink,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppTokens.paperInset,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(borderRadius: AppTokens.borderRadius, borderSide: outlineSide),
      enabledBorder: OutlineInputBorder(borderRadius: AppTokens.borderRadius, borderSide: outlineSide),
      focusedBorder: OutlineInputBorder(borderRadius: AppTokens.borderRadius, borderSide: focusedSide),
      errorBorder: OutlineInputBorder(borderRadius: AppTokens.borderRadius, borderSide: errorSide),
      focusedErrorBorder: OutlineInputBorder(borderRadius: AppTokens.borderRadius, borderSide: errorSide),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppTokens.action,
        foregroundColor: AppTokens.paper,
        elevation: 0,
        shadowColor: Colors.transparent,
        minimumSize: const Size(double.infinity, AppTokens.minTouchTarget),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        shape: const RoundedRectangleBorder(borderRadius: AppTokens.borderRadius),
        textStyle: const TextStyle(
          fontFamily: AppTokens.bodyFont,
          fontSize: 16,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppTokens.ink,
        elevation: 0,
        shadowColor: Colors.transparent,
        minimumSize: const Size(AppTokens.minTouchTarget, AppTokens.minTouchTarget),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        side: outlineSide,
        shape: const RoundedRectangleBorder(borderRadius: AppTokens.borderRadius),
        textStyle: const TextStyle(
          fontFamily: AppTokens.bodyFont,
          fontSize: 15,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
  );
}
