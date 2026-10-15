export interface Parent {
  agentId: string;
  pid: number;
  startedAt: number;
  sessionId: string;
}
export interface SpawnInput {
  harness: 'pi';
  mode: 'interactive' | 'headless';
  prompt?: string;
  cwd: string;
  model?: string;
  name?: string;
  parent: Parent;
}
export type Status = 'starting' | 'running' | 'idle' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'lost';
export interface Completion {
  status: 'completed' | 'failed' | 'cancelled' | 'interrupted';
  text: string;
  stopReason?: string;
  error?: string;
}
export interface Task {
  id: string;
  owner: string;
  input: SpawnInput;
  createdAt: number;
  status: Status;
  directory: string;
  pane?: string;
  tmuxSocket?: string;
  pid?: number;
  startedAt?: number;
  sessionId?: string;
  processState: 'starting' | 'available' | 'exited';
  completion?: Completion;
  delivery: 'pending' | 'accepted' | 'unavailable' | 'none';
  deliveryError?: string;
  notification?: string;
}
export interface Ready { pid: number; sessionId: string }
export interface Request {
  action: 'spawn' | 'list' | 'check' | 'fetch_answer' | 'cancel';
  owner: string;
  input?: SpawnInput;
  taskId?: string;
}
