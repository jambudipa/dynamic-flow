/**
 * Effect Logging - Structured logging utilities for DynamicFlow.
 * Provides Effect-based logging with proper context and structure.
 */

import {
  Array as EffectArray,
  Effect,
  List,
  Logger,
  LogLevel,
  pipe,
} from 'effect';

// ============= Log Level Configuration =============

/**
 * Available log levels in order of severity.
 */
export const LOG_LEVELS = {
  TRACE: LogLevel.Trace,
  DEBUG: LogLevel.Debug,
  INFO: LogLevel.Info,
  WARN: LogLevel.Warning,
  ERROR: LogLevel.Error,
  FATAL: LogLevel.Fatal,
} as const;

// ============= Structured Log Context =============

/**
 * Context for structured logging.
 */
export interface LogContext {
  readonly module?: string;
  readonly operation?: string;
  readonly flowId?: string | undefined;
  readonly stepId?: string | undefined;
  readonly toolName?: string;
  readonly duration?: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Error context for error logging.
 */
export interface ErrorLogContext extends LogContext {
  readonly error: unknown;
  readonly stack?: string;
  readonly cause?: unknown;
}

// ============= Core Logging Functions =============

/**
 * Create a structured log message with context.
 */
const createLogMessage = (message: string, context?: LogContext): string => {
  const parts: string[] = [];

  if (context?.module) {
    parts.push(`[${context.module}]`);
  }

  if (context?.operation) {
    parts.push(`${context.operation}:`);
  }

  parts.push(message);

  // Add additional context
  const contextParts: string[] = [];

  if (context?.flowId) {
    contextParts.push(`flowId=${context.flowId}`);
  }

  if (context?.stepId) {
    contextParts.push(`stepId=${context.stepId}`);
  }

  if (context?.toolName) {
    contextParts.push(`tool=${context.toolName}`);
  }

  if (context?.duration !== undefined) {
    contextParts.push(`duration=${context.duration}ms`);
  }

  if (contextParts.length > 0) {
    parts.push(`(${contextParts.join(', ')})`);
  }

  return parts.join(' ');
};

/**
 * Log at trace level with structured context.
 */
export const logTrace = (
  message: string,
  context?: LogContext
): Effect.Effect<void> => Effect.log(createLogMessage(message, context));

/**
 * Log at debug level with structured context.
 */
export const logDebug = (
  message: string,
  context?: LogContext
): Effect.Effect<void> => Effect.log(createLogMessage(message, context));

/**
 * Log at info level with structured context.
 */
export const logInfo = (
  message: string,
  context?: LogContext
): Effect.Effect<void> => Effect.log(createLogMessage(message, context));

/**
 * Log at warning level with structured context.
 */
export const logWarn = (
  message: string,
  context?: LogContext
): Effect.Effect<void> => Effect.log(createLogMessage(message, context));

/**
 * Log at error level with structured context and error details.
 */
export const logError = (
  message: string,
  context?: ErrorLogContext
): Effect.Effect<void> => {
  let errorMessage = createLogMessage(message, context);

  if (context?.error) {
    if (context.error instanceof Error) {
      errorMessage += ` | Error: ${context.error.message}`;
      if (context.error.stack) {
        errorMessage += ` | Stack: ${context.error.stack}`;
      }
    } else if (
      typeof context.error === 'object' &&
      context.error !== null &&
      '_tag' in context.error
    ) {
      errorMessage += ` | TaggedError: ${(context.error as any)._tag} - ${JSON.stringify(context.error)}`;
    } else {
      errorMessage += ` | Error: ${String(context.error)}`;
    }
  }

  if (context?.cause) {
    errorMessage += ` | Cause: ${String(context.cause)}`;
  }

  return Effect.log(errorMessage);
};

/**
 * Log at fatal level with structured context and error details.
 */
export const logFatal = (
  message: string,
  context?: ErrorLogContext
): Effect.Effect<void> => {
  let errorMessage = createLogMessage(message, context);

  if (context?.error) {
    if (context.error instanceof Error) {
      errorMessage += ` | Error: ${context.error.message}`;
      if (context.error.stack) {
        errorMessage += ` | Stack: ${context.error.stack}`;
      }
    } else if (
      typeof context.error === 'object' &&
      context.error !== null &&
      '_tag' in context.error
    ) {
      errorMessage += ` | TaggedError: ${(context.error as any)._tag} - ${JSON.stringify(context.error)}`;
    } else {
      errorMessage += ` | Error: ${String(context.error)}`;
    }
  }

  return Effect.log(errorMessage);
};

// ============= Logging Combinators =============

/**
 * Log the start of an operation.
 */
export const logStart = (
  operation: string,
  context?: LogContext
): Effect.Effect<void> => logInfo(`Starting ${operation}`, context);

/**
 * Log the completion of an operation with duration.
 */
export const logComplete = (
  operation: string,
  startTime: number,
  context?: LogContext
): Effect.Effect<void> => {
  const duration = Date.now() - startTime;
  return logInfo(`Completed ${operation}`, {
    ...context,
    duration,
  });
};

/**
 * Log the failure of an operation.
 */
export const logFailure = (
  operation: string,
  error: unknown,
  context?: LogContext
): Effect.Effect<void> =>
  logError(`Failed ${operation}`, {
    ...context,
    error,
  });

/**
 * Wrap an effect with start/complete/failure logging.
 */
export const withOperationLogging = <A, E, R>(
  operation: string,
  effect: Effect.Effect<A, E, R>,
  context?: LogContext
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const startTime = Date.now();

    yield* logStart(operation, context);

    return yield* pipe(
      effect,
      Effect.tap(() => logComplete(operation, startTime, context)),
      Effect.tapError((error) => logFailure(operation, error, context))
    );
  });

/**
 * Log the input and output of an effect.
 */
export const withIOLogging = <A, E, R>(
  operation: string,
  effect: Effect.Effect<A, E, R>,
  options?: {
    logInput?: boolean;
    logOutput?: boolean;
    context?: LogContext;
  }
): Effect.Effect<A, E, R> =>
  pipe(
    effect,
    Effect.tap((result) => {
      if (options?.logOutput !== false) {
        return logDebug(`${operation} output`, {
          ...options?.context,
          metadata: { output: result },
        });
      }
      return Effect.void;
    }),
    Effect.tapError((error) =>
      logError(`${operation} error`, {
        ...options?.context,
        error,
      })
    )
  );

/**
 * Log performance metrics for an effect.
 */
export const withPerformanceLogging = <A, E, R>(
  operation: string,
  effect: Effect.Effect<A, E, R>,
  context?: LogContext
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const startTime = performance.now();
    const startMemory = process.memoryUsage();

    const result = yield* effect;

    const endTime = performance.now();
    const endMemory = process.memoryUsage();
    const duration = endTime - startTime;
    const memoryDelta = endMemory.heapUsed - startMemory.heapUsed;

    yield* logDebug(`Performance metrics for ${operation}`, {
      ...context,
      metadata: {
        duration: `${duration.toFixed(2)}ms`,
        memoryDelta: `${(memoryDelta / 1024 / 1024).toFixed(2)}MB`,
        heapUsed: `${(endMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`,
      },
    });

    return result;
  });

// ============= Flow-Specific Logging =============

/**
 * Create a flow context for logging.
 */
export const createFlowContext = (
  flowId: string,
  module?: string
): LogContext => ({
  module: module || 'Flow',
  flowId,
});

/**
 * Create a step context for logging.
 */
export const createStepContext = (
  flowId: string,
  stepId: string,
  module?: string
): LogContext => ({
  module: module || 'Flow',
  flowId,
  stepId,
});

/**
 * Create a tool context for logging.
 */
export const createToolContext = (
  toolName: string,
  flowId?: string,
  stepId?: string
): LogContext => ({
  module: 'Tool',
  toolName,
  flowId,
  stepId,
});

/**
 * Log flow execution start.
 */
export const logFlowStart = (
  flowId: string,
  flowType?: string
): Effect.Effect<void> =>
  logInfo(`Starting flow execution`, {
    module: 'Flow',
    operation: 'execute',
    flowId,
    metadata: { flowType },
  });

/**
 * Log flow execution completion.
 */
export const logFlowComplete = (
  flowId: string,
  startTime: number,
  result?: unknown
): Effect.Effect<void> => {
  const duration = Date.now() - startTime;
  return logInfo(`Flow execution completed`, {
    module: 'Flow',
    operation: 'execute',
    flowId,
    duration,
    metadata: { resultType: typeof result },
  });
};

/**
 * Log flow execution failure.
 */
export const logFlowFailure = (
  flowId: string,
  error: unknown,
  startTime?: number
): Effect.Effect<void> => {
  const baseContext = {
    module: 'Flow',
    operation: 'execute',
    flowId,
    error,
  } as const;

  const contextWithDuration = startTime
    ? { ...baseContext, duration: Date.now() - startTime }
    : baseContext;

  return logError(`Flow execution failed`, contextWithDuration);
};

/**
 * Log step execution.
 */
export const logStepExecution = (
  stepId: string,
  stepType: string,
  flowId?: string
): Effect.Effect<void> =>
  logDebug(`Executing step`, {
    module: 'Flow',
    operation: 'executeStep',
    flowId,
    stepId,
    metadata: { stepType },
  });

/**
 * Log tool invocation.
 */
export const logToolInvocation = (
  toolName: string,
  input?: unknown,
  flowId?: string,
  stepId?: string
): Effect.Effect<void> =>
  logDebug(`Invoking tool`, {
    module: 'Tool',
    operation: 'invoke',
    toolName,
    flowId,
    stepId,
    metadata: { inputType: typeof input },
  });

/**
 * Log tool completion.
 */
export const logToolCompletion = (
  toolName: string,
  startTime: number,
  result?: unknown,
  flowId?: string,
  stepId?: string
): Effect.Effect<void> => {
  const duration = Date.now() - startTime;
  return logDebug(`Tool completed`, {
    module: 'Tool',
    operation: 'invoke',
    toolName,
    flowId,
    stepId,
    duration,
    metadata: { resultType: typeof result },
  });
};

// ============= Logger Configuration =============

/**
 * Create a structured logger for DynamicFlow.
 */
export const createFlowLogger = (
  level: LogLevel.LogLevel = LogLevel.Info
): Logger.Logger<string, void> =>
  Logger.make(({ logLevel, message, spans }) => {
    const timestamp = new Date().toISOString();
    const levelStr = String(logLevel).toUpperCase();
    const spanInfo =
      List.size(spans) > 0
        ? ` [${EffectArray.fromIterable(spans)
            .map((s) => s.label)
            .join(' > ')}]`
        : '';

    console.log(`${timestamp} ${levelStr}${spanInfo} ${message}`);
  });

/**
 * Default logger with INFO level.
 */
export const defaultLogger = createFlowLogger(LogLevel.Info);

/**
 * Debug logger with DEBUG level.
 */
export const debugLogger = createFlowLogger(LogLevel.Debug);

/**
 * Production logger with WARN level.
 */
export const productionLogger = createFlowLogger(LogLevel.Warning);
