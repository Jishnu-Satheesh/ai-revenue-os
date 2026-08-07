# ADR 0001: Use Postgres and Supabase as the Primary Data Platform

## Status

Accepted.

## Context

The platform needs relational integrity, multi-tenant isolation, transactional state, flexible attributes, authentication, file storage, and optional vector retrieval. The founder has MERN experience, but the domain contains strongly related entities and audit requirements.

## Decision

Use Supabase Postgres as the system of record, Supabase Auth for initial authentication, Supabase Storage for assets, Row Level Security for tenant isolation, and pgvector only where semantic retrieval is justified.

## Consequences

- Stronger fit for organizations, memberships, policies, goals, approvals, experiments, and financial metrics.
- RLS provides defense in depth.
- JSONB remains available for flexible provider metadata.
- The team must adopt SQL migrations and relational modeling.
- MongoDB is not the primary database, though it may be introduced later for a specific justified workload.
