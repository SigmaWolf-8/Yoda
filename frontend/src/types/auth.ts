export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface Organization {
  id: string;
  name: string;
  role?: 'owner' | 'admin' | 'member';
  created_at: string;
}

export interface OrgMember {
  user_id: string;
  org_id: string;
  role: 'owner' | 'admin' | 'member';
  name?: string;
  email?: string;
  created_at: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
}

export interface AuthTokens {
  token: string;
  refresh_token: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  refresh_token: string;
}

export interface Invitation {
  email: string;
  role: 'owner' | 'admin' | 'member';
  org_id: string;
  created_at: string;
}
