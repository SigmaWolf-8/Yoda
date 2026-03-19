export interface KBEntry {
  id: string;
  project_id: string;
  content: string;
  tags: string[];
  archived: boolean;
  pinned: boolean;
  boost_score: number;
  relevance_score?: number;
  created_at: string;
  updated_at: string;
}

export interface KBUpdatePayload {
  tags?: string[];
  boost_score?: number;
  archived?: boolean;
  pinned?: boolean;
}

export interface KBSearchParams {
  q?: string;
  tags?: string;
  archived?: boolean;
  pinned?: boolean;
}
