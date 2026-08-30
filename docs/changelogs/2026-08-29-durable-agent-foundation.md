# Durable agent foundation

**2026-08-29** · PR [#1](https://github.com/implicit-labs/headlong/pull/1)

Four days of running eight agents unattended, on jobs from a website rebuild to
a voice-imitation study to a quantified-self analysis. The recurring failures
were not agent mistakes. They were the harness executing text that was never a
command, watchdogs that did not reliably stop anything, and every workspace
rediscovering the same operational lessons from scratch.

---

## The harness was executing model prose as shell

`extract_code()` understood exactly one delimiter — a markdown fence — and fell
back to running the **raw response** when it found none. Models emit several
delimiters. Measured across eight agents' trajectories, 646 steps had a
delimiter leak into the command and **538 of them failed:**

| leaked form | seen | failed |
|---|---|---|
| `<bash>…</bash>` tags | 149 | **149 (100%)** |
| `[field]` telemetry markers | 326 | 285 |
| stray markdown fence | 164 | 103 |

The failures read as `do: command not found`, `[in_tok]: command not found`, and
``syntax error near unexpected token `newline'`` — each one a wasted wake-up. On
the worst agent this was **19.5% of every shell step**.

The first three fixes were strips: cut the telemetry tail, cut the stray fence,
cut the `</bash>` residue. Patching the same root cause a fourth time is the
signal that the root cause is elsewhere. It was: the parser knew one delimiter
and the world had four.

So alternative delimiters are now **normalized into fences before parsing**, and
the existing heredoc-aware fence machinery handles them. That is strictly better
than stripping residue — with a `<bash>` tag, prose *before* the tag is now
correctly excluded too, which no amount of stripping achieved. The comment in
the code says to add new forms there rather than as another post-hoc strip.

Beneath that, the unfenced fallback is now gated by `_looks_like_shell()`, which
rejects prose outright. One subtlety worth keeping: shell *continuation*
keywords (`do`, `then`, `else`, `fi`, `done`, `esac`, `in`) had to be excluded
explicitly, because `command -v do` succeeds — `do` is a reserved word — which is
exactly why a sentence beginning "do this now" used to execute.

When nothing is runnable, the step emits a no-op whose stderr reaches the model
next turn, so it learns to fence instead of silently losing the step.

**26 regression tests**, every case built from a real failing string pulled out
of a trajectory.

## Deprecated model defaults

No configured identity was on Sonnet 4 — an audit of eight identities and ~24k
logged calls found only opus-5, sonnet-5 and haiku-4-5. But five *latent*
fallbacks still named `claude-sonnet-4-5-20250929`, firing whenever
`SHELLM_MODEL` is unset, including `headlong-init`'s default for **every new
agent**. All now `claude-sonnet-5`.

The `claude-sonnet-4-*` rows in `get_model_max_tokens()` are deliberately kept:
they are needed by anyone pinning an old model explicitly, and removing them
would silently drop such a model to the 4096-token fallback.

## A workspace template, because only one of eight had one

`workspace-template/` plus `headlong-workspace-init <identity>`. Guardrail
binaries are **symlinked** back into the repo, so fixing a bug once fixes it for
every agent.

Each hardened piece exists because of a specific incident:

- **`sleep` does not survive the machine suspending.** A run continued **34
  minutes** past its deadline, still calling the LLM, because a single
  `sleep 28800` had not returned. The watchdog now polls an absolute deadline.
- **`thinkers stop` is not enough.** It deactivates thinkers and leaves the
  dispatcher waking and spending — once for **50 minutes**. The watchdog now
  kills the dispatcher by pid.
- **`persona stop` kills the wrong thing.** `~/.headlong/run/web.pid` is global,
  so it takes down whichever agent's dashboard is up.
- **`persona <unknown> stop` is not a no-op.** For an unrecognised identity,
  persona falls back to the *default* identity and treats "stop" as a **chat
  message**. A watchdog fallback was messaging another agent instead of stopping
  this one. `persona <bogus> status` hangs, so the existence check is a
  filesystem test.
- **Deadlines are a UTC epoch.** Trajectories are stamped UTC, so a local-time
  deadline anywhere makes an agent conclude the run is over. That cost most of
  one run, and later made another stop **two hours early**, reasoning carefully
  from bad data. An epoch has no format to misparse and no zone to get wrong;
  `timeleft` reads it.

`headlong-workspace-init` is idempotent and additive — it patches an identity's
`.env` one key at a time, since appending a second `PROJECT_DIR` would silently
override the existing one. `CHANGELOG.md` and `goals/README.md` are marked
precious and are never overwritten, **not even with `--force`**: a `--force` run
clobbered a 1291-line changelog, and only an APFS snapshot recovered it.

## Goal-writing, and the deliverable that fails

Two lessons that live in how a brief is written rather than in code.

**Schema compliance is not doneness.** An agent produced entries that filled
every required field of a specification and were hollow. A stricter schema would
not have caught it. What was missing was a plain-language statement of what a
good unit *is* — *"a quote is a sentence that makes a point"* — said out loud.
Every goal now opens with `THE DELIVERABLE`, which declares itself the main
goal, states that schema compliance is not doneness, and gives each field a test
whose failure is **observable**: not "is this insightful" but *"if sentence 3
could be written about any article, it fails."*

**Metrics drift when feedback offers no gradient.** One agent redefined "win"
three times across three runs — self-vs-self comparisons, then "close
paraphrase" stretched past breaking, then the definition of winning itself —
each time when honest feedback was uniformly negative. This is not dishonesty;
a metric that moves feels like progress. Goals now carry the counter-instruction
directly: *if your success rate jumps, ask what changed about the test.*

## Consolidated operating docs

`docs/operating-agents.md` gathers what was previously spread across chat
transcripts: UTC deadlines, watchdogs, reaching a running agent through the
trajectory rather than a file (the wake prompt does not re-read files), choosing
a model per job, why a CLI beats GUI automation, how to validate an LLM judge
before trusting it, multiplicity control for correlational work, and the shared
resources when several agents run at once.

Two findings there are worth naming:

- **A control must ask the same question as the thing it calibrates.** A judge
  study concluded a model "does not track author identity at all" — because it
  asked which text *"feels more like a real individual"* rather than *"which one
  is his."* Re-run with the right question, the judge was correct every time.
  The wrong control nearly invalidated five real findings.
- **Processes launched with the environment inherited into `argv` expose API
  keys in the process table.** Two Jekyll previews put `ANTHROPIC_API_KEY=sk-ant-…`
  in plaintext where anything running as the same user could read it.

## Not proven yet

Only two agents have run since these fixes. `linglong` — the worst at 19.5%,
whose failures all predate every fix — has not run at all. Its next run is the
real test.

Confirmed so far: `canon` ran 103 steps post-fix with `<bash>` failures going
**12 → 0**, and `swing` ran 48 steps on the rebased harness with zero failures.
