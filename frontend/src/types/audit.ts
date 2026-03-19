export interface AuditRecord {
  id: string;
  task_id: string;
  event_type: string;
  payload_hash: string;
  tl_dsa_signature: string;
  engine_id: string;
  model_version: string;
  created_at: string;
}
