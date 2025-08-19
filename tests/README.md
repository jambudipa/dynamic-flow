# Dynamic Flow Test Suite Documentation

## Overview

This document describes the comprehensive testing strategy and implementation for the Dynamic Flow library. The test suite aims for 100% code coverage while ensuring robustness, maintainability, and clarity.

## Test Structure

```
tests/
├── utils/                    # Test utilities and helpers
│   ├── effect-helpers.ts    # Effect testing utilities
│   └── mock-factories.ts    # Mock object factories
├── integration/              # Integration tests
│   └── flow-execution.test.ts
├── e2e/                      # End-to-end tests
│   └── complete-workflows.test.ts
├── fixtures/                 # Test data and fixtures
└── setup.ts                  # Global test setup

src/lib/*/                    # Co-located unit tests
├── types/guards.test.ts
├── compiler/json-to-ir-simple.test.ts
├── flow/flow.test.ts
├── operators/operators.test.ts
└── services/services.test.ts
```

## Test Categories

### 1. Unit Tests
- **Location**: Co-located with source files (`*.test.ts`)
- **Purpose**: Test individual functions and classes in isolation
- **Coverage Target**: 100% of public APIs
- **Key Areas**:
  - Type guards and validators
  - Pure functions
  - Class methods
  - Error handling

### 2. Integration Tests
- **Location**: `tests/integration/`
- **Purpose**: Test interaction between modules
- **Key Scenarios**:
  - Flow compilation pipeline
  - IR generation and validation
  - Service interactions
  - State management

### 3. End-to-End Tests
- **Location**: `tests/e2e/`
- **Purpose**: Test complete workflows
- **Key Workflows**:
  - Data processing pipelines
  - Decision trees
  - Error recovery
  - Stream processing
  - Batch operations

## Running Tests

### Basic Commands

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Run specific test file
npm test src/lib/types/guards.test.ts

# Run tests with UI
npm run test:ui
```

### Coverage Goals

The project targets 100% test coverage with the following thresholds:
- Lines: 100%
- Functions: 100%
- Branches: 100%
- Statements: 100%

Exceptions are documented and justified in the codebase.

## Test Utilities

### Effect Helpers

```typescript
import { runTest, runTestExit, testEffect } from '@tests/utils/effect-helpers'

// Run an Effect and get the result
const result = await runTest(effect)

// Run an Effect and get the Exit
const exit = await runTestExit(effect)

// Test with assertions
await testEffect(
  effect,
  (result) => {
    expect(result).toBe(expected)
  },
  optionalLayer
)
```

### Mock Factories

```typescript
import { 
  createMockLLMProvider,
  createMockFlow,
  createMockTool,
  createMockIR
} from '@tests/utils/mock-factories'

// Create mock LLM provider
const llm = createMockLLMProvider(responses)

// Create mock tool
const tool = createMockTool({
  id: 'test-tool',
  execute: (input) => Effect.succeed(output)
})
```

## Test Patterns

### Testing Effect-based Code

```typescript
describe('Effect-based function', () => {
  it('should handle success', async () => {
    const result = await runTest(
      functionUnderTest(input)
    )
    expect(result).toBe(expected)
  })

  it('should handle failure', async () => {
    const exit = await runTestExit(
      functionThatFails()
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
```

### Testing Services

```typescript
describe('Service', () => {
  let service: ServiceImpl
  let layer: Layer.Layer<Service>

  beforeEach(() => {
    service = new ServiceImpl()
    layer = Layer.succeed(Service, service)
  })

  it('should perform operation', async () => {
    const program = Effect.gen(function* () {
      const svc = yield* Service
      return yield* svc.operation()
    })
    
    const result = await runTest(
      Effect.provide(program, layer)
    )
    expect(result).toBe(expected)
  })
})
```

### Testing Flows

```typescript
describe('Flow execution', () => {
  it('should execute sequential flow', async () => {
    const flow = {
      flow: [
        { type: 'tool', tool: 'tool1', input: {} },
        { type: 'tool', tool: 'tool2', input: '$previousOutput' }
      ]
    }
    
    const compiler = new JSONToIRCompiler()
    const ir = await runTest(
      compiler.compile(flow, tools)
    )
    
    expect(ir.graph.nodes.size).toBe(2)
  })
})
```

## Best Practices

### 1. Test Organization
- Group related tests in describe blocks
- Use clear, descriptive test names
- Follow AAA pattern: Arrange, Act, Assert

### 2. Mock Usage
- Use factory functions for consistent mocks
- Keep mocks simple and focused
- Document mock behavior

### 3. Async Testing
- Always use async/await for Effect-based code
- Handle both success and failure paths
- Test timeout scenarios

### 4. Coverage
- Write tests for edge cases
- Test error conditions
- Validate type guards thoroughly

### 5. Performance
- Use test timeouts appropriately
- Mock expensive operations
- Run tests in parallel when possible

## Debugging Tests

### VS Code Configuration

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Tests",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["test", "--", "--inspect-brk"],
  "console": "integratedTerminal"
}
```

### Common Issues

1. **Timeout Errors**: Increase test timeout in vitest.config.ts
2. **Memory Issues**: Check for memory leaks in Effect chains
3. **Flaky Tests**: Ensure deterministic behavior, avoid race conditions

## CI/CD Integration

### GitHub Actions

```yaml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v3
```

## Maintenance

### Adding New Tests
1. Create test file co-located with source
2. Follow existing patterns and conventions
3. Ensure coverage targets are met
4. Update this documentation if needed

### Updating Tests
1. Keep tests in sync with code changes
2. Update mocks when interfaces change
3. Review and update integration tests
4. Verify E2E tests still pass

## Test Quality Metrics

- **Coverage**: 100% target (currently measuring)
- **Execution Time**: <2 minutes for full suite
- **Flakiness**: 0% flaky tests
- **Maintainability**: Clear structure and documentation

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Effect Testing Guide](https://effect.website/docs/guides/testing)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)

## Contact

For questions about testing, please refer to the project maintainers or open an issue on GitHub.
