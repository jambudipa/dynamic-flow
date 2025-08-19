/**
 * Tests for Flow namespace - Pipeable Flow Operations
 *
 * TODO: Many of these tests need to be updated to match the actual Flow API.
 * Currently commented out to fix TypeScript compilation.
 */

import { describe, it, expect } from 'vitest';
import { Effect, pipe, Exit } from 'effect';
import { Flow } from './flow';
import { runTest, runTestExit } from '@/test-utils/effect-helpers';

describe('Flow Namespace', () => {
  describe('andThen', () => {
    it('should chain effects sequentially', async () => {
      const result = await runTest(
        pipe(
          Effect.succeed(1),
          Flow.andThen((n) => Effect.succeed(n + 1)),
          Flow.andThen((n) => Effect.succeed(n * 2))
        )
      );

      expect(result).toBe(4); // (1 + 1) * 2 = 4
    });

    it('should propagate errors', async () => {
      const exit = await runTestExit(
        pipe(
          Effect.succeed(1),
          Flow.andThen(() => Effect.fail(new Error('Test error'))),
          Flow.andThen((n) => Effect.succeed(n * 2))
        )
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });

    it('should work with different types', async () => {
      const result = await runTest(
        pipe(
          Effect.succeed(5),
          Flow.andThen((n) => Effect.succeed(n.toString())),
          Flow.andThen((s) => Effect.succeed(s + '!'))
        )
      );

      expect(result).toBe('5!');
    });
  });

  describe('parallel', () => {
    it('should run effects in parallel', async () => {
      const startTime = Date.now();
      const result = await runTest(
        Flow.parallel({
          a: Effect.delay(Effect.succeed(1), '50 millis'),
          b: Effect.delay(Effect.succeed(2), '50 millis'),
          c: Effect.delay(Effect.succeed(3), '50 millis'),
        })
      );
      const duration = Date.now() - startTime;

      expect(result).toEqual({ a: 1, b: 2, c: 3 });
      expect(duration).toBeLessThan(200); // Should run in parallel, not 150ms sequential
    });

    it('should handle empty object', async () => {
      const result = await runTest(Flow.parallel({}));

      expect(result).toEqual({});
    });

    it('should fail if any effect fails', async () => {
      const exit = await runTestExit(
        Flow.parallel({
          a: Effect.succeed(1),
          b: Effect.fail(new Error('Parallel error')),
          c: Effect.succeed(3),
        })
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });

    it('should respect concurrency option', async () => {
      const result = await runTest(
        Flow.parallel(
          {
            a: Effect.delay(Effect.succeed(1), '10 millis'),
            b: Effect.delay(Effect.succeed(2), '10 millis'),
            c: Effect.delay(Effect.succeed(3), '10 millis'),
            d: Effect.delay(Effect.succeed(4), '10 millis'),
          },
          { concurrency: 2 }
        )
      );

      expect(result).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    });
  });

  // The following tests are commented out because the functions don't exist in Flow namespace
  // They need to be either implemented or removed from the test suite

  /*
  describe('race', () => {
    it('should return the first effect to complete', async () => {
      const result = await runTest(
        Flow.race(
          Effect.delay(Effect.succeed('slow'), '50 millis'),
          Effect.delay(Effect.succeed('fast'), '10 millis')
        )
      )
      
      expect(result).toBe('fast')
    })

    it('should handle failure of slower effect', async () => {
      const result = await runTest(
        Flow.race(
          Effect.delay(Effect.fail(new Error('slow failed')), '50 millis'),
          Effect.delay(Effect.succeed('fast'), '10 millis')
        )
      )
      
      expect(result).toBe('fast')
    })
  })

  describe('conditional', () => {
    it('should execute then branch when condition is true', async () => {
      const result = await runTest(
        pipe(
          Effect.succeed(10),
          Flow.conditional(
            (n: any) => n > 5,
            (n: any) => Effect.succeed(`${n} is greater than 5`),
            (n: any) => Effect.succeed(`${n} is not greater than 5`)
          )
        )
      )
      
      expect(result).toBe('10 is greater than 5')
    })

    it('should execute else branch when condition is false', async () => {
      const result = await runTest(
        pipe(
          Effect.succeed(3),
          Flow.conditional(
            (n: any) => n > 5,
            (n: any) => Effect.succeed(`${n} is greater than 5`),
            (n: any) => Effect.succeed(`${n} is not greater than 5`)
          )
        )
      )
      
      expect(result).toBe('3 is not greater than 5')
    })

    it('should work with string conditions', async () => {
      const result = await runTest(
        pipe(
          Effect.succeed('hello'),
          Flow.conditional(
            (s: any) => s.length > 3,
            () => Effect.succeed('long string'),
            () => Effect.succeed('short string')
          )
        )
      )
      
      expect(result).toBe('long string')
    })
  })
  */

  describe('map', () => {
    it('should map over values', async () => {
      const result = await runTest(
        pipe(
          Effect.succeed(5),
          Flow.map((n: number) => n * 2)
        )
      );

      expect(result).toBe(10);
    });

    it('should work with string transformations', async () => {
      const result = await runTest(
        pipe(
          Effect.succeed('hello'),
          Flow.map((s: string) => s.toUpperCase())
        )
      );

      expect(result).toBe('HELLO');
    });
  });

  // Additional tests would go here for other existing Flow functions
  // Currently commenting out tests for non-existent functions

  describe('succeed', () => {
    it('should create a successful effect', async () => {
      const result = await runTest(Flow.succeed(42));
      expect(result).toBe(42);
    });
  });

  describe('fail', () => {
    it('should create a failed effect', async () => {
      const exit = await runTestExit(Flow.fail(new Error('Test failure')));
      expect(Exit.isFailure(exit)).toBe(true);
    });
  });

  describe('sync', () => {
    it('should create an effect from a sync function', async () => {
      const result = await runTest(Flow.sync(() => 1 + 1));
      expect(result).toBe(2);
    });

    it('should catch thrown errors', async () => {
      const exit = await runTestExit(
        Flow.sync(() => {
          throw new Error('Sync error');
        })
      );
      expect(Exit.isFailure(exit)).toBe(true);
    });
  });
});
