import { Context, Effect } from 'effect';
import { PersistenceError } from '../../errors';

export interface PersistenceMetadata {
  readonly key: string;
  readonly created: Date;
  readonly modified: Date;
  readonly size: number;
  readonly encrypted: boolean;
}

/**
 * Persistence service for storing and retrieving data.
 * Uses Context.Tag to support multiple storage backends:
 * - In-memory storage
 * - File system storage
 * - Database storage
 * - S3/Cloud storage
 */
export interface PersistenceService {
  readonly save: <T>(
    key: string,
    data: T
  ) => Effect.Effect<void, PersistenceError>;
  readonly load: <T>(key: string) => Effect.Effect<T, PersistenceError>;
  readonly exists: (key: string) => Effect.Effect<boolean, never>;
  readonly delete: (key: string) => Effect.Effect<void, PersistenceError>;
  readonly list: (
    prefix?: string
  ) => Effect.Effect<PersistenceMetadata[], PersistenceError>;
  readonly clear: () => Effect.Effect<void, PersistenceError>;
  readonly backup: (
    destination: string
  ) => Effect.Effect<void, PersistenceError>;
  readonly restore: (source: string) => Effect.Effect<void, PersistenceError>;
}

export const PersistenceService =
  Context.GenericTag<PersistenceService>('PersistenceService');
