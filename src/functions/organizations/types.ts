export interface Organization {
  PK: string; // ORG#{clerkOrgId}
  SK: string; // META
  clerkOrgId: string;
  name: string;
  slug: string;
  teamSize?: number;
  plan: 'free' | 'starter' | 'pro' | 'enterprise'; // default: 'free'
  currency: string; // ISO 4217 code, e.g., 'USD'
  settings?: Record<string, any>; // JSON for additional settings
  createdBy: string; // userId of creator
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  onboardingCompleted: boolean; // true when user completes onboarding form
  onboardingCompletedAt?: string; // ISO 8601, when onboarding was completed
}

export interface OrganizationMember {
  PK: string; // ORG#{clerkOrgId}
  SK: string; // USER#{userId}
  userId: string;
  role: 'admin' | 'member'; // roles from Clerk
  joinedAt: string; // ISO 8601
  invitedBy?: string; // userId
  status: 'active' | 'invited'; // from Clerk
  email?: string; // denormalized for listing
}

export interface GSI1Item {
  GSI1PK: string; // USER#{userId}
  GSI1SK: string; // ORG#{orgId}
  orgName?: string; // denormalized
  role?: string;
}

export interface CreateOrganizationInput {
  clerkOrgId: string;
  name: string;
  teamSize?: number;
  currency?: string;
}

export interface UpdateOrganizationInput {
  name?: string;
  teamSize?: number;
  currency?: string;
  settings?: Record<string, any>;
  plan?: string;
}

export interface ListOrgsByUserResult {
  orgId: string;
  name: string;
  role: string;
  joinedAt: string;
}
