/**
 * LoggingService - Structured logging service
 * Replaces console.log/error with proper Effect logging
 */

import { Effect, Context, Layer, Console, Logger, LogLevel, pipe } from 'effect';
import { ConfigService } from './config';

// ============= Log Levels =============

export type LogLevelType = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const logLevelMap: Record<LogLevelType, LogLevel.LogLevel> = {
  trace: LogLevel.Trace,
  debug: LogLevel.Debug,
  info: LogLevel.Info,
  warn: LogLevel.Warning,
  error: LogLevel.Error,
};

// ============= Log Entry Schema =============

export interface LogEntry {
  readonly level: LogLevelType;
  readonly message: string;
  readonly timestamp: Date;
  readonly context?: Record<string, unknown>;
  readonly error?: unknown;
  readonly trace?: string;
}

// ============= LoggingService Interface =============

export interface LoggingService {
  /**
   * Log a message at the specified level
   */
  readonly log: (
    level: LogLevelType,
    message: string,
    context?: Record<string, unknown>
  ) => Effect.Effect<void>;
  
  /**
   * Log a trace message
   */
  readonly trace: (message: string, context?: Record<string, unknown>) => Effect.Effect<void>;
  
  /**
   * Log a debug message
   */
  readonly debug: (message: string, context?: Record<string, unknown>) => Effect.Effect<void>;
  
  /**
   * Log an info message
   */
  readonly info: (message: string, context?: Record<string, unknown>) => Effect.Effect<void>;
  
  /**
   * Log a warning message
   */
  readonly warn: (message: string, context?: Record<string, unknown>) => Effect.Effect<void>;
  
  /**
   * Log an error message
   */
  readonly error: (
    message: string,
    error?: unknown,
    context?: Record<string, unknown>
  ) => Effect.Effect<void>;
  
  /**
   * Create a child logger with additional context
   */
  readonly withContext: (
    context: Record<string, unknown>
  ) => LoggingService;
  
  /**
   * Log with performance timing
   */
  readonly timed: <A, E>(
    label: string,
    effect: Effect.Effect<A, E>
  ) => Effect.Effect<A, E>;
}

// ============= Context Tag =============

export const LoggingService = Context.GenericTag<LoggingService>('@services/Logging');

// ============= Formatters =============

const formatJson = (entry: LogEntry): string => {
  const json: Record<string, unknown> = {
    level: entry.level,
    message: entry.message,
    timestamp: entry.timestamp.toISOString(),
  };
  
  if (entry.context) {
    json.context = entry.context;
  }
  
  if (entry.error) {
    if (entry.error instanceof Error) {
      json.error = {
        name: entry.error.name,
        message: entry.error.message,
        stack: entry.error.stack,
      };
    } else {
      json.error = entry.error;
    }
  }
  
  if (entry.trace) {
    json.trace = entry.trace;
  }
  
  return JSON.stringify(json);
};

const formatText = (entry: LogEntry): string => {
  const timestamp = entry.timestamp.toISOString();
  const level = entry.level.toUpperCase().padEnd(5);
  let message = `[${timestamp}] ${level} ${entry.message}`;
  
  if (entry.context && Object.keys(entry.context).length > 0) {
    message += ` ${JSON.stringify(entry.context)}`;
  }
  
  if (entry.error) {
    if (entry.error instanceof Error) {
      message += `\n  Error: ${entry.error.message}`;
      if (entry.error.stack) {
        message += `\n  Stack: ${entry.error.stack}`;
      }
    } else {
      message += `\n  Error: ${JSON.stringify(entry.error)}`;
    }
  }
  
  if (entry.trace) {
    message += `\n  Trace: ${entry.trace}`;
  }
  
  return message;
};

// ============= Output Handlers =============

const outputToConsole = (entry: LogEntry, format: 'json' | 'text'): Effect.Effect<void> => {
  const formatted = format === 'json' ? formatJson(entry) : formatText(entry);
  
  switch (entry.level) {
    case 'error':
      return Console.error(formatted);
    case 'warn':
      return Console.warn(formatted);
    case 'info':
      return Console.log(formatted);
    case 'debug':
    case 'trace':
      return Console.debug(formatted);
    default:
      return Console.log(formatted);
  }
};

// ============= Service Implementation =============

const makeLoggingService = (
  minLevel: LogLevelType,
  format: 'json' | 'text',
  baseContext?: Record<string, unknown>
): LoggingService => {
  const shouldLog = (level: LogLevelType): boolean => {
    const levels: LogLevelType[] = ['trace', 'debug', 'info', 'warn', 'error'];
    const minIndex = levels.indexOf(minLevel);
    const levelIndex = levels.indexOf(level);
    return levelIndex >= minIndex;
  };
  
  const createLogEntry = (
    level: LogLevelType,
    message: string,
    context?: Record<string, unknown>,
    error?: unknown
  ): LogEntry => ({
    level,
    message,
    timestamp: new Date(),
    context: baseContext ? { ...baseContext, ...context } : context,
    error,
    trace: level === 'trace' ? new Error().stack : undefined,
  });
  
  const logMessage = (
    level: LogLevelType,
    message: string,
    context?: Record<string, unknown>,
    error?: unknown
  ): Effect.Effect<void> => {
    if (!shouldLog(level)) {
      return Effect.void;
    }
    
    const entry = createLogEntry(level, message, context, error);
    return outputToConsole(entry, format);
  };
  
  return {
    log: (level, message, context) => logMessage(level, message, context),
    
    trace: (message, context) => logMessage('trace', message, context),
    
    debug: (message, context) => logMessage('debug', message, context),
    
    info: (message, context) => logMessage('info', message, context),
    
    warn: (message, context) => logMessage('warn', message, context),
    
    error: (message, error, context) => logMessage('error', message, context, error),
    
    withContext: (additionalContext) =>
      makeLoggingService(
        minLevel,
        format,
        baseContext ? { ...baseContext, ...additionalContext } : additionalContext
      ),
    
    timed: <A, E>(label: string, effect: Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const startTime = Date.now();
        
        yield* logMessage('debug', `${label} started`, { label });
        
        const result = yield* pipe(
          effect,
          Effect.tap(() => {
            const duration = Date.now() - startTime;
            return logMessage('info', `${label} completed`, { label, duration });
          }),
          Effect.tapError((error) => {
            const duration = Date.now() - startTime;
            return logMessage('error', `${label} failed`, { label, duration }, error);
          })
        );
        
        return result;
      }),
  };
};

// ============= Layer Implementations =============

/**
 * Live implementation that uses configuration
 */
export const LoggingServiceLive = Layer.effect(
  LoggingService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const loggingConfig = yield* config.get('logging');
    
    return makeLoggingService(
      loggingConfig.level,
      loggingConfig.format
    );
  })
);

/**
 * Test implementation with custom settings
 */
export const LoggingServiceTest = (
  level: LogLevelType = 'debug',
  format: 'json' | 'text' = 'text'
) =>
  Layer.succeed(
    LoggingService,
    makeLoggingService(level, format)
  );

/**
 * Silent implementation for testing
 */
export const LoggingServiceSilent = Layer.succeed(
  LoggingService,
  {
    log: () => Effect.void,
    trace: () => Effect.void,
    debug: () => Effect.void,
    info: () => Effect.void,
    warn: () => Effect.void,
    error: () => Effect.void,
    withContext: () => ({
      log: () => Effect.void,
      trace: () => Effect.void,
      debug: () => Effect.void,
      info: () => Effect.void,
      warn: () => Effect.void,
      error: () => Effect.void,
      withContext: () => null as any,
      timed: <A, E>(label: string, effect: Effect.Effect<A, E>) => effect,
    }),
    timed: <A, E>(label: string, effect: Effect.Effect<A, E>) => effect,
  }
);

/**
 * Default implementation with info level and json format
 */
export const LoggingServiceDefault = Layer.succeed(
  LoggingService,
  makeLoggingService('info', 'json')
);

// ============= Helper Functions =============

/**
 * Log and return value (for debugging pipelines)
 */
export const logValue = <A>(label: string) => (value: A) =>
  Effect.gen(function* () {
    const logger = yield* LoggingService;
    yield* logger.debug(label, { value });
    return value;
  });

/**
 * Log effect execution
 */
export const withLogging = <A, E>(
  label: string,
  effect: Effect.Effect<A, E>
) =>
  Effect.gen(function* () {
    const logger = yield* LoggingService;
    return yield* logger.timed(label, effect);
  });

/**
 * Create a logger for a specific component
 */
export const componentLogger = (component: string) =>
  Effect.gen(function* () {
    const logger = yield* LoggingService;
    return logger.withContext({ component });
  });

/**
 * Log operation start and end
 */
export const logOperation = (
  operation: string,
  context?: Record<string, unknown>
) => ({
  start: Effect.gen(function* () {
    const logger = yield* LoggingService;
    yield* logger.debug(`${operation} starting`, context);
  }),
  
  success: <A>(result?: A) =>
    Effect.gen(function* () {
      const logger = yield* LoggingService;
      yield* logger.info(`${operation} completed`, { ...context, result });
    }),
  
  failure: (error: unknown) =>
    Effect.gen(function* () {
      const logger = yield* LoggingService;
      yield* logger.error(`${operation} failed`, error, context);
    }),
});