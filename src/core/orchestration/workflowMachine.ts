import type { WorkflowStatus } from '../domain/models';

const ALLOWED_TRANSITIONS: Readonly<Record<WorkflowStatus, readonly WorkflowStatus[]>> = {
  idle: ['queued', 'cancelled'],
  queued: ['running', 'cancelled'],
  running: ['paused', 'review-required', 'failed', 'completed', 'cancelled'],
  paused: ['queued', 'cancelled'],
  'review-required': ['queued', 'completed', 'cancelled'],
  failed: ['queued', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const canTransition = (from: WorkflowStatus, to: WorkflowStatus): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to);

export const transitionWorkflow = (from: WorkflowStatus, to: WorkflowStatus): WorkflowStatus => {
  if (!canTransition(from, to)) {
    throw new Error(`非法任务状态转换：${from} -> ${to}`);
  }

  return to;
};

export const isTerminalStatus = (status: WorkflowStatus): boolean =>
  status === 'completed' || status === 'cancelled';
