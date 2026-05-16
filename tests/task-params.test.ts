import { describe, it, expect } from 'vitest';
import { resolveTaskId, resolveTaskTitle, resolveTaskIdentifier } from '../src/task-params.js';

describe('resolveTaskId', () => {
  it('returns issue_id when provided', () => {
    expect(resolveTaskId({ issue_id: 'abc-123' })).toBe('abc-123');
  });

  it('returns task_id as fallback when issue_id is missing', () => {
    expect(resolveTaskId({ task_id: 'abc-123' })).toBe('abc-123');
  });

  it('prefers issue_id over task_id when both are provided', () => {
    expect(resolveTaskId({ issue_id: 'correct', task_id: 'wrong' })).toBe('correct');
  });

  it('returns undefined when neither is provided', () => {
    expect(resolveTaskId({})).toBeUndefined();
  });

  it('returns undefined for null/undefined args', () => {
    expect(resolveTaskId(null)).toBeUndefined();
    expect(resolveTaskId(undefined)).toBeUndefined();
  });

  it('works with short_id format (6 alphanumeric)', () => {
    expect(resolveTaskId({ task_id: 'kyk1y1' })).toBe('kyk1y1');
  });

  it('works with full UUID format', () => {
    expect(resolveTaskId({ task_id: 'c6b77ba4-1eac-48f7-b213-457d577b6cf1' }))
      .toBe('c6b77ba4-1eac-48f7-b213-457d577b6cf1');
  });
});

describe('resolveTaskTitle', () => {
  it('returns title when provided', () => {
    expect(resolveTaskTitle({ title: 'My Task' })).toBe('My Task');
  });

  it('returns name as fallback when title is missing', () => {
    expect(resolveTaskTitle({ name: 'My Task' })).toBe('My Task');
  });

  it('returns issue_title as fallback', () => {
    expect(resolveTaskTitle({ issue_title: 'My Task' })).toBe('My Task');
  });

  it('prefers title over name and issue_title', () => {
    expect(resolveTaskTitle({ title: 'correct', name: 'wrong', issue_title: 'also wrong' })).toBe('correct');
  });

  it('returns undefined when none provided', () => {
    expect(resolveTaskTitle({})).toBeUndefined();
  });

  it('returns undefined for null/undefined args', () => {
    expect(resolveTaskTitle(null)).toBeUndefined();
    expect(resolveTaskTitle(undefined)).toBeUndefined();
  });
});

describe('resolveTaskIdentifier', () => {
  // UUID detection
  it('detects a UUID', () => {
    const result = resolveTaskIdentifier({ identifier: 'c6b77ba4-1eac-48f7-b213-457d577b6cf1' });
    expect(result).toEqual({ type: 'uuid', value: 'c6b77ba4-1eac-48f7-b213-457d577b6cf1' });
  });

  it('detects UUID from issue_id param', () => {
    const result = resolveTaskIdentifier({ issue_id: 'c6b77ba4-1eac-48f7-b213-457d577b6cf1' });
    expect(result).toEqual({ type: 'uuid', value: 'c6b77ba4-1eac-48f7-b213-457d577b6cf1' });
  });

  // Short ID detection
  it('detects a 6-char short_id', () => {
    const result = resolveTaskIdentifier({ identifier: 'hpiu09' });
    expect(result).toEqual({ type: 'short_id', value: 'hpiu09' });
  });

  it('detects short_id from short_id param', () => {
    const result = resolveTaskIdentifier({ short_id: 'kyk1y1' });
    expect(result).toEqual({ type: 'short_id', value: 'kyk1y1' });
  });

  it('detects a 7-char short_id', () => {
    const result = resolveTaskIdentifier({ identifier: 'abc1234' });
    expect(result).toEqual({ type: 'short_id', value: 'abc1234' });
  });

  // Title detection
  it('detects a title string', () => {
    const result = resolveTaskIdentifier({ identifier: 'Fix the login bug' });
    expect(result).toEqual({ type: 'title', value: 'Fix the login bug' });
  });

  it('detects title from title param', () => {
    const result = resolveTaskIdentifier({ title: 'Implement dark mode' });
    expect(result).toEqual({ type: 'title', value: 'Implement dark mode' });
  });

  it('detects title from name param', () => {
    const result = resolveTaskIdentifier({ name: 'Deploy to prod' });
    expect(result).toEqual({ type: 'title', value: 'Deploy to prod' });
  });

  // Accepts all param names LLMs might use
  it('accepts task_id param', () => {
    const result = resolveTaskIdentifier({ task_id: 'hpiu09' });
    expect(result).toEqual({ type: 'short_id', value: 'hpiu09' });
  });

  it('accepts id param', () => {
    const result = resolveTaskIdentifier({ id: 'c6b77ba4-1eac-48f7-b213-457d577b6cf1' });
    expect(result).toEqual({ type: 'uuid', value: 'c6b77ba4-1eac-48f7-b213-457d577b6cf1' });
  });

  // Edge cases
  it('returns undefined for empty args', () => {
    expect(resolveTaskIdentifier({})).toBeUndefined();
  });

  it('returns undefined for null/undefined', () => {
    expect(resolveTaskIdentifier(null)).toBeUndefined();
    expect(resolveTaskIdentifier(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(resolveTaskIdentifier({ identifier: '' })).toBeUndefined();
    expect(resolveTaskIdentifier({ identifier: '  ' })).toBeUndefined();
  });

  // Priority: issue_id > task_id > short_id > id > identifier > title > name
  it('prefers issue_id over other params', () => {
    const result = resolveTaskIdentifier({
      issue_id: 'c6b77ba4-1eac-48f7-b213-457d577b6cf1',
      short_id: 'hpiu09',
      title: 'Some task',
    });
    expect(result).toEqual({ type: 'uuid', value: 'c6b77ba4-1eac-48f7-b213-457d577b6cf1' });
  });
});
