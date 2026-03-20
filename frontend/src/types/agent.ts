/* ═══════════════════════════════════════════════════════════════
   Agent Types — YODA Agent Roster
   Palette: blues hsl(210,...), purple sparingly, warm grays
   Voice: first-person plural "we" for all agents
   ═══════════════════════════════════════════════════════════════ */

export type AgentSource = 'upstream' | 'capomastro' | 'custom';

export type AgentDivision =
  | 'capomastro'
  | 'engineering'
  | 'testing'
  | 'design'
  | 'product'
  | 'project-management'
  | 'specialized'
  | 'academic'
  | 'marketing'
  | 'sales'
  | 'paid-media'
  | 'support'
  | 'game-development'
  | 'spatial-computing';

export type CubeRing = 'central' | 'inner' | 'outer' | 'depth' | 'satellite';

export interface DivisionMeta {
  id: AgentDivision;
  label: string;
  ring: CubeRing;
  satelliteParent?: AgentDivision;
  satelliteAngleOffset?: number;
}

export const DIVISIONS: DivisionMeta[] = [
  // [0] central
  { id: 'capomastro',         label: 'Capomastro',   ring: 'central' },
  // [1-6] inner ring (6 nodes — clean hexagon)
  { id: 'engineering',        label: 'Engineering',  ring: 'inner' },
  { id: 'testing',            label: 'Testing',      ring: 'inner' },
  { id: 'design',             label: 'Design',       ring: 'inner' },
  { id: 'product',            label: 'Product',      ring: 'inner' },
  { id: 'project-management', label: 'Project Mgmt', ring: 'inner' },
  { id: 'specialized',        label: 'Specialized',  ring: 'inner' },
  // [7-11] outer ring (5 nodes — pentagon)
  { id: 'marketing',          label: 'Marketing',    ring: 'outer' },
  { id: 'sales',              label: 'Sales',        ring: 'outer' },
  { id: 'paid-media',         label: 'Paid Media',   ring: 'outer' },
  { id: 'support',            label: 'Support',      ring: 'outer' },
  { id: 'game-development',   label: 'Game Dev',     ring: 'outer' },
  // [12] depth
  { id: 'spatial-computing',  label: 'Spatial',      ring: 'depth' },
  // [13] satellite sub-node — tethered to parent inner node
  { id: 'academic', label: 'Academic', ring: 'satellite', satelliteParent: 'engineering', satelliteAngleOffset: -Math.PI / 5 },
];

export interface AgentConfig {
  agent_id: string;
  display_name: string;
  division: AgentDivision;
  source: AgentSource;
  about: string;
  key_skills: string[];
  competencies: string[];
  review_criteria: string[];
  compatible_reviewers: string[];
  primary_role: 'Producer' | 'Reviewer' | 'Both';
  license: string;
  readonly: boolean;
}

export interface AgentUsageStats {
  agent_id: string;
  total_calls: number;
  as_producer: number;
  as_reviewer: number;
  avg_confidence: number;
  approval_rate: number;
  last_used: string | null;
  calls_this_week: number;
}

export interface AgentWithStats extends AgentConfig {
  stats: AgentUsageStats;
}

export interface AgentUpsertPayload {
  display_name: string;
  division: AgentDivision;
  about: string;
  key_skills: string[];
  competencies: string[];
  review_criteria: string[];
  compatible_reviewers: string[];
  primary_role: 'Producer' | 'Reviewer' | 'Both';
  template_from?: string;
}

export interface AgentSyncStatus {
  up_to_date: boolean;
  last_synced_at: string | null;
  last_commit: string | null;
  new_agents: SyncAgentPreview[];
  updated_agents: SyncAgentPreview[];
}

export interface SyncAgentPreview {
  agent_id: string;
  display_name: string;
  division: AgentDivision;
  change_type: 'new' | 'updated';
  change_summary?: string;
}

export interface AgentRecentTask {
  task_number: string;
  title: string;
  status: string;
  time_ago: string;
}
