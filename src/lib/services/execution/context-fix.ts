import { Context } from 'effect';

/**
 * Execution Context Interface
 */
export interface ExecutionContext {
  readonly getVariable: (name: string) => any;
  readonly setVariable: (name: string, value: any) => any;
  readonly hasVariable: (name: string) => any;
  readonly clearVariable: (name: string) => any;
  readonly createChildContext: () => any;
}

/**
 * Execution Context Tag for dependency injection
 */
export const ExecutionContext =
  Context.GenericTag<ExecutionContext>('ExecutionContext');
