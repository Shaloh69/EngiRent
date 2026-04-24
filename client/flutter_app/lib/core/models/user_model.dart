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
  final String role;

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
    this.role = 'STUDENT',
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
      role: (json['role'] as String?) ?? 'STUDENT',
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
        'role': role,
      };

  String get fullName => '$firstName $lastName';
  bool get isAdmin => role == 'ADMIN';
}
