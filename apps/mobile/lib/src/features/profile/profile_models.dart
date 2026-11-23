class UserProfile {
  const UserProfile({
    required this.id,
    required this.phone,
    required this.role,
    required this.status,
    required this.verifiedName,
    required this.ageVerified,
    required this.idType,
    required this.idLast4,
    required this.trustLevel,
    required this.responsivenessScore,
    required this.walletBalancePaise,
  });

  final String id;
  final String phone;
  final String role;
  final String status;
  final String? verifiedName;
  final bool ageVerified;
  final String? idType;
  final String? idLast4;
  final int trustLevel;
  final int responsivenessScore;
  final int walletBalancePaise;

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      id: json['id'] as String,
      phone: json['phone'] as String,
      role: json['role'] as String,
      status: json['status'] as String,
      verifiedName: json['verified_name'] as String?,
      ageVerified: (json['age_verified'] as bool?) ?? false,
      idType: json['id_type'] as String?,
      idLast4: json['id_last4'] as String?,
      trustLevel: (json['trust_level'] as num?)?.toInt() ?? 0,
      responsivenessScore: (json['responsiveness_score'] as num?)?.toInt() ?? 100,
      walletBalancePaise: (json['wallet_balance_paise'] as num?)?.toInt() ?? 0,
    );
  }

  /// Formats integer paise for display (e.g. 22000 -> "Rs 220.00", 88050 -> "Rs 880.50").
  static String formatPaise(int paise) {
    final sign = paise < 0 ? '-' : '';
    final abs = paise.abs();
    final rupees = abs ~/ 100;
    final rem = (abs % 100).toString().padLeft(2, '0');
    return '${sign}Rs $rupees.$rem';
  }
}
