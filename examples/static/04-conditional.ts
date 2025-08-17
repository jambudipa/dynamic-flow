/**
 * Example: Conditional Branching
 *
 * Demonstrates conditional flow execution using Flow.doIf for data monitoring.
 * Different processing paths are taken based on runtime conditions like data thresholds.
 *
 * Features demonstrated:
 * - Flow.doIf for conditional execution with onTrue/onFalse handlers
 * - Nested conditions for complex decision trees
 * - Data analysis with alerts and reporting
 * - Type-safe conditional flows
 *
 * Performance characteristics:
 * - Lazy evaluation: Only executes necessary branches
 * - Early branching: Conditions evaluated efficiently
 * - Memory efficient: No intermediate collections
 *
 * Expected console output:
 * ```
 * Test 1: Normal data [10, 20, 30, 40, 50]
 * ✅ Normal range: avg=30.00
 * 📉 Normal range: 40
 * 📄 Generating summary report...
 * Result: Alert: not_needed, Severity: low
 *
 * Test 2: Anomaly data [70, 80, 90, 100, 150]
 * 🚨 ALERT: High average detected: 98.00
 * 📈 Large range detected: 80
 * 📊 Generating detailed anomaly report...
 * Result: Alert: sent, Severity: high
 * ```
 *
 * Return value: Promise<{ summary: string; details: WithAlert & Report }>
 *
 * Run: npx tsx examples/static/04-conditional.ts
 */

import { Effect, Flow, pipe } from '../../src/index';
import { Stream } from 'effect';

// Types for this example
interface Stats {
  data: number[];
  average: number;
  max: number;
  min: number;
}

type WithAlert = Stats & { alertStatus: 'sent' | 'not_needed' };

interface Report {
  report: {
    severity: 'high' | 'low';
    metrics: WithAlert;
    recommendation: string;
  };
}

// Mock service functions
const analyzeData = (data: number[]) => Effect.succeed<Stats>({
  data,
  average: data.reduce((a, b) => a + b, 0) / data.length,
  max: Math.max(...data),
  min: Math.min(...data)
});

const sendAlert = (message: string) => Effect.sync(() => {
  console.log(`🚨 ALERT: ${message}`);
  return { alertSent: true, message };
});

const logNormal = (stats: Stats) => Effect.sync(() => {
  console.log(`✅ Normal range: avg=${stats.average.toFixed(2)}`);
  return { status: 'normal', stats };
});

const generateDetailedReport = (stats: WithAlert) => Effect.sync<WithAlert & Report>(() => {
  console.log('\n📊 Generating detailed anomaly report...');
  return {
    ...stats,
    report: {
      severity: 'high' as const,
      metrics: stats,
      recommendation: 'Immediate investigation required'
    }
  };
});

const generateSummaryReport = (stats: WithAlert) => Effect.sync<WithAlert & Report>(() => {
  console.log('\n📄 Generating summary report...');
  return {
    ...stats,
    report: {
      severity: 'low' as const,
      metrics: stats,
      recommendation: 'No action required'
    }
  };
});

// Create a monitoring flow with multiple conditions
const monitoringFlow = (
  data: number[]
): Effect.Effect<{ summary: string; details: WithAlert & Report }, never, never> => pipe(
  // Analyze the input data
  analyzeData(data),

  // First condition: Check if average is abnormal
  Flow.doIf(
    stats => stats.average > 75,
    {
      onTrue: (stats: Stats) => pipe(
        sendAlert(`High average detected: ${stats.average.toFixed(2)}`),
        Flow.andThen(() => Effect.succeed<WithAlert>({ ...stats, alertStatus: 'sent' as const }))
      ),
      onFalse: (stats: Stats) => pipe(
        logNormal(stats),
        Flow.andThen(() => Effect.succeed<WithAlert>({ ...stats, alertStatus: 'not_needed' as const }))
      )
    }
  ),

  // Second condition: Check range for report generation
  Flow.andThen((stats: WithAlert) =>
    Flow.doIf(
      (s: WithAlert) => (s.max - s.min) > 50,
      {
        onTrue: (s: WithAlert) => pipe(
          Effect.succeed(s),
          Flow.tap(() => Effect.sync(() =>
            console.log(`📈 Large range detected: ${s.max - s.min}`)
          )),
          Flow.andThen(generateDetailedReport)
        ),
        onFalse: (s: WithAlert) => pipe(
          Effect.succeed(s),
          Flow.tap(() => Effect.sync(() =>
            console.log(`📉 Normal range: ${s.max - s.min}`)
          )),
          Flow.andThen(generateSummaryReport)
        )
      }
    )(Effect.succeed(stats))
  ),

  // Format final result
  Flow.map((result: WithAlert & Report) => ({
    summary: `Analysis complete. Alert: ${result.alertStatus || 'N/A'}. Report severity: ${result.report?.severity || 'N/A'}`,
    details: result
  }))
);

/**
 * Programmatic example runner for testing and integration
 */
export async function runExample(): Promise<{ summary: string; details: WithAlert & Report }[]> {
  console.log('=== Conditional Flow Example ===\n');

  const testCases = [
    { name: 'Normal data', data: [10, 20, 30, 40, 50] },
    { name: 'Anomaly data', data: [70, 80, 90, 100, 150] },
    { name: 'High but stable', data: [85, 88, 90, 92, 95] }
  ];

  const results: { summary: string; details: WithAlert & Report }[] = [];

  for (const testCase of testCases) {
    console.log(`Test: ${testCase.name} ${JSON.stringify(testCase.data)}`);
    console.log('-'.repeat(40));

    try {
      const result = await Effect.runPromise(monitoringFlow(testCase.data));
      console.log('🎯 Result:', result.summary);
      console.log('='.repeat(50));
      results.push(result);
    } catch (error) {
      console.error('❌ Flow failed:', error);
      throw error;
    }
  }

  // Demonstrate streaming mode
  console.log('\n— Streaming mode —');
  await Stream.runForEach(
    Stream.fromIterable(testCases).pipe(
      Stream.mapEffect(testCase => monitoringFlow(testCase.data)),
      Stream.map(res => res.summary)
    ),
    summary => Effect.sync(() => console.log('📤 Stream result:', summary))
  ).pipe(Effect.runPromise);

  console.log('\n✅ All test cases completed!');
  return results;
}

// Run the example when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExample().catch(console.error);
}


/**
 * Expected Output:
 * ===============
 *
 * === Conditional Flow Example ===
 *
 * Test: Normal data [10,20,30,40,50]
 * ----------------------------------------
 * ✅ Normal range: avg=30.00
 * 📉 Normal range: 40
 *
 * 📄 Generating summary report...
 * 🎯 Result: Analysis complete. Alert: not_needed. Report severity: low
 * ==================================================
 * Test: Anomaly data [70,80,90,100,150]
 * ----------------------------------------
 * 🚨 ALERT: High average detected: 98.00
 * 📈 Large range detected: 80
 *
 * 📊 Generating detailed anomaly report...
 * 🎯 Result: Analysis complete. Alert: sent. Report severity: high
 * ==================================================
 * Test: High but stable [85,88,90,92,95]
 * ----------------------------------------
 * 🚨 ALERT: High average detected: 90.00
 * 📉 Normal range: 10
 *
 * 📄 Generating summary report...
 * 🎯 Result: Analysis complete. Alert: sent. Report severity: low
 * ==================================================
 *
 * — Streaming mode —
 * ✅ Normal range: avg=30.00
 * 📉 Normal range: 40
 *
 * 📄 Generating summary report...
 * 📤 Stream result: Analysis complete. Alert: not_needed. Report severity: low
 * 🚨 ALERT: High average detected: 98.00
 * 📈 Large range detected: 80
 *
 * 📊 Generating detailed anomaly report...
 * 📤 Stream result: Analysis complete. Alert: sent. Report severity: high
 * 🚨 ALERT: High average detected: 90.00
 * 📉 Normal range: 10
 *
 * 📄 Generating summary report...
 * 📤 Stream result: Analysis complete. Alert: sent. Report severity: low
 *
 * ✅ All test cases completed\!
 */
