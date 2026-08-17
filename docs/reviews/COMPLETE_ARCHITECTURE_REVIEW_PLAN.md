# Complete Architecture Re-review Plan

## Scope

The review is fixed to the final head of `refactor/complete-architecture-boundaries` after the Daily pipeline and CLI composition refactor.

## Source-first order

1. Inspect the final diff from `master` without reading prior PR descriptions.
2. Reconstruct the executable call chain from `bin/x` through the composition root, root router, Daily CLI adapter, Daily Application boundary, and runtime/capability dependencies.
3. Verify behavior contracts from tests and source: argument precedence, error order, failure/partial-success policy, progress artifacts, yearly aggregation, strategy selection, reporting, commit behavior, and exit codes.
4. Check separation boundaries: the entry owns only startup/error handling; routing owns dispatch; CLI adapters own argv parsing/presentation; Application owns sequencing; infrastructure is injected; composition owns concrete wiring.
5. Run syntax checks, targeted architecture tests, the complete test suite, and CI on the fixed SHA.
6. Record every finding with severity, evidence, remediation, and verification. Do not approve while any material finding remains open.

## Completion gate

The refactor is complete only when the independent review has no unresolved material findings, all remediation commits are included in the reviewed head, and both PR CI and post-merge `master` CI pass.