class UserModel {
  final String id;
  final String email;
  final String studentId;
  final String firstName;
  final String lastName;
  final String phoneNumber;
  final String? profileImage;
  final String? idImageUrl;
  final bool profileComplete;
  final bool isVerified;

  /// Workflow state behind [isVerified] — UNSUBMITTED / PENDING / APPROVED /
  /// REJECTED. The gate alone couldn't tell "never submitted" from "waiting"
  /// from "rejected", so the app showed all three as pending forever.
  final String verificationStatus;
  final String? verificationReason;
  final String? verificationNote;
  final String role;
  final bool payoutConfigured;

  UserModel({
    required this.id,
    required this.email,
    required this.studentId,
    required this.firstName,
    required this.lastName,
    required this.phoneNumber,
    this.profileImage,
    this.idImageUrl,
    this.profileComplete = false,
    required this.isVerified,
    this.verificationStatus = 'UNSUBMITTED',
    this.verificationReason,
    this.verificationNote,
    this.role = 'STUDENT',
    this.payoutConfigured = false,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: json['id'] as String,
      email: json['email'] as String,
      studentId: json['studentId'] as String,
      firstName: json['firstName'] as String,
      lastName: json['lastName'] as String,
      phoneNumber: json['phoneNumber'] as String,
      profileImage: json['profileImage'] as String?,
      idImageUrl: json['idImageUrl'] as String?,
      profileComplete: (json['profileComplete'] as bool?) ?? false,
      isVerified: (json['isVerified'] as bool?) ?? false,
      // These three were never read, so every user fell through to the
      // constructor's `UNSUBMITTED` default no matter what the server said —
      // and the Profile tab's Identity tile treats `UNSUBMITTED` as "not
      // submitted yet", so it re-prompted verified students to capture their
      // ID and face again. The server has always sent them (`PROFILE_SELECT`
      // in authController.ts).
      verificationStatus:
          (json['verificationStatus'] as String?) ?? 'UNSUBMITTED',
      verificationReason: json['verificationReason'] as String?,
      verificationNote: json['verificationNote'] as String?,
      role: (json['role'] as String?) ?? 'STUDENT',
      payoutConfigured: (json['payoutConfigured'] as bool?) ?? false,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'studentId': studentId,
        'firstName': firstName,
        'lastName': lastName,
        'phoneNumber': phoneNumber,
        'profileImage': profileImage,
        'idImageUrl': idImageUrl,
        'profileComplete': profileComplete,
        'isVerified': isVerified,
        // Round-tripped too, or a cached user loses its verification state and
        // reproduces the same bug the moment it's restored from storage.
        'verificationStatus': verificationStatus,
        'verificationReason': verificationReason,
        'verificationNote': verificationNote,
        'role': role,
        'payoutConfigured': payoutConfigured,
      };

  String get fullName => '$firstName $lastName';
}
