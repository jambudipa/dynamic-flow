/**
 * @fileoverview Duration type re-exported from Effect
 * Using Effect's built-in Duration type for consistency
 */

// Re-export Duration from Effect
export { Duration } from 'effect';
export * as DurationUtils from 'effect/Duration';

// For backward compatibility, provide helper functions
import * as Duration from 'effect/Duration';

/**
 * Type guard for Duration
 */
export const isDuration = Duration.isDuration;

// Re-export commonly used Duration constructors for convenience
export const millis = Duration.millis;
export const seconds = Duration.seconds;
export const minutes = Duration.minutes;
export const hours = Duration.hours;
