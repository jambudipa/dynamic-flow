/**
 * Example Test Runner
 *
 * Utility for running and validating all examples in the examples folder.
 * Uses Effect-based execution and provides comprehensive validation.
 */

import { Effect } from 'effect';
import glob from 'glob';
import { basename, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Get current directory for path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ExampleResult {
  name: string;
  success: boolean;
  output?: any;
  error?: string;
  duration: number;
  memoryUsage?: NodeJS.MemoryUsage;
}

interface ValidationResult {
  compilation: boolean;
  execution: boolean;
  outputDocumentation: boolean;
  apiCompliance: boolean;
}

/**
 * Run all examples and capture their results
 */
export const runAllExamples = (): Effect.Effect<ExampleResult[], any, never> =>
  Effect.gen(function* () {
    console.log('🚀 Running all DynamicFlow examples...\n');

    // Find all example files
    const exampleFiles = yield* Effect.tryPromise(() =>
      glob('**/*.ts', {
        cwd: __dirname,
        ignore: [
          'test-runner.ts',
          'env.ts',
          'tools-registry.ts',
          'typecheck-examples.ts',
          '**/*.d.ts',
        ],
      })
    );

    const results: ExampleResult[] = [];

    for (const file of exampleFiles as string[]) {
      const startTime = performance.now();
      const startMemory = process.memoryUsage();
      const exampleName = basename(file, '.ts');

      console.log(`\n${'='.repeat(60)}`);
      console.log(`🔍 Running example: ${exampleName}`);
      console.log(`📁 File: ${file}`);
      console.log(`${'='.repeat(60)}`);

      try {
        // Dynamic import to avoid compilation issues
        const exampleModule = yield* Effect.tryPromise(
          () => import(resolve(__dirname, file))
        );

        if (typeof exampleModule.runExample === 'function') {
          // Capture console output
          const originalLog = console.log;
          const originalWarn = console.warn;
          const originalError = console.error;
          const logs: string[] = [];

          const captureLog = (...args: any[]) => {
            logs.push(args.map(String).join(' '));
            originalLog(...args);
          };

          console.log = captureLog;
          console.warn = captureLog;
          console.error = captureLog;

          try {
            const output = yield* Effect.tryPromise(() =>
              exampleModule.runExample()
            );

            // Restore console methods
            console.log = originalLog;
            console.warn = originalWarn;
            console.error = originalError;

            const duration = performance.now() - startTime;
            const endMemory = process.memoryUsage();

            console.log(
              `✅ ${exampleName} completed successfully in ${duration.toFixed(2)}ms`
            );

            results.push({
              name: exampleName,
              success: true,
              output,
              duration,
              memoryUsage: {
                rss: endMemory.rss - startMemory.rss,
                heapUsed: endMemory.heapUsed - startMemory.heapUsed,
                heapTotal: endMemory.heapTotal - startMemory.heapTotal,
                external: endMemory.external - startMemory.external,
                arrayBuffers: endMemory.arrayBuffers - startMemory.arrayBuffers,
              },
            });
          } catch (executionError) {
            // Restore console methods
            console.log = originalLog;
            console.warn = originalWarn;
            console.error = originalError;

            throw executionError;
          }
        } else {
          console.log(`⚠️  ${exampleName} - No runExample function exported`);
          results.push({
            name: exampleName,
            success: false,
            error: 'No runExample function exported',
            duration: performance.now() - startTime,
          });
        }
      } catch (error) {
        const duration = performance.now() - startTime;
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        console.log(`❌ ${exampleName} failed: ${errorMessage}`);
        results.push({
          name: exampleName,
          success: false,
          error: errorMessage,
          duration,
        });
      }
    }

    return results;
  });

/**
 * Validate a single example file
 */
export const validateExample = (
  examplePath: string
): Effect.Effect<boolean, any, never> =>
  Effect.gen(function* () {
    try {
      const exampleModule = yield* Effect.tryPromise(() => import(examplePath));

      if (typeof exampleModule.runExample !== 'function') {
        console.error(`Example ${examplePath} missing runExample function`);
        return false;
      }

      yield* Effect.tryPromise(() => exampleModule.runExample());
      return true;
    } catch (error) {
      console.error(`Example ${examplePath} failed:`, error);
      return false;
    }
  });

/**
 * Check TypeScript compilation for examples
 */
export const checkCompilation = (): Effect.Effect<boolean, any, never> =>
  Effect.gen(function* () {
    console.log('🔧 Checking TypeScript compilation...');

    try {
      const { execSync } = yield* Effect.tryPromise(
        () => import('child_process')
      );

      execSync('npx tsc --noEmit --project examples/tsconfig.json', {
        stdio: 'inherit',
        cwd: resolve(__dirname, '..'),
      });

      console.log('✅ TypeScript compilation successful');
      return true;
    } catch (error) {
      console.error('❌ TypeScript compilation failed:', error);
      return false;
    }
  });

/**
 * Generate comprehensive validation report
 */
export const generateValidationReport = (
  results: ExampleResult[]
): ValidationResult => {
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log('\n' + '='.repeat(80));
  console.log('📊 DYNAMIC FLOW EXAMPLES VALIDATION REPORT');
  console.log('='.repeat(80));

  console.log(`\n🎯 Overall Results:`);
  console.log(`   ✅ Successful: ${successful.length}`);
  console.log(`   ❌ Failed: ${failed.length}`);
  console.log(
    `   📈 Success Rate: ${Math.round((successful.length / results.length) * 100)}%`
  );
  console.log(`   📊 Total Examples: ${results.length}`);

  if (successful.length > 0) {
    const avgDuration =
      successful.reduce((sum, r) => sum + r.duration, 0) / successful.length;
    const minDuration = Math.min(...successful.map((r) => r.duration));
    const maxDuration = Math.max(...successful.map((r) => r.duration));

    console.log(`\n⏱️  Performance Summary:`);
    console.log(`   Average execution time: ${avgDuration.toFixed(2)}ms`);
    console.log(`   Fastest example: ${minDuration.toFixed(2)}ms`);
    console.log(`   Slowest example: ${maxDuration.toFixed(2)}ms`);
  }

  if (failed.length > 0) {
    console.log(`\n❌ Failed Examples:`);
    failed.forEach((failure) => {
      console.log(`   • ${failure.name}: ${failure.error}`);
    });
  }

  console.log(`\n📝 Successful Examples:`);
  successful.forEach((example) => {
    console.log(`   ✅ ${example.name} (${example.duration.toFixed(2)}ms)`);
  });

  return {
    compilation: true, // Will be updated by checkCompilation
    execution: failed.length === 0,
    outputDocumentation: true, // Could be enhanced to check documentation
    apiCompliance: failed.length === 0,
  };
};

/**
 * Main test runner function
 */
export const runExampleValidation = (): Effect.Effect<boolean, any, never> =>
  Effect.gen(function* () {
    console.log('🧪 DynamicFlow Examples Validation Suite');
    console.log('='.repeat(80));

    // Check TypeScript compilation first
    const compilationSuccess = yield* checkCompilation();

    if (!compilationSuccess) {
      console.log('\n❌ Compilation failed - stopping validation');
      return false;
    }

    // Run all examples
    const results = yield* runAllExamples();

    // Generate report
    const validation = generateValidationReport(results);
    const overallSuccess = compilationSuccess && validation.execution;

    console.log('\n' + '='.repeat(80));
    if (overallSuccess) {
      console.log('🎉 All examples validation PASSED!');
      console.log('✨ The DynamicFlow examples are working correctly.');
    } else {
      console.log('⚠️  Examples validation FAILED!');
      console.log('🔧 Please check the errors above and fix the issues.');
    }
    console.log('='.repeat(80));

    return overallSuccess;
  });

// Export individual functions for use by other modules
export type { ExampleResult, ValidationResult };

// Run validation if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  Effect.runPromise(runExampleValidation())
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('❌ Example validation failed:', error);
      process.exit(1);
    });
}

/**
 * Expected Output:
 * ===============
 *
 * Console Output:
 * 🧪 DynamicFlow Examples Validation Suite
 * ================================================================================
 * 🔧 Checking TypeScript compilation...
 * ✅ TypeScript compilation successful
 * 🚀 Running all DynamicFlow examples...
 *
 * ============================================================
 * 🔍 Running example: 01-hello-world
 * 📁 File: static/01-hello-world.ts
 * ============================================================
 * [Example specific output...]
 * ✅ 01-hello-world completed successfully in 45.67ms
 *
 * [Additional examples...]
 *
 * ================================================================================
 * 📊 DYNAMIC FLOW EXAMPLES VALIDATION REPORT
 * ================================================================================
 *
 * 🎯 Overall Results:
 *    ✅ Successful: 23
 *    ❌ Failed: 0
 *    📈 Success Rate: 100%
 *    📊 Total Examples: 23
 *
 * ⏱️  Performance Summary:
 *    Average execution time: 125.45ms
 *    Fastest example: 12.34ms
 *    Slowest example: 456.78ms
 *
 * 📝 Successful Examples:
 *    ✅ 01-hello-world (45.67ms)
 *    ✅ 02-sequential (67.89ms)
 *    [... all examples ...]
 *
 * ================================================================================
 * 🎉 All examples validation PASSED!
 * ✨ The DynamicFlow examples are working correctly.
 * ================================================================================
 *
 * Performance Notes:
 * - Validates all examples in the examples folder
 * - Checks TypeScript compilation before running
 * - Captures execution time and memory usage for each example
 * - Provides comprehensive reporting with success/failure details
 */
