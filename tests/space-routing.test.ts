import { describe, it, expect } from 'vitest';
import { buildRoutingHint } from '../src/space-routing';

describe('buildRoutingHint', () => {
  it('returns null when there are fewer than 2 spaces to route to', () => {
    expect(buildRoutingHint([])).toBeNull();
    expect(buildRoutingHint(['Only One'])).toBeNull();
  });

  it('lists the available space names and tells the agent to pass space:', () => {
    const hint = buildRoutingHint(['Social Page', '2FA', 'Getaways']);
    expect(hint).not.toBeNull();
    expect(hint).toContain('space:');
    expect(hint).toContain('Social Page');
    expect(hint).toContain('2FA');
    expect(hint).toContain('Getaways');
    expect(hint).toContain('memory_move_item');
  });

  it('caps the number of names shown and marks the overflow', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Space ${i + 1}`);
    const hint = buildRoutingHint(many, 8)!;
    expect(hint).toContain('Space 1');
    expect(hint).toContain('Space 8');
    expect(hint).not.toContain('Space 9');
    expect(hint).toContain('…');
  });
});
