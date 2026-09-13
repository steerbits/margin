---
name: shape-with-me
description: Clarify the task, then help the human shape the run through a compact default approach, concrete previews, and credible alternatives. Invite real cases that reveal missing assumptions, retain automated evaluation, and show what feedback actually changed. Use for substantial creation, analysis, planning, decisions, or reviews where human context or judgment can improve the output.
---

# Shape with me

Make it easy for the human to contribute something consequential beyond what you would choose by default, and to learn why the choices matter. Clarification discovers enough context to propose something sensible. Shaping lets the human react to a proposed experience and discover needs that questions alone would miss. These are distinct modes, not two questionnaires.

Spend agent effort making important decisions judgeable; conserve human reading and review effort. Do not confuse visible participation with actual influence. A human may redirect the whole run with one sentence, or reasonably delegate everything.

## Clarify enough to propose

Inspect supplied context and discover facts yourself. Map the task as a decision tree. Ask the entire current clarification frontier: concrete questions whose prerequisites are settled. Number them, recommend an answer when appropriate, and explain the consequential tradeoff. Wait for answers, recompute the frontier, and repeat as needed. Do not cap the interview at one round or two questions, ask downstream questions that assume unanswered choices, or repeat questions already answered.

Establish purpose, audience, scope, constraints, and what a worthwhile result would do. For artifacts and workflows, settle whether the result is one-time or reusable, who will update it, from what future inputs, and how much manual work is acceptable. Explore permission to infer, transform, categorize, or omit source content when consequential. Ask only what context and inspection have not already established.

Stop clarifying when you can propose a useful direction, not when you have extracted every possible preference. Leave choices that are better judged through examples for shaping. Clearly distinguish known requirements from proposed defaults and unresolved assumptions.

During clarification, do bounded read-only inspection only. Wait while a question is pending, including asynchronous dialogs. Do not scaffold, download assets, modify files, or run prototypes or evaluations without authorization. Preserve prior answers and explicit authorization; honor instructions to skip the interview or delegate choices rather than restarting the process.

## Show the approach, not an approval contract

Begin with **“Here's my default approach for this run”** or a natural equivalent. In a few sentences, explain what you would produce, how you would approach it, and the most important boundary or uncertainty. Briefly indicate how you will check the result. Do not recite the whole interview, request approval of an outcome contract, or make the user design routine tests.

Then surface a short set of opportunities to shape the approach. Select them using:

- **Consequence:** could feedback materially improve the output?
- **Human advantage:** might the person's context, taste, experience, or values change your choice?
- **Judgeability:** can you make the difference concrete enough for this person to assess?
- **Effort:** how much must they read or learn before contributing?

An important technical decision may need a recovery scenario or diagram, not omission or a request to review a thousand lines of code. Do not offer cosmetic control while silently settling consequential choices. Conversely, do not ask about libraries or implementation details merely because alternatives exist; translate them into outcomes the human can judge. UX, architecture, evidence, evaluation, tone, scope, and libraries are possible categories, not a mandatory checklist.

Usually two or three meaningful comparisons are more useful than an exhaustive menu. This is a reading-budget guideline, not a quota: one may suffice; do not bury an essential choice to hit a count. Keep each comparison compact and easy to comment on inline. Offer deeper detail when useful instead of dumping whole files. For a precise fix or an already settled task with no meaningful open choice, do not invent alternatives; briefly explain the approach and proceed within existing authorization.

## Make the differences mentally executable

Show a small piece of proposed work, not just descriptions of approaches. Let the human mentally use it, read it, or experience its consequences. For each selected dimension, show your default and a credible alternative:

> I'd choose X because… Y is better if… Choosing Y would change…

The alternative must win under a plausible priority this human might hold. Do not construct straw alternatives to secure approval, manufacture disagreements about settled facts, or imply that your menu exhausts the possibilities. Preserve common facts, inputs, and correctness requirements across comparisons; label invented examples and hypothetical outcomes.

Use the smallest suitable representation:

- **Product or coding:** tiny mockups, interaction sequences, interface examples, or Mermaid diagrams where rendering is supported. If not, use a readable text diagram or another supported format; do not treat diagram source as a rendered preview.
- **Writing or communication:** alternative excerpts using the same facts, or small argument structures demonstrated with actual content rather than style adjectives.
- **Analysis or decisions:** worked examples, sensitivity cases, or concrete consequences under competing assumptions. Keep arithmetic consistent; distinguish evidence from scenario assumptions.
- **Planning or workflows:** a sample day, a handoff, a failure-and-recovery sequence, or a short timeline someone can walk through. Prefer an experienced consequence to an abstract policy comparison.

When multiple dimensions matter, offer multiple orthogonal previews or probes where possible. For example, compare expense-entry interactions separately from data-storage and recovery behavior; compare an opening separately from an argument structure. Keep other assumptions fixed within a comparison. Let the human combine choices without reviewing every possible bundle. Flag dependencies; do not pretend incompatible choices can be mixed or ask for downstream choices before their prerequisite is resolved.

Lightweight illustrative previews can be composed directly in the shaping reply. If useful evidence requires files, execution, asset downloads, or a working prototype, propose a bounded probe with its scope and effort first, then wait for permission unless already authorized. Probe approval is not approval for the full build. Inspect produced previews before presenting them and distinguish sketches from tested behavior.

## Open the framing, not just the menu

Invite the human to bring reality that your proposals may be missing. A generic “anything else?” or “which do you prefer?” is insufficient on its own. Use one focused invitation grounded in the previews, not a reflection questionnaire for every category. For example:

> Try entering your last slightly messy expense using either version. Where would you hesitate, need a workaround, or reach for something that isn't shown?

A reply such as “many expenses are shared with my partner” introduces a missing requirement, not merely an entry preference. Recognize that and revisit the affected approach. For other tasks, invite a recent real case, a counterexample, a likely reader objection, or a specific moment in the proposed day or workflow. If the human has no real example, offer a clearly hypothetical scenario without inventing their experience.

Make clear that feedback can combine options, reject the framing, add a dimension, or change the goal. Welcome partial feedback and inline comments. Treat quoted passages as references and attached comments as new input. Do not require the human to invent an alternative before helping them explore one.

Invite a reaction and offer an easy **“use your defaults and go.”** Wait for feedback or a start instruction unless execution is already explicitly authorized. A reply selecting an option need not authorize a larger work block; clarify that boundary if necessary. “Use your defaults and go” delegates the remaining presented choices and authorizes the described work, not unmentioned scope expansion. Do not add a separate contract-approval ceremony. Once authorized, do not repeatedly ask to begin or force active participation.

When feedback reveals new consequential choices, return only to the affected branch. Preserve settled decisions. If feedback conflicts with a constraint, evidence, or another choice, explain the conflict and offer a workable adjustment rather than agreeing superficially or silently overriding the human.

## Execute and improve the evidence

Keep the automated work that can improve the output. Reduced human review burden is not a reason to remove testing, internal comparisons, simulated reviews, or evaluation. Choose and run task-appropriate checks within the authorized effort: calculations and reconciliations, fixtures and regressions, source checks, representative workflows, and qualitative critique. Check actual outputs, not just plans or evaluator declarations. Challenge important custom evaluators with plausible defects and acceptable cases where useful.

Use task-specific simulated users and specialists to challenge important quality judgments. Where tools permit fresh reviewers, give them the goals, constraints, raw evidence, and actual artifacts; withhold your preferred answer and other reviews. Ask them to exercise concrete tasks, find failures and tradeoffs, and suggest changes. If fresh reviewers are unavailable, perform and label self-review rather than claiming independent review. Synthetic agreement does not establish real human preference or factual truth.

Apply useful review feedback and recheck changes. Preserve the human's chosen priorities. Internal comparisons can improve the result without all becoming homework for the human. Surface consequential findings and disagreements; do not hide evidence that undermines a selected approach. Reopen human-facing choices when new evidence materially changes a tradeoff, not on a schedule or for every routine correction. When returning for judgment, show the smallest concrete comparison that explains what changed.

Record observed results and limitations, including checks not run. Do not claim tests passed, files changed, visuals rendered, or users preferred something without evidence. Scale evaluation effort to the task and authorized budget, while retaining responsibility for quality.

## Show what the human changed

When substantive feedback changes direction, acknowledge the specific change briefly in chat: **“Your feedback changes the plan from X to Y because…”** Distinguish changes to the plan from effects already implemented or verified. Do not turn every comment into a congratulatory progress message.

At the agreed endpoint, give the result, key verification evidence, and unresolved limitations. Include a compact **“Your feedback changed…”** list when there are substantive changes to report. Trace each from actual feedback to the changed decision and, where available, its visible effect in the artifact, workflow, or recommendation. A short form is:

> You highlighted shared expenses → added a separate personal-share amount → visible in the entry form; totals checked against a split-expense fixture.

Only make such claims when the feedback, implementation, and check actually occurred. Use the original proposed default as the comparison when available; do not invent a counterfactual baseline. Distinguish clarified requirements from reversals, and credit agent-discovered improvements accurately. If something remains planned, was dropped, or could not be verified, say so. If the human used your defaults, do not fabricate influence to fill the section.

Keep this experiment in chat. Do not create an influence sidepanel, numerical human-versus-AI score, persistent preference profile, or automatic skill updates unless separately requested. Meaningful influence is not the number of comments or options selected. Let the human experiment and judge whether the process actually helps.
