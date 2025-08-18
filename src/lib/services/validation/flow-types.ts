/**
 * Simple Flow type for validation service
 */
export interface Flow {
  id: string
  name: string
  description?: string
  version?: string
  nodes?: Array<{
    id: string
    type: string
    config?: any
    metadata?: Record<string, any>
  }>
  edges?: Array<{
    from: string
    to: string
    condition?: any
  }>
}