export type HostingMode = 'self_hosted' | 'commercial' | 'free_tier';
export type AuthType = 'bearer' | 'api_key' | 'none';
export type EngineSlot = 'a' | 'b' | 'c';
export type HealthStatus = 'online' | 'offline' | 'suspect';

export interface EngineConfig {
  id: string;
  slot: EngineSlot;
  hosting_mode: HostingMode;
  endpoint_url: string;
  auth_type: AuthType;
  model_name: string;
  model_family: string;
  family_override: string | null;
  health_status: HealthStatus;
  last_health_check: string;
  latency_ms?: number;
  avg_latency_ms?: number;
  queue_depth?: number;
  error_rate?: number;
  daily_messages_used?: number;
  daily_messages_limit?: number;
}

export interface EngineUpdatePayload {
  hosting_mode: HostingMode;
  endpoint_url: string;
  auth_type: AuthType;
  credentials?: string;
  model_name: string;
  model_family: string;
  family_override?: string | null;
}

export type DiversityStatus = 'green' | 'yellow' | 'red';

export interface DiversityEngineResult {
  slot: EngineSlot;
  model_name: string;
  family: string;
  status: DiversityStatus;
}

export interface DiversityValidation {
  valid: boolean;
  engines: DiversityEngineResult[];
  message: string;
}
