# Development Patterns Library

A collection of reusable patterns and best practices used throughout the jambudipa.io codebase.

## Patterns

### [Effect HttpApi + TanStack Query](./effect-httpapi-tanstack/README.md)
Strongly-typed React hooks for Effect platform HttpApi groups with TanStack Query integration and auth middleware. Includes ApiProvider for baseUrl/auth, per-group and per-method hooks, and an example component.
Keywords: Effect, HttpApi, HttpApiClient, TanStack Query, React, Auth, Type Safety

### [Effect Service Pattern](./effect-service-pattern/README.md)
Type-safe dependency injection pattern using Effect.Service and Context.Tag with Layer-based implementations. Documents the standard approach for defining services, managing dependencies, and composing application layers.
Keywords: Effect, Service, Context.Tag, Layers, Dependency Injection, Type Safety

## Purpose

This patterns library serves as:
- **Reference documentation** for common architectural patterns
- **Copy-paste templates** for implementing new features
- **Training material** for understanding the codebase structure
- **Standards enforcement** for consistent implementation
