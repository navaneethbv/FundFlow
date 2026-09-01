# ADR 001: Explicit Classification of Credit Score Tracking as Out of Scope

## Status
Approved / Documented

## Context
FundFlow's comparison with Monarch Money identifies that Monarch offers third-party credit score tracking (powered by credit bureau partner integrations).

FundFlow is a local/self-hostable and privacy-preserving personal finance application designed around:
1. Direct Plaid aggregator bank connections.
2. User-owned ledger data with cryptographic zero-knowledge/local security properties.
3. Accurate cash-flow, budgeting, net worth tracking, and funded goal planning.

## Decision
Credit score tracking is explicitly classified as **Out of Scope** for FundFlow core application and will NOT be simulated or fabricated.

## Rationale
1. **Regulatory & Compliance Burden**: Ingestion and display of consumer credit bureau data requires strict compliance with the Fair Credit Reporting Act (FCRA), Gramm-Leach-Bliley Act (GLBA), SOC2 Type II audits, and permissible-purpose agreements with credit bureaus (Experian, TransUnion, Equifax).
2. **Provider Contract Requirements**: Credit score tracking cannot be derived from bank transaction aggregators (like Plaid Transactions or Investments). It requires separate enterprise agreements with dedicated credit-data providers (e.g. Array, Bloom, or direct bureau APIs) requiring SSN collection and identity verification infrastructure.
3. **Data Integrity Principle**: In accordance with FundFlow's core invariants, FundFlow will never mock, fabricate, or synthetically estimate credit scores without real provider backing.
4. **Privacy Focus**: Maintaining FundFlow's current minimal PII footprint (no SSN required) provides greater security and privacy for users.

## Consequences
- The FundFlow UI will not display credit score cards or estimates.
- The comparison report records this difference as an intentional design decision and architectural boundary rather than a missing defect.
