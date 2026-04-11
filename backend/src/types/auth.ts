export type UserRole = 'organizer' | 'participant' | 'player';

export interface AuthPermissions {
  canManageOrganizations: boolean;
  canManageMembers: boolean;
  canManagePools: boolean;
  canManageNotifications: boolean;
  canManageMarketing: boolean;
  canManageUsers: boolean;
  canApproveOrgAccess: boolean;
  canRunSimulation: boolean;
  canViewMetrics: boolean;
}

export interface AuthContext {
  userId: string;
  role: UserRole;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  isAdmin: boolean;
  managedOrganizationIds: number[];
  accessibleOrganizationIds: number[];
  permissions: AuthPermissions;
}
