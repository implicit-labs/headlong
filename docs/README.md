# docs/

Reference documentation.

- [install.md](install.md) covers every install variant, including
  non-interactive/CI installs and the long-lived Docker container.
- [shellm.md](shellm.md) is the shellm engine reference: the loop,
  context passing, Docker sandboxing, envs, the `llm` tool, and options.
- [RELEASING.md](RELEASING.md) is the playbook for tagging a release on
  GitHub before an announcement: checklist, commands, pinned install line.
- [operating-agents.md](operating-agents.md) is what running eight agents
  taught us: writing a goal that survives contact, UTC deadlines, watchdogs
  that actually stop things, validating an LLM judge, and the failure modes
  that cost the most.
- [changelogs/](changelogs/) records why individual changes were made, at a
  granularity release notes do not reach.

The design story and the case for the microharness are in
[philosophy.md](../philosophy.md), and design documents live in
[design/](../design/).
