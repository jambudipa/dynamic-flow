/**
 * Type definitions for state management.
 */

/**
 * Listener function for state changes.
 */
export type StateListener<T> = (state: T) => void;

/**
 * Unsubscribe function returned by subscribe.
 */
export type Unsubscribe = () => void;

/**
 * Interface for managing state with subscriptions.
 */
export interface StateManager<T = unknown> {
  /**
   * Get the current state.
   */
  getState(): T;

  /**
   * Set the state to a new value.
   */
  setState(state: T): void;

  /**
   * Update the state using a function.
   */
  updateState(updater: (current: T) => T): void;

  /**
   * Subscribe to state changes.
   * @returns Unsubscribe function
   */
  subscribe(listener: StateListener<T>): Unsubscribe;

  /**
   * Get a snapshot of the current state.
   */
  snapshot(): T;

  /**
   * Reset state to initial value.
   */
  reset(): void;
}

/**
 * Execution state for IR executor.
 */
export interface ExecutionState {
  /**
   * Current execution status.
   */
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';

  /**
   * Current step being executed.
   */
  currentStep?: string;

  /**
   * Execution context data.
   */
  context: Record<string, unknown>;

  /**
   * Execution result if completed.
   */
  result?: unknown;

  /**
   * Error if execution failed.
   */
  error?: Error;

  /**
   * Execution metadata.
   */
  metadata: {
    startTime?: Date;
    endTime?: Date;
    duration?: number;
    stepCount: number;
    completedSteps: number;
  };
}

/**
 * Create a default execution state.
 */
export const createDefaultExecutionState = (): ExecutionState => ({
  status: 'idle',
  context: {},
  metadata: {
    stepCount: 0,
    completedSteps: 0,
  },
});
