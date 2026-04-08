# 08 — Risk Manager verdict loop-back (TODO)

Spec: `doc/agent/{MARKERS,ROLES}.md`. After the Risk Manager runs (phase 07), its verdict must flow back to the analyst so the next analyst turn knows whether the run was approved or rejected.

## Tests first

1. RM emits a verdict marker (e.g. `[RM_APPROVE]` / `[RM_REJECT] <reason>`). New marker(s) added to `agent-markers.ts`.
2. **approve verdict** — server retriggers the analyst with the verdict embedded in the prompt. The next analyst turn can reference the validation as a fact.
3. **reject verdict** — same retrigger, plus `[RUN_PAPER]` (phase 11) is gated: the runs row is *not* marked validated, so the `RUN_PAPER.requires` guard fails until a fresh validation passes.
4. RM cannot retrigger itself — only analyst turns are retriggered after a verdict.
5. Verdict markers stripped before persistence.

## Then implement

- New verdict markers in `packages/shared/src/agent-markers.ts`.
- Verdict parser + dispatcher in `agent-trigger.ts` (only fires when the current session role is `risk_manager`).
- `runs.validatedAt` / `runs.validatedBy` columns if missing.
- Loop-back: re-dispatch analyst turn with the verdict in the next prompt context.
