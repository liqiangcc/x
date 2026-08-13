# Temporal Execution Profile Design

## Status

Design accepted for a minimal, independent capability slice. The existing drawdown simulation continues to select one execution profile at its simulation cutoff; this document does not change that behavior yet.

## Problem

The current automatic simulation path resolves security metadata at the simulation `endDate` and selects one `ExecutionProfile` for the whole run. That prevents future metadata from leaking into a historical run, but it cannot represent a security whose execution eligibility changes inside the requested interval.

Example:

```text
2026-01-01 .. 2026-06-30  ETF, intraday round-trip eligible
2026-07-01 .. open        ETF, not intraday round-trip eligible
```

A simulation covering both periods needs a temporal profile timeline before it can apply historically correct execution mechanics at each execution date.

## Design goals

1. Preserve separation between security facts, profile selection, model construction, and execution.
2. Reuse Security Master effective ranges and precedence rules instead of creating a second rule store.
3. Make missing temporal coverage explicit and fail closed at the Application boundary.
4. Keep `frictionless` as an explicit research override, not a security profile.
5. Do not change MCP schemas or the existing drawdown simulation in this slice.
6. Do not infer ETF category or T+0 eligibility from security codes.

## Non-goals

This slice does not:

- dynamically switch `BuyExecutionModel` inside `BuyOnlyPortfolioSimulator`;
- change transaction fees, lot sizes, price limits, or settlement mechanics;
- expose a new MCP tool;
- convert `frictionless` into Security Master metadata;
- define exchange rules from hard-coded security-code prefixes.

## Separation of concerns

```text
Security Master records
      |
      | effective ranges + provenance
      v
SecurityMasterTimelineReader Port
      |
      | resolved temporal facts, including gaps
      v
ResolveExecutionProfileTimelineUseCase
      |
      | facts -> profile id
      v
SecurityExecutionProfileResolver Port
      |
      v
Execution profile timeline
```

The responsibilities are intentionally different:

- **Security Master** stores auditable security facts and their effective intervals.
- **Timeline Reader** applies repository precedence and converts overlapping records into a deterministic winning timeline.
- **Application** requires complete coverage and maps each winning fact segment to a public execution profile id.
- **SecurityExecutionProfileResolver** remains the single authority for mapping security metadata to profile ids.
- **BuyExecutionModelResolver** remains the separate authority for constructing execution models from profile ids.

## Timeline Reader contract

A `SecurityMasterTimelineReader` exposes:

```text
readTimeline(security, { startDate, endDate })
  -> {
       security,
       startDate,
       endDate,
       segments: [
         {
           startDate,
           endDate,
           record
         }
       ],
       gaps: [
         {
           startDate,
           endDate
         }
       ],
       source
     }
```

Dates are inclusive.

The Reader owns repository precedence. If a lower-priority universe record and a higher-priority explicit record overlap, the winning record at each date must be identical to `SecurityMasterReader.readRecord(security, { asOf })`.

The Reader does **not** choose an execution profile. A gap is data, not a business decision, so gaps are returned explicitly rather than silently filled.

## Boundary construction

The Ledger adapter can derive a minimal set of change boundaries from existing Security Master entries:

1. requested `startDate`;
2. every candidate record `effectiveFrom` inside the requested interval;
3. the calendar day after every candidate `effectiveTo` inside the requested interval.

For each resulting interval, the adapter selects the first effective entry using the same priority order already used by the Ledger Security Master reader. Adjacent intervals with the same winning record may be merged.

This avoids scanning every calendar day and preserves current precedence semantics.

## Application contract

`ResolveExecutionProfileTimelineUseCase` consumes the timeline Reader and the existing `SecurityExecutionProfileResolver`.

Input:

```text
{
  security,
  startDate,
  endDate
}
```

Output:

```text
{
  security,
  startDate,
  endDate,
  segments: [
    {
      startDate,
      endDate,
      profileId,
      metadata: {
        instrumentType,
        intradayRoundTripEligible,
        effectiveFrom,
        effectiveTo,
        source,
        qualityIssues
      }
    }
  ]
}
```

The Application must fail closed when:

- the requested date interval is invalid;
- Security Master has no coverage for any part of the requested interval;
- metadata cannot be mapped by `SecurityExecutionProfileResolver`.

It must not construct a `BuyExecutionModel` and must not import Ledger, MCP, HTTP, or filesystem implementations.

## Explicit override semantics

The existing simulation contract remains unchanged:

```text
executionModel supplied
  -> explicit_override
  -> do not consult Security Master

executionModel omitted
  -> current simulation resolves one profile at endDate
```

A later integration step may add a third internal mode that consumes a temporal profile provider during execution. That integration must preserve the explicit override as a controlled research path.

## Future integration boundary

When the portfolio simulator gains date-aware execution, it should depend on an abstract provider such as:

```text
resolveExecutionModel({ security, date }) -> BuyExecutionModel
```

or an equivalent precomputed timeline adapter. The portfolio must not read Security Master, inspect ETF types, or resolve profile ids itself.

The temporal profile timeline introduced here is the input to that future provider; it is not the provider of concrete models itself.

## Architecture fitness rules

- Temporal Application code may depend on `SecurityMasterTimelineReader` and `SecurityExecutionProfileResolver` Ports only.
- Temporal Application code must not import `LedgerSecurityMasterReader` or filesystem APIs.
- Ledger timeline code must not import execution profile catalogs or execution models.
- The timeline Reader must not encode `legacy_a_share`, `domestic_stock_etf`, `t0_etf`, or `frictionless`.
- MCP adapters must not read Security Master timelines directly.
- Missing temporal coverage must never be filled by code-prefix inference or by applying a future record backward in time.

## Incremental delivery

1. Add this design and the timeline Reader Port.
2. Add a Ledger timeline adapter that preserves Security Master precedence and reports gaps.
3. Add `ResolveExecutionProfileTimelineUseCase` and tests for profile transitions and fail-closed gaps.
4. Only after the boundary is stable, evaluate date-aware execution-model selection inside the simulation engine.
