import { describe, expect, it } from 'vitest';
import { canTransition, isTerminalStatus, transitionWorkflow } from './workflowMachine';

describe('workflowMachine', () => {
  it('允许任务按队列、运行、完成的受控路径前进', () => {
    expect(canTransition('idle', 'queued')).toBe(true);
    expect(canTransition('queued', 'running')).toBe(true);
    expect(transitionWorkflow('running', 'completed')).toBe('completed');
  });

  it('禁止已完成任务重新运行', () => {
    expect(canTransition('completed', 'running')).toBe(false);
    expect(() => transitionWorkflow('completed', 'running')).toThrow('非法任务状态转换');
  });

  it('将完成与取消识别为终态', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(false);
  });
});
