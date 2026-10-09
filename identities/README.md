# identities/

Identity assets that ship with the repo. Right now that is
[starter-persona.md](starter-persona.md), the template `headlong-init`
uses to draft a new agent's core identity prompt from the install
interview.

Runtime identities (an agent's persona, trajectories, memories, and
activate script) are data, not code. They live in `.identities/`, which
is gitignored.

## Persona templates

| file | for |
|---|---|
| [starter-persona.md](starter-persona.md) | the default `headlong-init` draws from during the install interview — a general-purpose persistent companion |
| [archivist-persona.md](archivist-persona.md) | extraction and corpus-building jobs where provenance matters: the agent must hold apart what a source *attests*, what it can *verify itself*, and what merely sounds right |

Both use `{{placeholder}}` slots filled at init time.

`archivist-persona.md` was generalized from a real agent — `canon`, which mined
a personal-assistant API for its operator's recurring phrases, advice, and
reading list, then graded all 51 entries by how well each traced to a primary
source. Three did. Its worth was in what it refused to claim, and the stance
below is what made that refusal reliable.
