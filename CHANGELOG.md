# @jambudipa/dynamic-flow

## 0.2.0

### Minor Changes

- b3c529c: ## Version 0.2.0 - Major Improvements

  ### 🎯 Complete Effect Migration
  - Migrated all 21 service classes to Effect Services with proper dependency injection
  - Implemented tagged error types throughout the codebase
  - Removed all circular dependencies and improved module structure

  ### 🔌 MCP Server Integration
  - Added production-ready Model Context Protocol (MCP) server discovery
  - Implemented type-safe MCP tool generation with proper TypeScript inference
  - Fixed Effect requirements type issues in generated tools (changed from `unknown` to `never`)
  - Added automatic cleanup and connection management for MCP servers

  ### 🤖 Enhanced LLM Integration
  - Improved LLMService with proper Effect service patterns
  - Fixed OpenAI integration for real AI-generated responses
  - Added conversation routing with `Flow.switchRoute`
  - Implemented conversation memory and context preservation

  ### 🔄 Improved Persistence Layer
  - Complete Effect migration for all persistence backends
  - Added support for multiple storage backends (Filesystem, PostgreSQL, Redis, MongoDB, Neo4j)
  - Implemented human-in-the-loop workflows with suspension/resumption
  - Added encryption and compression options

  ### 📚 Documentation Updates
  - Comprehensive documentation review and syntax corrections
  - Fixed all code examples to use proper Effect patterns
  - Added working examples for MCP integration and conversation flows
  - Updated getting started guide with correct async/await patterns

  ### 🐛 Bug Fixes
  - Fixed import path issues in effect-openai-tool.ts
  - Resolved type inference problems in mcpFlow
  - Fixed LLMService dependency injection issues
  - Corrected all TypeScript errors in generated MCP tools

  ### 🏗️ Project Structure
  - Reorganised to lib/ and examples/ directories
  - Removed deprecated test files
  - Cleaned up unnecessary migration and issue tracking files
  - Improved module exports and public API surface
    EOF < /dev/null
