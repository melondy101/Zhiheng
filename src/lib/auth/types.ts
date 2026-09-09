export interface User {
  id: string;
  name: string;
  email: string;
  emailLower: string;
  passwordHash: string;
  isGuest: boolean;
  createdAt: number;
  updatedAt: number;
}

export type SafeUser = Omit<User, 'passwordHash'>;

export interface SessionPayload {
  userId: string;
  name: string;
  email: string;
  isGuest: boolean;
  exp?: number;
  iat?: number;
}

export interface VerificationRecord {
  id: string;
  emailLower: string;
  code: string;
  attempts: number;
  expiresAt: number;
  createdAt: number;
}
