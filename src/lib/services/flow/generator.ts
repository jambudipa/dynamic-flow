import { Effect, Schema } from 'effect'
import { GenerationError, ValidationError } from '../../errors'
import type { Flow } from '../validation/flow-types'
import { LLMService } from '../llm/service'
import { ValidationService } from '../validation/service'

/**
 * Flow generation options
 */
export interface FlowGenerationOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  validateOutput?: boolean
  retryOnFailure?: boolean
  maxRetries?: number
}

/**
 * Flow generation result
 */
export interface FlowGenerationResult {
  flow: Flow
  prompt: string
  model: string
  generationTime: number
  validated: boolean
}

/**
 * Flow template for common patterns
 */
export interface FlowTemplate {
  name: string
  description: string
  parameters: Record<string, any>
  generate: (params: Record<string, any>) => Flow
}

/**
 * Flow Generator Service
 * Generates flows from prompts using LLM
 */
export class FlowGeneratorService extends Effect.Service<FlowGeneratorService>()('FlowGeneratorService', {
  effect: Effect.gen(function* () {
    const llmService = yield* LLMService
    const validationService = yield* ValidationService
    
    // Flow schema for structured generation
    const FlowSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      description: Schema.optional(Schema.String),
      nodes: Schema.Array(Schema.Struct({
        id: Schema.String,
        type: Schema.String,
        config: Schema.optional(Schema.Unknown),
        metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
      })),
      edges: Schema.optional(Schema.Array(Schema.Struct({
        from: Schema.String,
        to: Schema.String,
        condition: Schema.optional(Schema.Unknown)
      })))
    })
    
    const generateFromPrompt = (prompt: string, options?: FlowGenerationOptions): any =>
      Effect.gen(function* (): any {
          const startTime = Date.now()
          
          // Build system prompt for flow generation
          const systemPrompt = `You are a flow generation assistant. Generate a valid flow structure based on the user's requirements.
          
          The flow should be a JSON object with:
          - id: unique identifier
          - name: descriptive name
          - description: optional description
          - nodes: array of nodes with id, type, and optional config
          - edges: optional array of edges connecting nodes
          
          Available node types: start, end, tool, map, filter, reduce, conditional, switch, loop, parallel
          
          Ensure the flow is well-structured and follows best practices.`
          
          // Generate flow using LLM
          const generatedFlow = yield* llmService.generateStructured(
            prompt,
            FlowSchema,
            {
              systemPrompt,
              model: options?.model,
              temperature: options?.temperature || 0.7,
              maxTokens: options?.maxTokens || 2000
            }
          ).pipe(
            Effect.mapError(error => new GenerationError({
              message: `Failed to generate flow: ${error}`,
              target: 'flow',
              cause: error
            }))
          )
          
          // Validate if requested
          if (options?.validateOutput !== false) {
            const validationResult = yield* validationService.validateFlow(generatedFlow as any).pipe(
              Effect.mapError(error => new GenerationError({
                message: 'Generated flow failed validation',
                target: 'flow-validation',
                cause: error
              }))
            )
            
            if (!validationResult.validationResult.valid && options?.retryOnFailure) {
              // Retry generation with feedback
              const retryPrompt = `${prompt}\n\nPrevious attempt failed validation with errors: ${validationResult.validationResult.errors.map((e: any) => e.message).join(', ')}. Please fix these issues.`
              
              return yield* generateFromPrompt(retryPrompt, {
                ...options,
                retryOnFailure: false // Prevent infinite recursion
              })
            }
          }
          
          return {
            flow: generatedFlow,
            prompt,
            model: options?.model || 'default',
            generationTime: Date.now() - startTime,
            validated: options?.validateOutput !== false
          } as FlowGenerationResult
        }).pipe(
          Effect.mapError(error => {
            if (error instanceof GenerationError) {
              return error
            }
            return new GenerationError({
              message: 'Flow generation failed',
              target: 'flow',
              cause: error
            })
          })
        )
    
    return {
      generateFromPrompt,
      
      /**
       * Generate a flow from a template
       */
      generateFromTemplate: (templateName: string, parameters: Record<string, any>) =>
        Effect.gen(function* () {
          const template = yield* getTemplate(templateName)
          
          if (!template) {
            return yield* Effect.fail(new GenerationError({
              message: `Template not found: ${templateName}`,
              target: 'template',
              cause: { templateName }
            }))
          }
          
          // Generate flow from template
          const flow = template.generate(parameters)
          
          // Validate generated flow
          const validated = yield* validationService.validateFlow(flow)
          
          return {
            flow: validated.flow,
            prompt: `Generated from template: ${templateName}`,
            model: 'template',
            generationTime: 0,
            validated: true
          } as FlowGenerationResult
        }),
      
      /**
       * Optimize an existing flow
       */
      optimizeFlow: (flow: Flow, criteria?: string[]) =>
        Effect.gen(function* () {
          const optimizationPrompt = `Optimize the following flow for ${criteria?.join(', ') || 'performance and clarity'}:
          
          ${JSON.stringify(flow, null, 2)}
          
          Provide an optimized version that:
          1. Reduces unnecessary steps
          2. Improves parallel execution where possible
          3. Simplifies complex conditions
          4. Maintains the same functionality`
          
          const optimizedResult = yield* generateFromPrompt(optimizationPrompt, {
            validateOutput: true
          })
          
          return optimizedResult.flow
        }),
      
      /**
       * Generate flow documentation
       */
      generateDocumentation: (flow: Flow) =>
        Effect.gen(function* () {
          const docPrompt = `Generate comprehensive documentation for this flow:
          
          ${JSON.stringify(flow, null, 2)}
          
          Include:
          1. Overview and purpose
          2. Node descriptions
          3. Data flow explanation
          4. Usage examples
          5. Configuration options`
          
          const documentation = yield* llmService.generateCompletion(docPrompt, {
            maxTokens: 1500
          })
          
          return documentation.text
        }),
      
      /**
       * Suggest improvements for a flow
       */
      suggestImprovements: (flow: Flow) =>
        Effect.gen(function* () {
          const analysisPrompt = `Analyze this flow and suggest improvements:
          
          ${JSON.stringify(flow, null, 2)}
          
          Consider:
          - Performance optimizations
          - Error handling improvements
          - Clarity and maintainability
          - Best practices`
          
          const suggestions = yield* llmService.generateCompletion(analysisPrompt, {
            temperature: 0.8,
            maxTokens: 1000
          })
          
          return suggestions.text.split('\n').filter((s: string) => s.trim())
        }),
      
      /**
       * Convert flow to different format
       */
      convertFlow: (flow: Flow, targetFormat: 'yaml' | 'xml' | 'mermaid') =>
        Effect.gen(function* () {
          const conversionPrompt = `Convert this flow to ${targetFormat} format:
          
          ${JSON.stringify(flow, null, 2)}`
          
          const converted = yield* llmService.generateCompletion(conversionPrompt, {
            temperature: 0.3,
            maxTokens: 2000
          })
          
          return converted.text
        }),
      
      /**
       * Get available templates
       */
      getTemplates: () => Effect.succeed([
        {
          name: 'data-pipeline',
          description: 'ETL data processing pipeline',
          parameters: { source: 'string', destination: 'string', transformations: 'array' }
        },
        {
          name: 'api-workflow',
          description: 'API request and response handling',
          parameters: { endpoint: 'string', method: 'string', authentication: 'object' }
        },
        {
          name: 'batch-processor',
          description: 'Batch processing with error handling',
          parameters: { batchSize: 'number', processor: 'string', errorStrategy: 'string' }
        }
      ])
    }
    
    // Helper function to get template
    function getTemplate(name: string): Effect.Effect<FlowTemplate | null, never> {
      const templates: Record<string, FlowTemplate> = {
        'data-pipeline': {
          name: 'data-pipeline',
          description: 'ETL data processing pipeline',
          parameters: {},
          generate: (params) => ({
            id: `pipeline-${Date.now()}`,
            name: 'Data Pipeline',
            nodes: [
              { id: 'start', type: 'start' },
              { id: 'extract', type: 'tool', config: { tool: params.source } },
              { id: 'transform', type: 'map', config: { with: params.transformations } },
              { id: 'load', type: 'tool', config: { tool: params.destination } },
              { id: 'end', type: 'end' }
            ],
            edges: [
              { from: 'start', to: 'extract' },
              { from: 'extract', to: 'transform' },
              { from: 'transform', to: 'load' },
              { from: 'load', to: 'end' }
            ]
          })
        }
      }
      
      return Effect.succeed(templates[name] || null)
    }
  })
}) {}