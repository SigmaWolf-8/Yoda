export interface ProjectSettings {
  review_intensity: 'full' | 'medium' | 'light';
  decomposition_budget: number | null;
}

export interface Project {
  id: string;
  name: string;
  mode: 'yoda' | 'ronin';
  org_id: string;
  settings: ProjectSettings;
  created_at: string;
  updated_at: string;
}
