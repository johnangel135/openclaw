# Architecture — Hosted OpenClaw (BYOK + Managed)

```mermaid
flowchart LR
  U[Customer App / Channel] --> G[OpenClaw Gateway API]
  G --> A[Auth + Tenant Resolver]
  A --> P[Policy Engine\nRate limits / Budget caps]
  P --> R[Router]

  R -->|BYOK mode| K[(Encrypted Key Vault)]
  R -->|BYOK mode| M1[Model Provider APIs\nOpenAI / Anthropic / Gemini]

  R -->|Managed mode| MK[(Platform Provider Keys)]
  R -->|Managed mode| M2[Model Provider APIs\nOpenAI / Anthropic / Gemini]

  M1 --> O[Usage Collector]
  M2 --> O

  O --> DB[(Usage DB)]
  O --> AGG[Hourly Aggregator]
  AGG --> ST[Stripe Meter Events]

  DB --> C[Console Dashboard]
  ST --> B[Invoices / Billing]

  G --> H[Health + Observability]
  H --> C
```

## Notes
- Every request is tenant-scoped.
- Usage is recorded before billing aggregation.
- Spend caps can block managed requests in real time.
- BYOK keys are encrypted and redacted from logs.
