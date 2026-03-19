// Re-export from project.ts for convenience
export type { ProjectSettings } from './project';

export interface GitHubPATStatus {
  configured: boolean;
  username: string | null;
}
