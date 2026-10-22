# incident-triage

An AI agent that helps on-call engineers triage server incidents: it reads metrics, logs, alerts and recent deploys, proposes a hypothesis and suggests next steps.

The project is built in public as a production-grade TypeScript system, not a demo script: real Postgres, auth, queues, telemetry, infrastructure as code, CI/CD and evals.

> **Status:** early development. Started October 2026.

## Why

On-call engineers spend the first minutes of every incident collecting context from dashboards, logs and deploy history. The agent does that collection for them and explains what it found, with links to the data, so a person can decide faster.

## Architecture (planned)

```
Alerts ──▶ NestJS API ──▶ Queue (BullMQ) ──▶ Correlation worker ──▶ Postgres
                │                                                     ▲
                ├── Triage agent (AI SDK, tool calling) ──────────────┤
                ├── MCP server (tools: metrics, logs, deploys) ───────┘
                ▼
         Angular UI (incident list, streaming triage panel)

Everything is traced with OpenTelemetry and deployed to AWS with CDK.
```

| Layer | Stack |
|---|---|
| Database | PostgreSQL, Drizzle ORM, SQL migrations |
| API | NestJS, zod, OpenAPI, JWT + RBAC, API keys for agents |
| Background jobs | BullMQ, Redis, transactional outbox |
| Observability | OpenTelemetry, Grafana (Tempo, Loki, Prometheus) |
| AI | Vercel AI SDK, Claude, tool calling, MCP (TypeScript SDK) |
| Frontend | Angular, signals, server-sent events |
| Infrastructure | AWS (ECS Fargate, RDS, S3 + CloudFront), AWS CDK |
| Quality | Vitest, Testcontainers, Playwright, GitHub Actions |

## Roadmap

- [ ] Data model and migrations
- [ ] REST API with auth and RBAC
- [ ] Alert ingestion through a queue, incident correlation
- [ ] OpenTelemetry tracing end to end
- [ ] AWS infrastructure with CDK, CI/CD to staging
- [ ] LLM incident summary with structured output
- [ ] Triage agent with tool calling
- [ ] Streaming triage panel in Angular
- [ ] MCP server for triage tools
- [ ] Evals for agent quality in CI

## Decisions

Architecture decisions are recorded as ADRs in [`docs/adr`](docs/adr).

## Repository layout

```
apps/api              NestJS API (health endpoint for now)
apps/web              Angular UI (planned)
packages/shared       Shared zod schemas and types
packages/mcp-server   MCP server for triage tools (planned)
packages/agent        Triage agent (planned)
evals                 Agent evals (planned)
docs/adr              Architecture decision records
```

## Getting started

Requires Node 22 and pnpm 10.

```bash
pnpm install
docker compose up -d      # Postgres and Redis
pnpm build && pnpm test
node apps/api/dist/main.js  # http://localhost:3000/health
```

## License

MIT
