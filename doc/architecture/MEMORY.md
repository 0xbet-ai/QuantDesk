# Long-term Memory

## Problem

AI CLI sessions have a context window limit. A desk with 10+ experiments and 50+ comments will exceed it. We need to compress old conversations while preserving important decisions and insights.

## Approach

Adopt the compaction algorithm from [hipocampus](https://github.com/kevin-hs-sohn/hipocampus) (see `doc/REFERENCES.md`), adapted to our DB storage.

Hipocampus uses a 5-level hierarchical compaction tree (Raw -> Daily -> Weekly -> Monthly -> ROOT) with threshold-based summarization. We map this to our domain:

| Hipocampus level | QuantDesk equivalent | Storage |
|------------------|---------------------|---------|
| Raw | Comments | `comments` table |
| Daily | Per-experiment | `memory_summaries` (level = "experiment") |
| Weekly/Monthly | Per-desk | `memory_summaries` (level = "desk") |
| ROOT | Desk context | `memory_summaries` (level = "root") |

## Agent Context Loading

When agent is invoked, the prompt is assembled:
1. ROOT summary (desk-level overview)
2. Recent experiment summaries
3. Last N raw comments from current experiment

## Implementation

Follow hipocampus's implementation for:
- **Threshold-based compaction**: below threshold = copy verbatim, above = LLM summarize
- **Fixed/tentative lifecycle**: tentative nodes regenerated when new data arrives, fixed nodes (period ended + grace) never touched
- **Token budgeting**: ROOT capped at ~3K tokens, experiment summaries at ~500 tokens each
- **Secret scanning**: redact API keys/tokens via regex before summarization
- **Preservation rules**: `user` and `feedback` type entries survive indefinitely

See hipocampus source for chunking, overflow handling, and failure recovery patterns.
