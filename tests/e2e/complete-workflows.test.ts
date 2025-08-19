/**
 * End-to-End Tests for Complete Workflows
 * 
 * Tests realistic, complete workflows from start to finish
 */

import { describe, it, expect } from 'vitest'
import { Effect, pipe, Layer, Schema } from 'effect'
import type { Tool } from '@lib/tools/types'
import { runTest } from '../utils/effect-helpers'

describe('E2E Complete Workflows', () => {
  describe('Data Processing Pipeline', () => {
    it('should process data through multiple transformation stages', async () => {
      // Mock a complete data processing pipeline
      const tools: Tool<any, any>[] = [
        {
          id: 'fetch-users',
          name: 'Fetch Users',
          description: 'Fetches user data from database',
          inputSchema: Schema.Struct({ 
            limit: Schema.Number,
            offset: Schema.Number 
          }),
          outputSchema: Schema.Struct({
            users: Schema.Array(Schema.Struct({
              id: Schema.String,
              name: Schema.String,
              email: Schema.String,
              age: Schema.Number,
              status: Schema.String
            }))
          }),
          execute: (input) => Effect.succeed({
            users: [
              { id: '1', name: 'Alice', email: 'alice@example.com', age: 30, status: 'active' },
              { id: '2', name: 'Bob', email: 'bob@example.com', age: 25, status: 'inactive' },
              { id: '3', name: 'Charlie', email: 'charlie@example.com', age: 35, status: 'active' },
              { id: '4', name: 'Diana', email: 'diana@example.com', age: 28, status: 'active' },
              { id: '5', name: 'Eve', email: 'eve@example.com', age: 32, status: 'inactive' }
            ].slice(input.offset, input.offset + input.limit)
          })
        },
        {
          id: 'filter-active',
          name: 'Filter Active Users',
          description: 'Filters only active users',
          inputSchema: Schema.Struct({
            users: Schema.Array(Schema.Any)
          }),
          outputSchema: Schema.Struct({
            activeUsers: Schema.Array(Schema.Any)
          }),
          execute: (input) => Effect.succeed({
            activeUsers: input.users.filter((u: any) => u.status === 'active')
          })
        },
        {
          id: 'enrich-data',
          name: 'Enrich User Data',
          description: 'Adds computed fields to user data',
          inputSchema: Schema.Struct({
            activeUsers: Schema.Array(Schema.Any)
          }),
          outputSchema: Schema.Struct({
            enrichedUsers: Schema.Array(Schema.Any)
          }),
          execute: (input) => Effect.succeed({
            enrichedUsers: input.activeUsers.map((user: any) => ({
              ...user,
              category: user.age < 30 ? 'young' : 'experienced',
              emailDomain: user.email.split('@')[1]
            }))
          })
        },
        {
          id: 'aggregate-stats',
          name: 'Aggregate Statistics',
          description: 'Computes statistics from user data',
          inputSchema: Schema.Struct({
            enrichedUsers: Schema.Array(Schema.Any)
          }),
          outputSchema: Schema.Struct({
            stats: Schema.Struct({
              totalUsers: Schema.Number,
              averageAge: Schema.Number,
              categoryBreakdown: Schema.Record({ key: Schema.String, value: Schema.Number }),
              domainBreakdown: Schema.Record({ key: Schema.String, value: Schema.Number })
            })
          }),
          execute: (input) => Effect.succeed({
            stats: {
              totalUsers: input.enrichedUsers.length,
              averageAge: input.enrichedUsers.reduce((sum: number, u: any) => sum + u.age, 0) / input.enrichedUsers.length,
              categoryBreakdown: input.enrichedUsers.reduce((acc: any, u: any) => {
                acc[u.category] = (acc[u.category] || 0) + 1
                return acc
              }, {}),
              domainBreakdown: input.enrichedUsers.reduce((acc: any, u: any) => {
                acc[u.emailDomain] = (acc[u.emailDomain] || 0) + 1
                return acc
              }, {})
            }
          })
        },
        {
          id: 'generate-report',
          name: 'Generate Report',
          description: 'Creates a formatted report',
          inputSchema: Schema.Struct({
            stats: Schema.Any
          }),
          outputSchema: Schema.Struct({
            report: Schema.String
          }),
          execute: (input) => Effect.succeed({
            report: `
User Analytics Report
====================
Total Active Users: ${input.stats.totalUsers}
Average Age: ${input.stats.averageAge.toFixed(1)}

Category Breakdown:
${Object.entries(input.stats.categoryBreakdown)
  .map(([cat, count]) => `  - ${cat}: ${count}`)
  .join('\n')}

Email Domains:
${Object.entries(input.stats.domainBreakdown)
  .map(([domain, count]) => `  - ${domain}: ${count}`)
  .join('\n')}
            `.trim()
          })
        }
      ]

      // Simulate flow execution
      const mockFlowExecution = async () => {
        let result: any = null
        
        // Execute tools in sequence
        for (const tool of tools) {
          if (tool.id === 'fetch-users') {
            result = await runTest(tool.execute({ limit: 10, offset: 0 }))
          } else if (result) {
            result = await runTest(tool.execute(result))
          }
        }
        
        return result
      }

      const finalResult = await mockFlowExecution()
      
      expect(finalResult).toBeDefined()
      expect(finalResult.report).toContain('User Analytics Report')
      expect(finalResult.report).toContain('Total Active Users:')
      expect(finalResult.report).toContain('Average Age:')
    })
  })

  describe('Multi-Stage Decision Workflow', () => {
    it('should handle complex decision trees', async () => {
      const tools: Tool<any, any>[] = [
        {
          id: 'evaluate-risk',
          name: 'Evaluate Risk',
          description: 'Evaluates risk level',
          inputSchema: Schema.Struct({
            amount: Schema.Number,
            history: Schema.Array(Schema.String)
          }),
          outputSchema: Schema.Struct({
            riskLevel: Schema.Literal('low', 'medium', 'high'),
            score: Schema.Number
          }),
          execute: (input) => Effect.succeed({
            riskLevel: input.amount > 10000 ? 'high' : 
                      input.amount > 5000 ? 'medium' : 'low',
            score: Math.min(100, input.amount / 100)
          })
        },
        {
          id: 'manual-review',
          name: 'Manual Review',
          description: 'Flags for manual review',
          inputSchema: Schema.Any,
          outputSchema: Schema.Struct({
            status: Schema.String,
            requiresReview: Schema.Boolean
          }),
          execute: () => Effect.succeed({
            status: 'pending_review',
            requiresReview: true
          })
        },
        {
          id: 'auto-approve',
          name: 'Auto Approve',
          description: 'Automatically approves',
          inputSchema: Schema.Any,
          outputSchema: Schema.Struct({
            status: Schema.String,
            approved: Schema.Boolean
          }),
          execute: () => Effect.succeed({
            status: 'approved',
            approved: true
          })
        },
        {
          id: 'enhanced-check',
          name: 'Enhanced Check',
          description: 'Performs enhanced verification',
          inputSchema: Schema.Any,
          outputSchema: Schema.Struct({
            status: Schema.String,
            checksPassed: Schema.Boolean
          }),
          execute: () => Effect.delay(
            Effect.succeed({
              status: 'verified',
              checksPassed: true
            }),
            '20 millis'
          )
        }
      ]

      // Simulate a decision workflow
      const executeDecisionFlow = async (amount: number) => {
        // First evaluate risk
        const riskResult = await runTest(
          tools[0].execute({ amount, history: [] })
        )

        // Based on risk level, take different paths
        let finalResult: any
        
        if (riskResult.riskLevel === 'high') {
          // High risk: manual review
          finalResult = await runTest(tools[1].execute(riskResult))
        } else if (riskResult.riskLevel === 'medium') {
          // Medium risk: enhanced check then approve
          const checkResult = await runTest(tools[3].execute(riskResult))
          if (checkResult.checksPassed) {
            finalResult = await runTest(tools[2].execute(checkResult))
          } else {
            finalResult = await runTest(tools[1].execute(checkResult))
          }
        } else {
          // Low risk: auto-approve
          finalResult = await runTest(tools[2].execute(riskResult))
        }

        return {
          ...riskResult,
          ...finalResult,
          workflow: 'decision-tree'
        }
      }

      // Test different scenarios
      const lowRiskResult = await executeDecisionFlow(1000)
      expect(lowRiskResult.status).toBe('approved')
      expect(lowRiskResult.approved).toBe(true)

      const mediumRiskResult = await executeDecisionFlow(7000)
      expect(mediumRiskResult.status).toBe('approved')
      expect(mediumRiskResult.approved).toBe(true)

      const highRiskResult = await executeDecisionFlow(15000)
      expect(highRiskResult.status).toBe('pending_review')
      expect(highRiskResult.requiresReview).toBe(true)
    })
  })

  describe('Retry and Error Recovery Workflow', () => {
    it('should handle failures with retry logic', async () => {
      let attemptCount = 0
      
      const tools: Tool<any, any>[] = [
        {
          id: 'unreliable-api',
          name: 'Unreliable API',
          description: 'Sometimes fails',
          inputSchema: Schema.Any,
          outputSchema: Schema.Struct({ data: Schema.String }),
          execute: () => {
            attemptCount++
            if (attemptCount < 3) {
              return Effect.fail(new Error(`Attempt ${attemptCount} failed`))
            }
            return Effect.succeed({ data: 'Success after retries' })
          }
        },
        {
          id: 'fallback-api',
          name: 'Fallback API',
          description: 'Backup service',
          inputSchema: Schema.Any,
          outputSchema: Schema.Struct({ data: Schema.String }),
          execute: () => Effect.succeed({ data: 'Fallback response' })
        },
        {
          id: 'process-response',
          name: 'Process Response',
          description: 'Processes API response',
          inputSchema: Schema.Struct({ data: Schema.String }),
          outputSchema: Schema.Struct({ processed: Schema.String }),
          execute: (input) => Effect.succeed({
            processed: `Processed: ${input.data}`
          })
        }
      ]

      // Simulate retry workflow
      const executeWithRetry = async () => {
        let result: any
        let retries = 0
        const maxRetries = 3

        while (retries < maxRetries) {
          try {
            result = await Effect.runPromise(tools[0].execute({}))
            break
          } catch (error) {
            retries++
            if (retries >= maxRetries) {
              // Use fallback
              result = await runTest(tools[1].execute({}))
              break
            }
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 10))
          }
        }

        // Process the result
        return await runTest(tools[2].execute(result))
      }

      const finalResult = await executeWithRetry()
      expect(finalResult.processed).toContain('Success after retries')
      expect(attemptCount).toBe(3)
    })
  })

  describe('Stream Processing Workflow', () => {
    it('should process streaming data', async () => {
      const tools: Tool<any, any>[] = [
        {
          id: 'stream-source',
          name: 'Stream Source',
          description: 'Generates stream of events',
          inputSchema: Schema.Any,
          outputSchema: Schema.Array(Schema.Struct({
            id: Schema.Number,
            timestamp: Schema.Number,
            value: Schema.Number
          })),
          execute: () => Effect.succeed(
            Array.from({ length: 10 }, (_, i) => ({
              id: i,
              timestamp: Date.now() + i * 100,
              value: Math.random() * 100
            }))
          )
        },
        {
          id: 'filter-threshold',
          name: 'Filter Threshold',
          description: 'Filters events above threshold',
          inputSchema: Schema.Array(Schema.Any),
          outputSchema: Schema.Array(Schema.Any),
          execute: (input) => Effect.succeed(
            input.filter((event: any) => event.value > 50)
          )
        },
        {
          id: 'aggregate-window',
          name: 'Aggregate Window',
          description: 'Aggregates events in time window',
          inputSchema: Schema.Array(Schema.Any),
          outputSchema: Schema.Struct({
            count: Schema.Number,
            average: Schema.Number,
            max: Schema.Number,
            min: Schema.Number
          }),
          execute: (input) => Effect.succeed({
            count: input.length,
            average: input.reduce((sum: number, e: any) => sum + e.value, 0) / input.length,
            max: Math.max(...input.map((e: any) => e.value)),
            min: Math.min(...input.map((e: any) => e.value))
          })
        }
      ]

      // Simulate stream processing
      const processStream = async () => {
        // Generate events
        const events = await runTest(tools[0].execute({}))
        
        // Filter high-value events
        const filtered = await runTest(tools[1].execute(events))
        
        // Aggregate statistics
        if (filtered.length > 0) {
          return await runTest(tools[2].execute(filtered))
        }
        
        return {
          count: 0,
          average: 0,
          max: 0,
          min: 0
        }
      }

      const stats = await processStream()
      
      expect(stats).toBeDefined()
      expect(stats.count).toBeGreaterThanOrEqual(0)
      expect(stats.average).toBeGreaterThanOrEqual(0)
      if (stats.count > 0) {
        expect(stats.max).toBeGreaterThan(50)
        expect(stats.min).toBeGreaterThan(50)
      }
    })
  })

  describe('Batch Processing Workflow', () => {
    it('should process data in batches efficiently', async () => {
      const tools: Tool<any, any>[] = [
        {
          id: 'batch-processor',
          name: 'Batch Processor',
          description: 'Processes a batch of items',
          inputSchema: Schema.Struct({
            batch: Schema.Array(Schema.Number),
            batchId: Schema.Number
          }),
          outputSchema: Schema.Struct({
            batchId: Schema.Number,
            processed: Schema.Number,
            sum: Schema.Number
          }),
          execute: (input) => Effect.delay(
            Effect.succeed({
              batchId: input.batchId,
              processed: input.batch.length,
              sum: input.batch.reduce((a, b) => a + b, 0)
            }),
            '5 millis'
          )
        },
        {
          id: 'merge-results',
          name: 'Merge Results',
          description: 'Merges batch results',
          inputSchema: Schema.Array(Schema.Any),
          outputSchema: Schema.Struct({
            totalProcessed: Schema.Number,
            totalSum: Schema.Number,
            batchCount: Schema.Number
          }),
          execute: (input) => Effect.succeed({
            totalProcessed: input.reduce((sum: number, r: any) => sum + r.processed, 0),
            totalSum: input.reduce((sum: number, r: any) => sum + r.sum, 0),
            batchCount: input.length
          })
        }
      ]

      // Create large dataset
      const dataset = Array.from({ length: 1000 }, (_, i) => i)
      const batchSize = 100

      // Process in batches
      const processBatches = async () => {
        const results = []
        
        for (let i = 0; i < dataset.length; i += batchSize) {
          const batch = dataset.slice(i, i + batchSize)
          const batchResult = await runTest(
            tools[0].execute({
              batch,
              batchId: Math.floor(i / batchSize)
            })
          )
          results.push(batchResult)
        }
        
        return await runTest(tools[1].execute(results))
      }

      const startTime = Date.now()
      const finalResult = await processBatches()
      const duration = Date.now() - startTime

      expect(finalResult.totalProcessed).toBe(1000)
      expect(finalResult.totalSum).toBe(499500) // Sum of 0..999
      expect(finalResult.batchCount).toBe(10)
      expect(duration).toBeLessThan(1000) // Should be reasonably fast
    })
  })
})