# Persistence Module Implementation Guide

This directory contains the implementation of the DynamicFlow persistence feature, enabling flows to be suspended and resumed across extended time periods.

## Implementation Status

### ✅ Completed Tasks

- [x] Core types and interfaces defined (`types.ts`)
- [x] Module structure created
- [x] Docker test environment setup
- [x] Test scripts created

### 🚧 In Progress Tasks

- [ ] T1.2: State Serializer implementation
- [ ] T1.3: Encryption Layer implementation
- [ ] T1.4: Key Generator implementation
- [ ] T1.5: Persistence Hub Core implementation

### 📋 Next Tasks (From Phase 1)

1. **T1.2: Implement State Serializer** (6 hours)
   - Handle circular references in state objects
   - Add gzip compression for large states
   - Implement checksum validation
   - Support versioned serialization formats

2. **T1.3: Implement Encryption Layer** (4 hours)
   - AES-256-GCM encryption/decryption
   - Environment-based key management
   - Optional encryption for development

3. **T1.4: Implement Key Generator** (2 hours)
   - Cryptographically secure suspension keys
   - URL-safe and collision-resistant keys

4. **T1.5: Implement Persistence Hub Core** (8 hours)
   - Main orchestrator implementing PersistenceHub interface
   - Complete suspend/resume lifecycle
   - Error handling and logging

## File Structure

```
src/persistence/
├── index.ts                    # Main module exports
├── types.ts                    # ✅ Core types and interfaces
├── serializer.ts              # 🚧 State serialization
├── encryption.ts              # 🚧 State encryption
├── key-generator.ts           # 🚧 Suspension key generation
├── hub.ts                     # 🚧 Main persistence orchestrator
├── backend-factory.ts         # 📋 Backend creation and configuration
├── backends/
│   ├── index.ts              # Backend exports
│   ├── postgres.ts           # 📋 PostgreSQL implementation
│   ├── redis.ts              # 📋 Redis implementation
│   ├── mongodb.ts            # 📋 MongoDB implementation
│   ├── neo4j.ts              # 📋 Neo4j implementation
│   └── filesystem.ts         # 📋 Filesystem implementation
└── tools/
    ├── index.ts              # Tool exports
    ├── await-input.ts        # 📋 AwaitInput tool implementation
    └── factory.ts            # 📋 Tool factory functions
```

## Testing Structure

```
tests/
├── unit/persistence/         # Unit tests for each component
├── integration/persistence/  # Integration tests with real backends
└── fixtures/                # Test data and setup scripts
    ├── postgres/            # PostgreSQL test fixtures
    ├── mongodb/             # MongoDB test fixtures
    └── neo4j/               # Neo4j test fixtures
```

## Development Workflow

### 1. Start Development Environment

```bash
# Start all backend services for testing
./scripts/test-setup.sh start

# Check service status
./scripts/test-setup.sh status

# View service logs
./scripts/test-setup.sh logs postgres
```

### 2. Run Tests

```bash
# Run all persistence tests
npm run test:persistence

# Run specific backend tests
npm run test:persistence:postgres
npm run test:persistence:redis

# Run tests in container
./scripts/test-setup.sh test-container
```

### 3. Development Guidelines

#### Error Handling

- All errors must extend `PersistenceError` from `types.ts`
- Use Effect error channel for all failures
- Provide detailed error context for debugging

#### State Serialization

- Handle circular references gracefully
- Support compression for large states
- Include integrity checks (checksums)
- Version serialization format for compatibility

#### Backend Implementation

- Implement `StorageBackend` interface completely
- Add proper connection management
- Include health checks
- Support cleanup operations

#### Key Generation

- Use cryptographically secure random generation
- Ensure URL-safe encoding
- Prevent collisions across distributed systems
- Support key validation

### 4. Testing Requirements

#### Unit Tests

- Mock external dependencies
- Test error scenarios
- Achieve >90% code coverage
- Fast execution (<10s)

#### Integration Tests

- Test with real backend services
- End-to-end suspension/resumption
- Performance validation
- Concurrent operation safety

### 5. Performance Targets

- **Suspension**: <500ms for states up to 10MB
- **Resumption**: <1s for states up to 10MB
- **Concurrency**: Support 10,000+ suspended flows
- **Memory**: No leaks during extended operation

## Implementation Notes

### State Capture Strategy

The persistence system captures complete flow state including:

- Current execution position in the IR
- All variable values and context
- Tool outputs and intermediate results
- Execution metadata and timestamps

### Security Considerations

- Encryption of sensitive state data at rest
- Secure suspension key generation
- Authentication for resumption operations
- Audit logging of all operations

### Scalability Design

- Pluggable backend architecture
- Connection pooling for database backends
- Automatic cleanup of expired flows
- Support for horizontal scaling

## Dependencies

### Required Dependencies

```json
{
  "pg": "^8.11.0", // PostgreSQL client
  "redis": "^4.6.0", // Redis client
  "mongodb": "^5.7.0", // MongoDB client
  "neo4j-driver": "^5.12.0", // Neo4j client
  "compression": "^1.7.4" // Gzip compression
}
```

### Development Dependencies

```json
{
  "testcontainers": "^10.0.0", // Container testing
  "@types/compression": "^1.7.0"
}
```

## Getting Started

1. **Install Dependencies**

   ```bash
   npm install
   ```

2. **Start Test Environment**

   ```bash
   ./scripts/test-setup.sh start
   ```

3. **Run Basic Tests**

   ```bash
   npm run test:unit:persistence
   ```

4. **Implement Next Task**
   - Pick a task from the "Next Tasks" section
   - Follow the implementation guidelines
   - Write tests alongside implementation
   - Update this README with progress

## Questions or Issues?

- Check the [design specification](../../specs/persistence/design.md)
- Review the [requirements](../../specs/persistence/requirements.md)
- Look at the [implementation tasks](../../specs/persistence/tasks.md)
- Open an issue for clarification
