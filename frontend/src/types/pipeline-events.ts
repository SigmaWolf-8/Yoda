export interface TaskStateChangeEvent {
  type: 'TaskStateChange';
  task_id: string;
  task_number: string;
  previous_status: string;
  new_status: string;
  timestamp: string;
}

export interface EngineActivityEvent {
  type: 'EngineActivity';
  task_id: string;
  engine_id: string;
  agent_role: string;
  action: string;
  step_number: number;
  timestamp: string;
}

export interface StepProgressEvent {
  type: 'StepProgress';
  task_id: string;
  step_number: number;
  reviews_completed: number;
  reviews_total: number;
  timestamp: string;
}

export interface ReviewCompleteEvent {
  type: 'ReviewComplete';
  task_id: string;
  step_number: number;
  engine_id: string;
  agent_role: string;
  passed: boolean;
  confidence: number;
  censorship_flagged: boolean;
  timestamp: string;
}

export interface TaskCompleteEvent {
  type: 'TaskComplete';
  task_id: string;
  task_number: string;
  final_status: 'FINAL' | 'ESCALATED';
  tl_dsa_signed: boolean;
  timestamp: string;
}

export interface PipelineCompleteEvent {
  type: 'PipelineComplete';
  project_id: string;
  total_tasks: number;
  completed: number;
  escalated: number;
  elapsed_seconds: number;
  timestamp: string;
}

export interface EngineHealthChangeEvent {
  type: 'EngineHealthChange';
  engine_id: string;
  previous_status: string;
  new_status: string;
  timestamp: string;
}

export type PipelineEvent =
  | TaskStateChangeEvent
  | EngineActivityEvent
  | StepProgressEvent
  | ReviewCompleteEvent
  | TaskCompleteEvent
  | PipelineCompleteEvent
  | EngineHealthChangeEvent;
