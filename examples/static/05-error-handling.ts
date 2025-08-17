/**
 * Example: Error Handling
 *
 * Demonstrates comprehensive error handling strategies with typed errors,
 * recovery mechanisms, and graceful degradation patterns.
 *
 * Features demonstrated:
 * - Tagged error types for type-safe error handling
 * - Flow.catchAll for comprehensive error recovery
 * - Discriminated unions for error categorisation
 * - Graceful fallback mechanisms
 * - Structured error reporting
 *
 * Performance characteristics:
 * - Fast error propagation: O(1) error handling
 * - Memory efficient: No error stack accumulation
 * - Type-safe: Compile-time error type checking
 *
 * Expected console output:
 * ```
 * Test: Successful order
 * ✅ Order processed for User 123
 * Result: { user: {...}, payment: {...} }
 *
 * Test: Invalid user ID
 * ⚠️ Validation failed: userId = 0
 * Result: { status: 'validation_failed', error: 'Invalid userId', fallback: true }
 *
 * Test: Network timeout
 * 🌐 Network error: Connection timeout (code: 504)
 * Result: { status: 'network_error', error: 'Connection timeout', retryable: true }
 * ```
 *
 * Return value: Promise<(OrderSuccess | OrderErrorResult)[]>
 *
 * Run: npx tsx examples/static/05-error-handling.ts
 */

import { Effect, Flow, pipe } from '../../src/index';
import { Stream } from 'effect';

// Domain types
interface User {
  id: number;
  name: string;
  email: string;
}

interface Payment {
  transactionId: string;
  amount: number;
  status: 'completed';
}

type OrderSuccess = { user: User; payment: Payment };
type ValidationFailed = { status: 'validation_failed'; error: string; fallback: true };
type NetworkErrorResult = { status: 'network_error'; error: string; fallback: true; retryable: true };
type BusinessErrorResult = { status: 'business_error'; error: string; fallback: true };
type UnknownErrorResult = { status: 'unknown_error'; error: string; fallback: true };
type OrderErrorResult = ValidationFailed | NetworkErrorResult | BusinessErrorResult | UnknownErrorResult;

// Define custom error types
class NetworkError {
  readonly _tag = 'NetworkError';

  constructor(readonly message: string, readonly code?: number) {
  }
}

class ValidationError {
  readonly _tag = 'ValidationError';

  constructor(readonly field: string, readonly value: unknown) {
  }
}

class BusinessError {
  readonly _tag = 'BusinessError';

  constructor(readonly reason: string) {
  }
}

// Mock functions that might fail
const fetchUserData = (
  userId: number
): Effect.Effect<User, ValidationError | NetworkError, never> => {
  if (userId === 0) {
    return Effect.fail(new ValidationError('userId', userId));
  }
  if (userId === 999) {
    return Effect.fail(new NetworkError('Connection timeout', 504));
  }
  return Effect.succeed<User>({
    id: userId,
    name: `User ${userId}`,
    email: `user${userId}@example.com`
  });
};

const validateEmail = (email: string): Effect.Effect<string, ValidationError, never> => {
  if (!email.includes('@')) {
    return Effect.fail(new ValidationError('email', email));
  }
  return Effect.succeed(email);
};

const processPayment = (amount: number): Effect.Effect<Payment, BusinessError, never> => {
  if (amount <= 0) {
    return Effect.fail(new BusinessError('Invalid payment amount'));
  }
  if (amount > 10000) {
    return Effect.fail(new BusinessError('Amount exceeds limit'));
  }
  return Effect.succeed<Payment>({
    transactionId: Math.random().toString(36).substring(2, 11),
    amount,
    status: 'completed'
  });
};

// Create a flow with comprehensive error handling
const processOrder = (
  userId: number,
  amount: number
): Effect.Effect<
  OrderSuccess | ValidationFailed | NetworkErrorResult | BusinessErrorResult | UnknownErrorResult,
  never,
  never
> => pipe(
  // Fetch user data (might fail)
  fetchUserData(userId),

  // Validate email (might fail)
  Flow.andThen((user: User) => pipe(
    validateEmail(user.email),
    Flow.map(() => user)
  )),

  // Process payment (might fail)
  Flow.andThen((user: User) => pipe(
    processPayment(amount),
    Flow.map((payment: Payment): OrderSuccess => ({ user, payment }))
  )),

  // Log success
  Flow.tap((result: OrderSuccess) => Effect.sync(() => {
    console.log(`✅ Order processed for ${result.user.name}`);
    console.log(`   Transaction: ${result.payment.transactionId}`);
  })),

  // Handle error types with a discriminated union
  Flow.catchAll((error: ValidationError | NetworkError | BusinessError): Effect.Effect<OrderErrorResult, never, never> => {
    switch (error._tag) {
      case 'ValidationError':
        return Effect.sync<OrderErrorResult>(() => {
          console.log(`⚠️  Validation failed: ${error.field} = ${JSON.stringify(error.value)}`);
          return {
            status: 'validation_failed' as const,
            error: `Invalid ${error.field}`,
            fallback: true as const
          };
        });
      case 'NetworkError':
        return Effect.sync<OrderErrorResult>(() => {
          console.log(`🌐 Network error: ${error.message} (code: ${error.code})`);
          return {
            status: 'network_error' as const,
            error: error.message,
            fallback: true as const,
            retryable: true as const
          };
        });
      case 'BusinessError':
        return Effect.sync<OrderErrorResult>(() => {
          console.log(`💼 Business rule violation: ${error.reason}`);
          return {
            status: 'business_error' as const,
            error: error.reason,
            fallback: true as const
          };
        });
    }
  })
);

/**
 * Programmatic example runner for testing and integration
 */
export async function runExample(): Promise<(OrderSuccess | OrderErrorResult)[]> {
  console.log('=== Error Handling Example ===\n');

  const testCases = [
    { name: 'Successful order', userId: 123, amount: 99.99 },
    { name: 'Invalid user ID', userId: 0, amount: 50 },
    { name: 'Network timeout', userId: 999, amount: 50 },
    { name: 'Invalid amount', userId: 123, amount: -10 },
    { name: 'Amount too large', userId: 123, amount: 15000 }
  ];

  const results: (OrderSuccess | OrderErrorResult)[] = [];

  for (const testCase of testCases) {
    console.log(`Test: ${testCase.name}`);
    console.log('-'.repeat(40));

    try {
      // Sync collect
      const result = await Effect.runPromise(processOrder(testCase.userId, testCase.amount));
      console.log('— Sync (collect) —');
      console.log('Result:', result);
      results.push(result);

      // Streaming (single emission)
      console.log('— Streaming —');
      await Stream.runForEach(
        Stream.fromEffect(processOrder(testCase.userId, testCase.amount)),
        (value) => Effect.sync(() => console.log('📤 Stream result:', value))
      ).pipe(Effect.runPromise);

      console.log('='.repeat(50) + '\n');
    } catch (error) {
      console.error('❌ Unexpected error:', error);
      throw error;
    }
  }

  console.log('✅ All error handling scenarios completed!');
  return results;
}

// Run the example when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExample().catch(console.error);
}


/**
 * Expected Output:
 * ===============
 *
 * === Error Handling Example ===
 *
 * Test: Successful order
 * ----------------------------------------
 * ✅ Order processed for User 123
 *    Transaction: x6u38uab4
 * — Sync (collect) —
 * Result: {
 *   user: { id: 123, name: "User 123", email: "user123@example.com" },
 *   payment: { transactionId: "x6u38uab4", amount: 99.99, status: "completed" }
 * }
 * — Streaming —
 * ✅ Order processed for User 123
 *    Transaction: gukkajqxg
 * 📤 Stream result: {
 *   user: { id: 123, name: "User 123", email: "user123@example.com" },
 *   payment: { transactionId: "gukkajqxg", amount: 99.99, status: "completed" }
 * }
 * ==================================================
 *
 * Test: Invalid user ID
 * ----------------------------------------
 * ⚠️  Validation failed: userId = 0
 * — Sync (collect) —
 * Result: {
 *   status: "validation_failed",
 *   error: "Invalid userId",
 *   fallback: true
 * }
 * — Streaming —
 * ⚠️  Validation failed: userId = 0
 * 📤 Stream result: {
 *   status: "validation_failed",
 *   error: "Invalid userId",
 *   fallback: true
 * }
 * ==================================================
 *
 * Test: Network timeout
 * ----------------------------------------
 * 🌐 Network error: Connection timeout (code: 504)
 * — Sync (collect) —
 * Result: {
 *   status: "network_error",
 *   error: "Connection timeout",
 *   fallback: true,
 *   retryable: true
 * }
 * — Streaming —
 * 🌐 Network error: Connection timeout (code: 504)
 * 📤 Stream result: {
 *   status: "network_error",
 *   error: "Connection timeout",
 *   fallback: true,
 *   retryable: true
 * }
 * ==================================================
 *
 * Test: Invalid amount
 * ----------------------------------------
 * 💼 Business rule violation: Invalid payment amount
 * — Sync (collect) —
 * Result: {
 *   status: "business_error",
 *   error: "Invalid payment amount",
 *   fallback: true
 * }
 * — Streaming —
 * 💼 Business rule violation: Invalid payment amount
 * 📤 Stream result: {
 *   status: "business_error",
 *   error: "Invalid payment amount",
 *   fallback: true
 * }
 * ==================================================
 *
 * Test: Amount too large
 * ----------------------------------------
 * 💼 Business rule violation: Amount exceeds limit
 * — Sync (collect) —
 * Result: {
 *   status: "business_error",
 *   error: "Amount exceeds limit",
 *   fallback: true
 * }
 * — Streaming —
 * 💼 Business rule violation: Amount exceeds limit
 * 📤 Stream result: {
 *   status: "business_error",
 *   error: "Amount exceeds limit",
 *   fallback: true
 * }
 * ==================================================
 *
 * ✅ All error handling scenarios completed\!
 */
