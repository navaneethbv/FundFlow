# Archive

Point-in-time documents kept for provenance.
None of it is current truth: read it to understand why something was done, never to learn how the app works today.
For that, start at [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

Everything here was moved, not rewritten, so links inside these files may point at paths that have since changed.

## Closed reviews

Each of these was worked to completion; the fixes are on `main`.

| File | Date | What it was |
| --- | --- | --- |
| [`CODE_REVIEW-2026-08-10.md`](CODE_REVIEW-2026-08-10.md) | 2026-08-10 | Full-repository code review. Findings H1-H5, M1-M15, L1-L12, all resolved. |
| [`Security-Review-2026-08-10.md`](Security-Review-2026-08-10.md) | 2026-08-10 | Security half of the same pass, closed by `828e390`. |
| [`Frontend-Review-2026-08-12.md`](Frontend-Review-2026-08-12.md) | 2026-08-12 | Frontend review summary. |
| [`Frontend-Review-All-Files-2026-08-12.md`](Frontend-Review-All-Files-2026-08-12.md) | 2026-08-12 | Per-file frontend findings, resolved by `16ae1de`. |

The current security posture is maintained by the repository rules in
`CLAUDE.md`, the subsystem invariants in `../ARCHITECTURE.md`, and fresh review
evidence attached to the active pull request.

The 2026-08-20 security review and the 2026-09-02 PR #149 review are historical
records in this archive.

## Superseded planning and changelogs

| File | Date | Superseded by |
| --- | --- | --- |
| [`todos-2026-07.md`](todos-2026-07.md) | 2026-07-12 | [`../TODO.md`](../TODO.md) |
| [`TODO-completed.md`](TODO-completed.md) | rolling | [`../TODO.md`](../TODO.md) |
| [`HANDOFF-2026-07-to-08.md`](HANDOFF-2026-07-to-08.md) | 2026-07 to 08 | [`../HANDOFF.md`](../HANDOFF.md) |
| [`CHANGES-roadmap-2026-07-23.md`](CHANGES-roadmap-2026-07-23.md) | 2026-07-23 | [`../TODO.md`](../TODO.md) |
| [`CHANGES-sessions-1-8.md`](CHANGES-sessions-1-8.md) | 2026-07-05 | [`../HANDOFF.md`](../HANDOFF.md) |
| [`CODE_REVIEW-PR149-2026-09-02.md`](CODE_REVIEW-PR149-2026-09-02.md) | 2026-09-02 | PR #149 review and remediation work, completed by PR #151. |
| [`CODE_REVIEW-PR149-FIX-PROMPT.md`](CODE_REVIEW-PR149-FIX-PROMPT.md) | 2026-09-02 | Historical implementation handoff for PR #149. |
| [`FRONTEND-REVIEW-2026-09-DESIGN.md`](FRONTEND-REVIEW-2026-09-DESIGN.md) | 2026-09-01 | Frontend interaction and accessibility design, shipped by PR #145. |
| [`FRONTEND-REVIEW-2026-09-PLAN.md`](FRONTEND-REVIEW-2026-09-PLAN.md) | 2026-09-01 | Frontend implementation plan, shipped by PR #145. |
| [`FRONTEND-REVIEW-2026-09-SPEC.md`](FRONTEND-REVIEW-2026-09-SPEC.md) | 2026-09-01 | Frontend review specification, shipped by PR #145. |
| [`Monarch-Production-Comparison-2026-08-29.md`](Monarch-Production-Comparison-2026-08-29.md) | 2026-08-29 | Production comparison that preceded the current parity findings. |
| [`Security-Review-2026-08-20.md`](Security-Review-2026-08-20.md) | 2026-08-20 | Production-readiness security review. |
| [`ui-review-2026-08-28.md`](ui-review-2026-08-28.md) | 2026-08-28 | Large-data UI review for PR #134. |
| [`ui-review-remediation-2026-08-28.md`](ui-review-remediation-2026-08-28.md) | 2026-08-28 | PR #134 remediation evidence. |
| [`ui-review-remediation-prompt-2026-08-28.md`](ui-review-remediation-prompt-2026-08-28.md) | 2026-08-28 | Historical implementation prompt for PR #134. |

## Shipped plans and specs

Implementation plans and design specs whose work has landed live in
[`../superpowers/archive/`](../superpowers/archive/). The 14-phase Monarch
parity program, the register rollout, the frontend review, and the hybrid
recurring work are historical records there.
The active parity follow-up remains in
`../superpowers/plans/2026-09-03-fundflow-ui-and-monarch-parity-remediation.md`.
Plans still in flight stay in `../superpowers/plans/`.
