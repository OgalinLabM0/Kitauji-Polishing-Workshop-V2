import { describe, expect, it } from 'vitest';
import { acceptedModelPolicy, memoryPolicyFor } from './memoryPolicy.cjs';

describe('layered memory retention policy', () => {
  it('keeps identity and relationship knowledge durable while treating scene detail as local', () => {
    expect(memoryPolicyFor('secret', 'identity', '他的真实身份已经揭晓。', 0.96)).toMatchObject({
      memoryClass: 'canon', retentionPolicy: 'permanent', retrievalScope: 'series',
    });
    expect(memoryPolicyFor('relationship', 'address', 'A开始称B为老师。', 0.93)).toMatchObject({
      memoryClass: 'relationship', retentionPolicy: 'stable', retrievalScope: 'series',
    });
    expect(memoryPolicyFor('detail', 'weather', '窗外落着小雨。', 0.8)).toMatchObject({
      memoryClass: 'episode-detail', retentionPolicy: 'episodic', retrievalScope: 'scene',
    });
  });

  it('does not let a model promote ordinary detail into cross-volume canon', () => {
    const derived = memoryPolicyFor('detail', 'weather', '窗外落着小雨。', 0.8);
    expect(acceptedModelPolicy(derived, 'canon', 1, 'series')).toEqual({
      ...derived, importance: derived.importance + 0.1,
    });
  });
});
