import { Effect } from 'effect';
import { ExecutionError, ValidationError } from '../../errors';
import { StateService } from '../state/service';
import type { IRNode } from '../../ir/core-types';
import type { ExecutionContext } from './implementation';

export interface ExecutionResult {
  readonly value: unknown;
  readonly state: Record<string, unknown>;
  readonly logs: string[];
  readonly duration: number;
}

import { IRExecutorServiceImpl } from './implementation';

/**
 * IR execution engine service.
 * Uses Effect.Service as there's a single execution strategy.
 */
export class IRExecutorService extends Effect.Service<IRExecutorService>()(
  'IRExecutorService',
  {
    effect: IRExecutorServiceImpl,
  }
) {}
