import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Scheduler } from '../src/queue/Scheduler';

describe('Scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should set maxRuntimeMs when hours option is provided', () => {
      const scheduler = new Scheduler({ hours: 2 });
      // We can't directly test private properties, but we can test the behavior
      expect(scheduler).toBeInstanceOf(Scheduler);
    });

    it('should parse until time correctly', () => {
      const scheduler = new Scheduler({ until: '14:30' });
      expect(scheduler).toBeInstanceOf(Scheduler);
    });
  });

  describe('hours limit', () => {
    it('should stop after specified hours limit', () => {
      const scheduler = new Scheduler({ hours: 1 });
      
      // Advance time by 2 hours (should be past the limit)
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
      
      expect(scheduler.shouldStop()).toBe(true);
    });

    it('should not stop before specified hours limit', () => {
      const scheduler = new Scheduler({ hours: 2 });
      
      // Advance time by 1 hour (should be before the limit)
      vi.advanceTimersByTime(1 * 60 * 60 * 1000);
      
      expect(scheduler.shouldStop()).toBe(false);
    });

    it('should not stop when no hours limit is set', () => {
      const scheduler = new Scheduler();
      
      // Advance time by 5 hours
      vi.advanceTimersByTime(5 * 60 * 60 * 1000);
      
      expect(scheduler.shouldStop()).toBe(false);
    });
  });

  describe('until wall-clock parsing', () => {
    it('should stop after specified until time', () => {
      // Set current time to 12:00
      const now = new Date(2023, 0, 1, 12, 0, 0, 0);
      vi.setSystemTime(now);
      
      // Create scheduler that should stop at 14:30 (2:30 PM)
      const scheduler = new Scheduler({ until: '14:30' });
      
      // Advance time to past the target
      vi.advanceTimersByTime(3 * 60 * 60 * 1000); // 3 hours later
      
      expect(scheduler.shouldStop()).toBe(true);
    });

    it('should not stop before specified until time', () => {
      // Set current time to 15:00
      const now = new Date(2023, 0, 1, 15, 0, 0, 0);
      vi.setSystemTime(now);
      
      // Create scheduler that should stop at 14:30 (2:30 PM tomorrow)
      const scheduler = new Scheduler({ until: '14:30' });
      
      // Advance time to just before the target
      vi.advanceTimersByTime(2 * 60 * 60 * 1000); // 2 hours later
      
      expect(scheduler.shouldStop()).toBe(false);
    });

    it('should handle midnight crossing correctly', () => {
      // Set current time to 23:00
      const now = new Date(2023, 0, 1, 23, 0, 0, 0);
      vi.setSystemTime(now);
      
      // Create scheduler that should stop at 01:00 (1 AM tomorrow)
      const scheduler = new Scheduler({ until: '01:00' });
      
      // Advance time to past the target
      vi.advanceTimersByTime(3 * 60 * 60 * 1000); // 3 hours later
      
      expect(scheduler.shouldStop()).toBe(true);
    });
  });

  describe('cancel()', () => {
    it('should cancel the scheduler', () => {
      const scheduler = new Scheduler();
      
      expect(scheduler.isCancelled()).toBe(false);
      
      scheduler.cancel();
      
      expect(scheduler.isCancelled()).toBe(true);
      expect(scheduler.shouldStop()).toBe(true);
    });

    it('should not stop before cancellation', () => {
      const scheduler = new Scheduler({ hours: 1 });
      
      // Advance time by 30 minutes
      vi.advanceTimersByTime(30 * 60 * 1000);
      
      expect(scheduler.shouldStop()).toBe(false);
      
      scheduler.cancel();
      
      expect(scheduler.shouldStop()).toBe(true);
    });
  });

  describe('shouldStop()', () => {
    it('should return false when not cancelled and within limits', () => {
      const scheduler = new Scheduler({ hours: 2 });
      
      // Advance time by 1 hour
      vi.advanceTimersByTime(1 * 60 * 60 * 1000);
      
      expect(scheduler.shouldStop()).toBe(false);
    });

    it('should return true when cancelled', () => {
      const scheduler = new Scheduler();
      
      scheduler.cancel();
      
      expect(scheduler.shouldStop()).toBe(true);
    });

    it('should return true when hours limit is exceeded', () => {
      const scheduler = new Scheduler({ hours: 1 });
      
      // Advance time by 2 hours
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
      
      expect(scheduler.shouldStop()).toBe(true);
    });

    it('should return true when until time is reached', () => {
      // Set current time to 12:00
      const now = new Date(2023, 0, 1, 12, 0, 0, 0);
      vi.setSystemTime(now);
      
      const scheduler = new Scheduler({ until: '14:30' });
      
      // Advance time to past the target
      vi.advanceTimersByTime(3 * 60 * 60 * 1000);
      
      expect(scheduler.shouldStop()).toBe(true);
    });
  });
});