# ADR-001: TypeScript monorepo with pnpm workspaces

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

incident-triage has several deployable parts that share types: the NestJS API,
the MCP server, the triage agent, the Angular UI and the evals. Alert and
incident schemas must stay identical across all of them, and one person
develops the whole system, so the cost of keeping parts in sync matters more
than independent release cycles.

## Decision

Keep everything in one repository with pnpm workspaces and TypeScript
everywhere:

- `apps/*` for deployables (`api`, later `web`), `packages/*` for libraries
  (`shared`, later `mcp-server`, `agent`), `evals/` for agent evals.
- Shared contracts live in `@incident-triage/shared` as zod schemas, so the
  same definition gives runtime validation and static types.
- Vitest is the test runner for every package; Playwright joins for UI and
  end-to-end tests.
- Plain pnpm scripts (`pnpm -r build|test|typecheck`) until build times justify
  a task runner such as Nx or Turborepo.

## Alternatives considered

- **Polyrepo** — independent versioning is not needed yet, and shared schemas
  would need publishing on every change.
- **Nx from day one** — strong Angular support, but adds generators and config
  before there is enough code to benefit. Can be adopted later without moving files.
- **Python for the agent** — the larger AI ecosystem, but the goal is a single
  TypeScript system with shared types end to end.

## Consequences

- One PR can change a schema and all its consumers together.
- CI runs everything on every change; we will need affected-only runs later.
- The NestJS app compiles to CommonJS while libraries are ESM; consuming
  `shared` from `api` will need either an ESM Nest build or a dual build.
  This is decided in a later ADR when the API first imports shared schemas.
