/**
 * Type declarations for optional database modules
 * These modules are not required dependencies but can be used if installed
 */

declare module 'redis' {
  export const createClient: any
  export const createCluster: any
}

declare module 'mongodb' {
  export class MongoClient {
    constructor(url: string, options?: any)
    connect(): Promise<void>
    close(): Promise<void>
    db(name: string): any
  }
}

declare module 'neo4j-driver' {
  export const driver: any
  export const auth: {
    basic(username: string, password: string): any
  }
}

declare module 'pg' {
  export class Pool {
    constructor(config?: any)
    query(text: string, params?: any[]): Promise<any>
    end(): Promise<void>
  }
}