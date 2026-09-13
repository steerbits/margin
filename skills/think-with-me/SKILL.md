---
name: think-with-me
description: Interview the user through consequential decisions, prefill an outcome and evaluation contract, then execute with task-specific checks, simulated reviews, and contrastive feedback. Use for substantial creation, analysis, decisions, or reviews where scope or success remains uncertain.
---

# Think with me

Develop shared understanding before committing to a solution. Then improve both the output and the evidence for its quality. Spend human attention on consequential choices, especially those that tests alone cannot settle.

## Interview through the decision tree

Inspect supplied context and discover facts yourself. Map the task as a tree of decisions. Ask the entire current frontier: concrete questions whose prerequisites are settled. Number them, recommend an answer, and explain the consequential tradeoff. Wait for the answers, recompute the frontier, and repeat. Do not cap the interview at one round or two questions. Do not ask downstream questions that assume an unanswered choice.

Keep purpose, audience, scope, constraints, and success in view. For artifacts and workflows, explicitly settle whether this is a one-time result or a reusable solution; ask who will update it, from what future inputs, and how much manual work is acceptable. Explore permission to infer, transform, categorize, or omit content when those choices matter. Let answers uncover further decisions rather than treating this as a checklist.

A preference is the user's decision. Resolve it through an answer or an explicitly agreed exploratory branch; do not quietly replace it with your preferred architecture. Accepting recommendations answers only the questions actually asked. It does not settle unasked branches or authorize execution.

During the interview, perform bounded read-only inspection only. If a question is pending, wait even when the question tool is asynchronous. Do not scaffold, write implementation files, download assets, or run prototypes/evaluations before the start agreement. Parallel fact-finding may continue without committing to a solution.

End the interview when consequential branches are settled or explicitly deferred to a useful probe. Preserve existing answers and explicit authorization; honor an instruction to skip the interview.

## Prefill a compact contract

Write the contract yourself from the conversation:

- **Purpose and worthwhile outcome:** whose task or decision the work serves.
- **Deliverable and scope:** boundaries, source fidelity, future inputs, maintenance, and what the user has ruled out.
- **Success and evidence:** measurable behavior and how you will check it; hard-to-verify qualities, suitable reviewer perspectives, and comparisons for human judgment.
- **Assumptions and gaps:** distinguish confirmed requirements from proposed defaults; explain what the planned evidence cannot establish.
- **First commitment:** the next work block, any agreed effort limit, autonomy, and when to stop or return for a decision.

Choose routine automatic checks yourself; the user need not design or approve individual tests. Make consequential coverage and remaining judgments visible. Invite corrections to the contract and explicitly ask to begin. Then wait. An affirmative answer to that start question is sufficient. Do not repeat start approval during authorized work.

## Execute, evaluate, and explore

Use evaluations appropriate to the task: calculations and reconciliations, fixtures and regressions, source checks, representative workflows, or qualitative critique. Check actual outputs. Challenge important custom evaluators with plausible defects and acceptable cases where useful. Record observed results and limits, not just planned checks or declared passes.

For qualities that remain uncertain, use task-specific simulated users and specialists. Give fresh reviewers the goals, constraints, raw evidence, and actual artifacts; withhold your preferred answer and other reviews. Ask them to exercise concrete tasks, identify failures and tradeoffs, and suggest changes. Label simulation and self-review accurately. Synthetic agreement does not establish real human preference or factual truth.

Create contrasting outputs only when they help resolve a meaningful choice. Alternatives can be spreadsheet workflows or scenarios, code interfaces, explanations, recommendations, or communication approaches. Preserve common facts and correctness requirements; do not manufacture different answers to a settled calculation. A workbook might compare an audit-friendly transaction view with a decision-oriented summary using the same data, reviewed by an analyst and its future operator.

Use the smallest useful comparison, often two or three alternatives, before expensive full builds. Apply review feedback and recheck changes without erasing meaningful differences. Present the alternatives with tradeoffs and disagreements, then ask what the user prefers, dislikes, or would combine, and why. Feed that answer back into the decision tree and contract.

A precise fix may need one output and objective tests; an uncertain analysis may need sensitivity checks rather than multiple artifacts. Scale effort to the remaining uncertainty. Stop at the agreed endpoint, report evidence and unresolved limitations, and preserve the user's choice where judgment remains.
