import { describe, it, expect } from 'vitest';
import { isVersionNewer } from '../src/update-checker.js';

describe('isVersionNewer', () => {
  it('returns true when latest is a higher patch', () => {
    expect(isVersionNewer('0.1.79', '0.1.78')).toBe(true);
  });

  it('returns true when latest is a higher minor', () => {
    expect(isVersionNewer('0.2.0', '0.1.99')).toBe(true);
  });

  it('returns true when latest is a higher major', () => {
    expect(isVersionNewer('1.0.0', '0.99.99')).toBe(true);
  });

  it('returns false when versions are equal', () => {
    expect(isVersionNewer('0.1.79', '0.1.79')).toBe(false);
  });

  it('returns false when current is ahead of latest (stale cache scenario)', () => {
    // Regression test: 0.1.80 published, but cache still has 0.1.78 as "latest".
    // Old code used !== and showed a backwards "update available" message.
    expect(isVersionNewer('0.1.78', '0.1.79')).toBe(false);
  });

  it('handles missing segments as 0', () => {
    expect(isVersionNewer('0.2', '0.1.99')).toBe(true);
    expect(isVersionNewer('1', '0.99.99')).toBe(true);
  });

  it('handles non-numeric segments as 0 (defensive)', () => {
    expect(isVersionNewer('0.1.79', '0.1.79-beta')).toBe(false);
    expect(isVersionNewer('0.1.80', '0.1.79-beta')).toBe(true);
  });
});
