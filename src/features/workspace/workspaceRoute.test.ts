import { describe, expect, it } from 'vitest';
import { guardWorkspaceView, parseWorkspaceHash, workspaceHash } from './workspaceRoute';

describe('workspace route', () => {
  it('maps the new multi-level routes', () => {
    expect(parseWorkspaceHash('#library')).toBe('library');
    expect(parseWorkspaceHash('#project/workshop')).toBe('workshop');
    expect(parseWorkspaceHash('#project/reader')).toBe('reader');
    expect(parseWorkspaceHash('#project/home?displayScale=1.4')).toBe('home');
    expect(parseWorkspaceHash('#settings')).toBe('settings');
  });

  it('keeps compatibility with the 010 hashes', () => {
    expect(parseWorkspaceHash('#workspace')).toBe('home');
    expect(parseWorkspaceHash('#workspace/glossary')).toBe('glossary');
    expect(parseWorkspaceHash('#workspace/chapters')).toBe('proof');
  });

  it('returns an empty library instead of a project page when no project exists', () => {
    expect(guardWorkspaceView('reader', false)).toBe('library');
    expect(guardWorkspaceView('settings', false)).toBe('settings');
  });

  it('does not destroy a deep link while the project library is still loading', () => {
    expect(guardWorkspaceView('home', false, true)).toBe('home');
    expect(guardWorkspaceView('reader', false, true)).toBe('reader');
  });

  it('formats stable hashes for every shell level', () => {
    expect(workspaceHash('library')).toBe('library');
    expect(workspaceHash('settings')).toBe('settings');
    expect(workspaceHash('review')).toBe('project/review');
  });
});
