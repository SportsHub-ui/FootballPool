export type UserRole = 'organizer' | 'participant' | 'player';

export interface AuthContext {
  userId: string;
  role: UserRole;
}
