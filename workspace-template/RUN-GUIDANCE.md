Work the brief in `GOAL.md` in order.

Everything you make goes in this workspace: notes under `analysis/`, run output
under `artifacts/`. `~/.headlong` is Headlong's own state; never write output
there.

Ask Sentience with `ask-sentience`, one question per call. Ask it facts about
Toma. Decisions go in `--decision-requests`, never to Sentience.

`ready` needs `--question` (what you set out to answer, ending in ?) and
`--finding` (what you learned, plainly). Every decision needs a `headline` and
a `summary`. The operator reads those first.

Run `timeleft` when you need to know how much budget is left. All deadlines are
UTC; never do timezone arithmetic yourself.

Replace the contents of this file (`RUN-GUIDANCE.md`) to change what appears in
every generated `RUN.md`. Keep it short — it is repeated to the agent each run.
