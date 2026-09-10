import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Test to verify EventEmitter listener limits are not exceeded
describe('EventEmitter memory safety', () => {
  // Track original max listeners value
  const originalMaxListeners = process.getMaxListeners();

  beforeAll(() => {
    // Reset any changes made by previous tests
    process.setMaxListeners(originalMaxListeners);
  });

  afterAll(() => {
    // Restore original limit after test suite
    process.setMaxListeners(originalMaxListeners);
  });

  it('should not exceed EventEmitter max listener limits', () => {
    const MAX_SAFE_LISTENERS = 10;

    // Check current SIGINT/SIGTERM listeners count
    const sigintCount = process.listeners('SIGINT').length;
    const sigtermCount = process.listeners('SIGTERM').length;

    expect(sigintCount).toBeLessThanOrEqual(MAX_SAFE_LISTENERS);
    expect(sigtermCount).toBeLessThanOrEqual(MAX_SAFE_LISTENERS);
  });
});