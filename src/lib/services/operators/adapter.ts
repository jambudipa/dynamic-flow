import { Effect, Layer } from 'effect'
import { OperatorRegistryService } from './registry'
import type { UnifiedOperator } from '../../operators/base'

/**
 * Backward compatibility adapter for OperatorRegistry
 * Maintains the original class-based API
 */
export class OperatorRegistry {
  private static instance: OperatorRegistry | null = null
  
  private constructor() {
    // Service will be accessed through Effect context
  }
  
  static getInstance(): OperatorRegistry {
    if (!OperatorRegistry.instance) {
      OperatorRegistry.instance = new OperatorRegistry()
    }
    return OperatorRegistry.instance
  }
  
  register(type: string, operator: UnifiedOperator<any>): void {
    Effect.runSync(
      Effect.gen(function* () {
        const registry = yield* OperatorRegistryService
        yield* registry.register(type, operator)
      }).pipe(Effect.provide(OperatorRegistryService.Default))
    )
  }
  
  get(type: string): UnifiedOperator<any> | undefined {
    return Effect.runSync(
      Effect.gen(function* () {
        const registry = yield* OperatorRegistryService
        return yield* registry.get(type)
      }).pipe(
        Effect.catchAll(() => Effect.succeed(undefined)),
        Effect.provide(OperatorRegistryService.Default)
      )
    )
  }
  
  has(type: string): boolean {
    return Effect.runSync(
      Effect.gen(function* () {
        const registry = yield* OperatorRegistryService
        return yield* registry.has(type)
      }).pipe(Effect.provide(OperatorRegistryService.Default))
    )
  }
  
  listTypes(): string[] {
    return Effect.runSync(
      Effect.gen(function* () {
        const registry = yield* OperatorRegistryService
        return yield* registry.listTypes()
      }).pipe(Effect.provide(OperatorRegistryService.Default))
    )
  }
  
  clear(): void {
    Effect.runSync(
      Effect.gen(function* () {
        const registry = yield* OperatorRegistryService
        yield* registry.clear()
      }).pipe(Effect.provide(OperatorRegistryService.Default))
    )
  }
  
  size(): number {
    return Effect.runSync(
      Effect.gen(function* () {
        const registry = yield* OperatorRegistryService
        return yield* registry.size()
      }).pipe(Effect.provide(OperatorRegistryService.Default))
    )
  }
}