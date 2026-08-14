# Temporal Execution Profile Design

## Status

Implemented through date-aware simulation execution.

When both `executionModel` and request `securityMetadata` are omitted, the drawdown-simulation path resolves an effective-dated execution-profile timeline and supplies a context-aware `BuyExecutionModelProvider` to the portfolio simulator. A trade signal emitted on date `D` is evaluated with the execution profile effective on its candidate execution date, currently the next trading bar `D+1`, rather than with the profile effective on the signal date or only at the simulation cutoff.

Request `securityMetadata` remains a separate single-profile classification override, and explicit `executionModel` remains a research override. Neither path is silently converted into the repository-backed temporal mode.

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
signal date:         2026-06-30
execution date:      2026-07-01
profile transition:  2026-07-01
```

The trade must use the profile effective on `2026-07-01`.

## Design goals

1. Preserve separation between security facts, profile selection, model construction, execution timing, and portfolio accounting.
2. Reuse Security Master effective ranges and precedence rules instead of creating a second security-classification rule store.
3. Make missing temporal coverage explicit and fail closed at the Application/provider boundary.
4. Select repository-backed automatic execution mechanics by the candidate execution date, not by the signal date.
5. Keep execution timing out of Portfolio; the execution-model provider owns buy-context model selection.
6. Keep request `securityMetadata` as an explicit classification override with its current static-profile semantics.
7. Keep `frictionless` as an explicit research override, not a security profile.
8. Reuse one deterministic next-execution-bar calculation across provider selection and concrete execution models.
9. Keep MCP schema stable; temporal behavior is an internal Application/Capability improvement.
10. Never infer ETF category or T+0 eligibility from security-code prefixes.

## Non-goals

This design does not:

- redefine transaction fees, lot sizes, price limits, or settlement mechanics;
- expose a new MCP tool;
- convert `frictionless` into Security Master metadata;
- define exchange rules from hard-coded security-code prefixes;
- make execution timing itself historically variable;
- claim that all future execution profiles must use next-trading-day-open timing;
- silently change request `securityMetadata` into repository-backed temporal classification.

Current automatic catalog profiles share the same next-trading-day-open timing. The provider can therefore use the shared timing Logic before choosing the concrete model. If a future profile changes execution timing itself, scheduling must become an explicit independent capability rather than leaking timing rules into Portfolio or Security Master.

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
TimelineBuyExecutionModelProvider.resolveForBuy({ bars, signalDate })
      |
      +-> resolveNextExecutionBar Logic
      |      |
      |      v
      |   candidate execution date
      |
      +-> timeline segment -> profile id
      |
      +-> BuyExecutionModelResolver Port
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
- **TimelineBuyExecutionModelProvider** owns buy-context model selection: it derives the candidate execution date with shared Logic, selects the effective profile segment, and asks the model resolver for the model.
- **BuyExecutionModelResolver** remains the separate authority for constructing concrete execution models from public model/profile ids.
- **Portfolio** owns account/order orchestration only. It delegates selection through `resolveForBuy({ bars, signalDate })` and does not calculate execution timing.
- **Execution-model support Logic** owns the deterministic next-execution-bar calculation shared by provider selection and concrete next-open models.

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

The current simulation has three intentionally separate selection paths:

```text
executionModel supplied
  -> explicit_override
  -> one explicitly requested model
  -> bypass Security Master classification

executionModel omitted + request securityMetadata supplied
  -> security_metadata
  -> SecurityExecutionProfileResolver
  -> one static profile/model for the request
  -> no Security Master timeline read

executionModel omitted + request securityMetadata omitted
  -> security_metadata_timeline
  -> ResolveExecutionProfileTimelineUseCase
  -> Security Master temporal profile segments
  -> TimelineBuyExecutionModelProvider
```

Only `security_metadata_timeline` is repository-backed temporal selection today.

For that mode, `config.executionModel` is a compact summary: it is the profile id when every temporal segment maps to the same profile, otherwise `null`. The authoritative per-date information is `meta.executionSelection.timeline[]`, and the provider is the authority for per-buy model selection.

Request `securityMetadata` deliberately keeps its current static-profile semantics until a later execution-assumption timeline design explicitly unifies market-rule history. This avoids changing a caller-controlled override implicitly.

## Execution-date semantics

Current catalog-backed buy models execute at the next trading-day open. The candidate execution date therefore comes from the next available K-line bar after the signal bar.

The deterministic helper is shared rather than duplicated:

```text
bars + signalDate
      |
      v
resolveNextExecutionBar
      |
      +-------------------------------+
      |                               |
      v                               v
Timeline provider effective date   BuyExecutionModel execution bar
      |                               |
      v                               v
profile/model selection            fill / skip result
```

This preserves one authoritative definition of "next execution bar" and prevents a boundary bug where model selection uses one date while the model fills on another.

For a signal on `D` whose next trading bar is `D+1`:

```text
provider effective date = D+1
model execution date    = D+1
```

A profile transition between `D` and `D+1` therefore uses the `D+1` profile.

If no next execution bar exists, there is no possible fill. The provider uses the signal-date segment only to obtain a model capable of returning the normal `skipped_no_execution_bar` result. This fallback does not apply market mechanics to a trade because no execution occurs.

## BuyExecutionModelProvider boundary

The provider Port intentionally owns buy-context selection rather than accepting a caller-selected date:

```text
resolveForBuy({ bars, signalDate }) -> BuyExecutionModel
```

`TimelineBuyExecutionModelProvider` owns:

- validating timeline segments;
- resolving the candidate execution date through shared `resolveNextExecutionBar` Logic;
- finding the segment that covers the effective date;
- failing closed when an actual execution date is uncovered;
- resolving a model through `BuyExecutionModelResolver`;
- caching already-constructed models by profile id.

It does not:

- read Security Master;
- classify securities;
- calculate business signals;
- execute portfolio/account logic.

Portfolio therefore cannot accidentally apply signal-date rules by manually choosing a date. It delegates the full buy context and remains timing-agnostic.

## Override semantics

The public simulation contract keeps caller-controlled overrides separate from repository-backed automatic classification:

```text
executionModel supplied
  -> explicit_override
  -> do not consult Security Master or temporal profile resolver

securityMetadata supplied, executionModel omitted
  -> security_metadata
  -> classify the supplied metadata once
  -> use one static profile/model

both omitted
  -> security_metadata_timeline
  -> resolve temporal repository facts/profile segments
  -> provider selects model by candidate execution date
```

`frictionless` remains available only through the explicit `executionModel` path. It is intentionally not a Security Master fact or an automatic execution profile.

## Architecture fitness rules

- Temporal Application code may depend on `SecurityMasterTimelineReader` and `SecurityExecutionProfileResolver` Ports only.
- Temporal Application code must not import Ledger adapters or filesystem APIs.
- Ledger timeline code must not import execution profile catalogs or execution models.
- The timeline Reader must not encode `legacy_a_share`, `domestic_stock_etf`, `t0_etf`, or `frictionless`.
- `TimelineBuyExecutionModelProvider` may depend on shared execution-timing Logic and `BuyExecutionModelResolver`, but not on Security Master storage.
- `BuyOnlyPortfolioSimulator` must not import execution timing Logic, read Security Master, inspect ETF type, or map metadata to profile ids.
- MCP adapters must not read Security Master timelines directly.
- Missing temporal coverage must never be filled by code-prefix inference or by applying a future record backward in time.
- Candidate execution-date calculation must have one authoritative deterministic implementation shared by provider selection and concrete next-open models.
- Request `securityMetadata` and explicit `executionModel` semantics must not be silently changed by repository temporal composition.

## Verification

The temporal execution test suite must cover at least:

1. Security Master precedence and effective-date changes.
2. Complete temporal coverage and fail-closed gaps.
3. Metadata-to-profile transitions without constructing execution models inside temporal Application code.
4. A signal whose next execution bar crosses a profile boundary and therefore resolves the profile effective on the execution date.
5. The no-next-bar path, which must not fabricate an execution date.
6. An actual execution date outside timeline coverage failing closed.
7. Provider Port exposing `resolveForBuy`, not the old caller-selected `resolveForDate` contract.
8. Portfolio remaining free of `resolveNextExecutionBar` and other execution-timing ownership.
9. Explicit execution-model override bypassing automatic temporal classification.
10. Request `securityMetadata` remaining a separate static classification override.
11. Architecture fitness boundaries between storage, temporal classification, model construction, execution timing, portfolio orchestration, and MCP.

## Incremental delivery

Completed:

1. Add the design and `SecurityMasterTimelineReader` Port.
2. Add a Ledger timeline adapter that preserves Security Master precedence and reports gaps.
3. Add `ResolveExecutionProfileTimelineUseCase` with transition and fail-closed coverage tests.
4. Compose the temporal reader/resolver into MCP Application wiring.
5. Add `BuyExecutionModelProvider` and `TimelineBuyExecutionModelProvider`.
6. Integrate the provider into `BuyOnlyPortfolioSimulator` while preserving explicit overrides.
7. Select repository-backed automatic models by candidate execution date and share the next-execution-bar Logic with concrete next-open models.
8. Move execution-date resolution fully behind `BuyExecutionModelProvider.resolveForBuy`, keeping timing Logic out of Portfolio.
9. Add regression tests for profile-boundary transitions, missing execution-date coverage, and Portfolio timing isolation.

## Remaining scope

Temporal security classification is now integrated end-to-end for the current next-open buy simulation. The next independent realism problem is not another security metadata lookup layer; it is historical versioning of execution mechanics themselves when those mechanics change over time, for example fee schedules, price-limit rules, lot rules, or other market-rule assumptions.

That work remains separate from Security Master facts. The accepted next design is documented in `docs/TEMPORAL_EXECUTION_ASSUMPTIONS_DESIGN.md`: keep stable profile-family ids, add effective-dated `ExecutionProfileRevision` data with provenance, resolve a separate market-rule timeline, and combine it with the security profile-family timeline before model construction. It must not put fee tables or exchange-rule logic into Security Master, MCP adapters, Portfolio, or Business policies.
