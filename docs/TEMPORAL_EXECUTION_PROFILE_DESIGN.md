# Temporal Execution Profile Design

## Status

Implemented through date-aware simulation execution.

The automatic drawdown-simulation path now resolves an effective-dated execution-profile timeline and supplies a date-aware `BuyExecutionModelProvider` to the portfolio simulator. A trade signal emitted on date `D` is evaluated with the execution profile effective on its candidate execution date, currently the next trading bar `D+1`, rather than with the profile effective on the signal date or only at the simulation cutoff.

Explicit `executionModel` requests remain a separate research override and bypass Security Master classification.

## Problem

A historical simulation can cross a date at which security facts change. Resolving metadata only at the simulation `endDate` avoids using facts collected after the backtest, but still applies one execution profile to the whole interval.

Example:

```text
2026-01-01 .. 2026-06-30  ETF, intraday round-trip eligible
2026-07-01 .. open        ETF, not intraday round-trip eligible
```

A simulation that spans both periods must preserve the temporal facts and apply the corresponding execution mechanics at the date on which each trade would execute.

The distinction between signal date and execution date is important. With the current next-trading-day-open execution model:

```text
signal date:       2026-06-30
execution date:    2026-07-01
profile transition: 2026-07-01
```

The trade must use the profile effective on `2026-07-01`.

## Design goals

1. Preserve separation between security facts, profile selection, model construction, and execution.
2. Reuse Security Master effective ranges and precedence rules instead of creating a second rule store.
3. Make missing temporal coverage explicit and fail closed at the Application boundary.
4. Select automatic execution mechanics by the candidate execution date, not by the signal date.
5. Keep `frictionless` as an explicit research override, not a security profile.
6. Reuse one deterministic execution-date calculation across provider selection and concrete execution models.
7. Keep MCP schema stable; temporal behavior is an internal Application/Capability improvement.
8. Never infer ETF category or T+0 eligibility from security-code prefixes.

## Non-goals

This design does not:

- redefine transaction fees, lot sizes, price limits, or settlement mechanics;
- expose a new MCP tool;
- convert `frictionless` into Security Master metadata;
- define exchange rules from hard-coded security-code prefixes;
- make execution timing itself historically variable;
- claim that all future execution profiles must use next-trading-day-open timing.

The last two points are deliberate scope boundaries. Current automatic catalog profiles share the same next-trading-day-open timing, so execution-date profile selection can safely derive the candidate execution bar before choosing the concrete model. If a future profile changes execution timing itself, timing resolution must become an explicit independent capability rather than being inferred from the already-selected profile.

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
      |
      v
TimelineBuyExecutionModelProvider
      |
      | execution date -> profile id
      v
BuyExecutionModelResolver Port
      |
      v
BuyExecutionModel
      |
      v
BuyOnlyPortfolioSimulator
```

The responsibilities are intentionally different:

- **Security Master** stores auditable security facts and effective intervals.
- **Timeline Reader** applies repository precedence and converts overlapping records into a deterministic winning fact timeline.
- **Temporal Application** requires complete coverage and maps each winning fact segment to a public execution profile id.
- **SecurityExecutionProfileResolver** remains the single authority for mapping security metadata to profile ids.
- **TimelineBuyExecutionModelProvider** maps an execution date to the already-resolved profile timeline and asks the model resolver for the corresponding model.
- **BuyExecutionModelResolver** remains the separate authority for constructing concrete execution models from public model/profile ids.
- **Portfolio** owns account orchestration only. It does not read Security Master, inspect ETF categories, or decide profile ids.
- **Execution-model support Logic** owns the deterministic next-execution-bar calculation shared by portfolio selection and concrete next-open models.

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

The Ledger adapter derives a minimal set of change boundaries from existing Security Master entries:

1. requested `startDate`;
2. every candidate record `effectiveFrom` inside the requested interval;
3. the calendar day after every candidate `effectiveTo` inside the requested interval.

For each resulting interval, the adapter selects the first effective entry using the same priority order already used by the Ledger Security Master reader. Adjacent intervals with the same winning record may be merged.

This avoids scanning every calendar day and preserves point-in-time precedence semantics.

## Temporal Application contract

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

The Application fails closed when:

- the requested date interval is invalid;
- Security Master has no coverage for any part of the requested interval;
- metadata cannot be mapped by `SecurityExecutionProfileResolver`.

It does not construct a `BuyExecutionModel` and does not import Ledger, MCP, HTTP, or filesystem implementations.

## Simulation integration

The automatic simulation path now has two internal sources for an execution timeline:

```text
request securityMetadata supplied
  -> build one static metadata/profile segment for the requested coverage

request securityMetadata omitted
  -> ResolveExecutionProfileTimelineUseCase
  -> Security Master temporal profile segments
```

Both paths then build a date-aware execution-model provider. This keeps request-supplied facts and repository-supplied facts on the same execution boundary.

The externally visible automatic selection mode is:

```text
security_metadata_timeline
```

The simulation result may still expose the last effective `profileId` as a compact summary, but that value is not the authority for per-trade execution. The timeline/provider is the authority when automatic selection is active.

## Execution-date semantics

Current catalog-backed buy models execute at the next trading-day open. The candidate execution date therefore comes from the next available K-line bar after the signal bar.

The deterministic helper is shared rather than duplicated:

```text
bars + signalDate
      |
      v
resolveNextExecutionBar
      |
      +--------------------------+
      |                          |
      v                          v
Portfolio provider date       BuyExecutionModel execution bar
      |                          |
      v                          v
Timeline provider             fill / skip result
```

This preserves one authoritative definition of "next execution bar" and prevents a boundary bug where the provider selects one date while the model fills on another.

For a signal on `D` whose next trading bar is `D+1`:

```text
provider lookup date = D+1
model execution date = D+1
```

A profile transition between `D` and `D+1` therefore uses the `D+1` profile.

If no next execution bar exists, there is no possible fill. The provider may use the signal date only to obtain a model capable of returning the normal `skipped_no_execution_bar` result. This fallback does not apply any market mechanics to a trade because no execution occurs.

## Explicit override semantics

The public simulation contract keeps explicit research overrides separate from automatic classification:

```text
executionModel supplied
  -> explicit_override
  -> resolve one explicit model
  -> do not consult Security Master or the temporal profile resolver

executionModel omitted
  -> security_metadata_timeline
  -> resolve temporal facts/profile segments
  -> select model by candidate execution date
```

`frictionless` remains available only through the explicit override path. It is intentionally not a Security Master fact or an automatic execution profile.

## BuyExecutionModelProvider boundary

The current provider contract is intentionally narrow:

```text
resolveForDate({ date }) -> BuyExecutionModel
```

`TimelineBuyExecutionModelProvider` owns:

- validating timeline segments;
- finding the segment that covers the requested date;
- failing closed when the date is uncovered;
- resolving a model through `BuyExecutionModelResolver`;
- caching already-constructed models by profile id.

It does not:

- read Security Master;
- classify securities;
- calculate business signals;
- execute portfolio/account logic.

The portfolio does not know how profile ids are chosen. It only supplies the candidate execution date to the provider.

## Architecture fitness rules

- Temporal Application code may depend on `SecurityMasterTimelineReader` and `SecurityExecutionProfileResolver` Ports only.
- Temporal Application code must not import Ledger adapters or filesystem APIs.
- Ledger timeline code must not import execution profile catalogs or execution models.
- The timeline Reader must not encode `legacy_a_share`, `domestic_stock_etf`, `t0_etf`, or `frictionless`.
- `TimelineBuyExecutionModelProvider` may depend on `BuyExecutionModelResolver`, but not on Security Master storage.
- `BuyOnlyPortfolioSimulator` must not read Security Master, inspect ETF type, or map metadata to profile ids.
- MCP adapters must not read Security Master timelines directly.
- Missing temporal coverage must never be filled by code-prefix inference or by applying a future record backward in time.
- Candidate execution-date calculation must have one authoritative deterministic implementation shared by provider selection and concrete next-open models.

## Verification

The temporal execution test suite must cover at least:

1. Security Master precedence and effective-date changes.
2. Complete temporal coverage and fail-closed gaps.
3. Metadata-to-profile transitions without constructing execution models inside temporal Application code.
4. A signal whose next execution bar crosses a profile boundary and therefore resolves the profile effective on the execution date.
5. The no-next-bar path, which must not fabricate an execution date.
6. Explicit execution-model override bypassing automatic temporal classification.
7. Architecture fitness boundaries between storage, temporal classification, model construction, portfolio orchestration, and MCP.

## Incremental delivery

Completed:

1. Add the design and `SecurityMasterTimelineReader` Port.
2. Add a Ledger timeline adapter that preserves Security Master precedence and reports gaps.
3. Add `ResolveExecutionProfileTimelineUseCase` with transition and fail-closed coverage tests.
4. Compose the temporal reader/resolver into MCP Application wiring.
5. Add `BuyExecutionModelProvider` and `TimelineBuyExecutionModelProvider`.
6. Integrate the provider into `BuyOnlyPortfolioSimulator` while preserving explicit overrides.
7. Select automatic models by candidate execution date and share the next-execution-bar Logic with concrete next-open models.
8. Add a regression test for a signal crossing an execution-profile boundary.

## Remaining scope

Temporal security classification is now integrated end-to-end for the current next-open buy simulation. The next independent realism problem is not another metadata lookup layer; it is historical versioning of execution mechanics themselves when those mechanics change over time, for example fee schedules, price-limit rules, lot rules, or other market-rule assumptions.

That work should remain separate from Security Master facts. A future design should decide whether historically variable mechanics belong in effective-dated `ExecutionProfile` data, a dedicated market-rule timeline, or another narrow provider. It should not put fee tables or exchange-rule logic into Security Master, MCP adapters, or Business policies.
