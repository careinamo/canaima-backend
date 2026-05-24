export interface User {
  PK: string; // USER#{clerkUserId}
  SK: string; // PROFILE
  clerkUserId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  lastSignInAt?: string;
}

export interface UpdateUserProfileInput {
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
}
