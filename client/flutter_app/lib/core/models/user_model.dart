class UserModel {
  final String id;
  final String email;
  final String studentId;
  final String firstName;
  final String lastName;
  final String phoneNumber;
  final String? profileImage;
  final bool isVerified;

  UserModel({
    required this.id,
    required this.email,
    required this.studentId,
    required this.firstName,
    required this.lastName,
    required this.phoneNumber,
    this.profileImage,
    required this.isVerified,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: json['id'],
      email: json['email'],
      studentId: json['studentId'],
      firstName: json['firstName'],
      lastName: json['lastName'],
      phoneNumber: json['phoneNumber'],
      profileImage: json['profileImage'],
      isVerified: json['isVerified'] ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'email': email,
      'studentId': studentId,
      'firstName': firstName,
      'lastName': lastName,
      'phoneNumber': phoneNumber,
      'profileImage': profileImage,
      'isVerified': isVerified,
    };
  }

  String get fullName => '$firstName $lastName';
}
