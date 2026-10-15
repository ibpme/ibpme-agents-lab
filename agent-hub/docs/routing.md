# Spawn model routing

Routing is an **opt-in supervisor policy**. When enabled, TypeSafe's Jev System
One classifies each delegated prompt and selects a configured execution profile.
A profile fixes the harness, provider, model, thinking effort, and optional
system-prompt addition. Only Pi execution is supported.

With routing disabled or no routing file, existing spawn behavior is unchanged,
including the optional caller-provided `model` selector.

## Configure

Start with [`spawner/examples/routing.json`](../spawner/examples/routing.json).
It contains these requested profiles:

| Profile | Harness | Provider | Model | Effort |
| --- | --- | --- | --- | --- |
| `general` (default) | `pi` | `opencode-go` | `claude-haiku-5-5` | `medium` |
| `quick` | `pi` | `openai` | `gpt-6-luna` | `medium` |
| `deep` | `pi` | `openai` | `gpt-6-astra` | `medium` |

The installed Pi registry resolves all three requested models as chat models
supporting medium effort. `openai/gpt-6-luna` is also available as a classifier;
that does not prevent using its chat entry for execution. The resolver explicitly
requires a physical chat entry and rejects classifier-only entries. Catalogs may
differ between installations: use `--validate-only` to check local resolution and
credentials. Catalog presence does not guarantee remote provider access.

To enforce one fixed execution profile, keep only that profile in `profiles`
and name it as `default_profile`. When enabled routing has exactly one profile,
the supervisor skips System One entirely, validates the profile, and launches it
directly. No TypeSafe key is needed and no task or hint is sent to TypeSafe.
Routing metadata reports `source: "default"`, not a fallback. Provider credentials
and model/effort validation are still required, and caller overrides remain
forbidden. A supplied `routing_hint` cannot change the sole profile.

The JSON shape is:

```json
{
  "routing": {
    "enabled": true,
    "classifier": { "model": "jev-latest", "timeout_ms": 3000 },
    "default_profile": "general",
    "profiles": [
      {
        "id": "general",
        "harness": "pi",
        "provider": "opencode-go",
        "model": "claude-haiku-5-5",
        "effort": "medium",
        "description": "Typical implementation, focused debugging, tests, and documentation",
        "append_system_prompt": "Check relevant constraints and validate your changes."
      }
    ]
  }
}
```

- Profile IDs must be unique lowercase identifiers; the default must exist.
- There must be 1–32 profiles. Unknown fields and unsupported harnesses are errors.
- Effort is Pi's thinking level: `off`, `minimal`, `low`, `medium`, `high`,
  `xhigh`, or `max`. The selected model must support the exact level; no silent
  clamping is allowed.
- `description` tells System One **when to select** the profile. It is required.
- `append_system_prompt` optionally tells the child **how to work**. It is not
  sent to the classifier and is limited to 65,536 JavaScript string code units.
- `classifier` defaults to `jev-latest` with a 3,000 ms timeout. The timeout must
  be an integer from 1–10,000 ms. SDK retries are disabled and a wall-clock
  deadline also cancels the classifier request.

The official `@typesafe-ai/sdk` reads `TYPESAFE_API_KEY` from the supervisor's
process environment. Its `TYPESAFE_BASE_URL` override is also respected. Do not
put API keys in routing JSON. Profiles use Pi's normal provider authentication,
independent of TypeSafe authentication.

The preflight resolver uses the bundled Pi SDK's local catalog, `models.json`,
and configured provider authentication. It does not start a session, load
provider extensions, or make inference requests to execution providers. Models
registered only by an extension must also be resolvable in the preflight catalog.
It does not prove that a remote provider will accept a request. Keep the
supervisor's Pi SDK and execution binary compatible and ensure the child has
access to the same model configuration and credentials (including the tmux
server environment for environment-based credentials).

## Enable at supervisor startup

Build from `agent-hub/`:

```bash
npm ci
npm run build
```

Export `TYPESAFE_API_KEY` in the environment used to start the supervisor, then
choose one entry point:

```bash
# Standalone supervisor
node spawner/dist/cli.js --routing-config /absolute/path/to/routing.json

# Unified service
node service/dist/cli.js start --routing-config /absolute/path/to/routing.json
```

For the unified service, `<control-directory>/config.json` can instead contain:

```json
{ "routingConfigPath": "/absolute/path/to/routing.json" }
```

Relative paths in that service config resolve against the control directory.
CLI paths resolve against the invoking working directory. Background service
launches preserve the resolved routing configuration path.

Programmatic supervisors accept `routingConfigPath`, or a parsed `routingConfig`
object (not both). Configuration is validated and snapshotted at startup; file
edits require a supervisor restart. Existing tasks keep their resolved profile
and prompt addition. No user-global agent configuration is modified.

Reconnect MCP sessions after changing supervisor policy. The stdio CLI and HTTP
MCP transport query supervisor capabilities before publishing tool schemas. They
omit the `model` spawn argument when routing is enabled. Library integrations
should use `createConfiguredAgentsServer(options)` for the same discovery;
`createAgentsServer(options)` remains the synchronous constructor and accepts
`routingEnabled: true` to select that schema explicitly. If discovery cannot
reach a supervisor, messaging/discovery tools remain usable and the legacy
schema is advertised. The supervisor still enforces policy on every spawn,
including direct clients and sessions with stale schemas.

## Test a configuration and prompt

These commands do **not** spawn Pi agents or modify project files. Run from
`agent-hub/` after building:

```bash
# Check configuration, local model resolution, effort support, and provider auth.
# Does not call System One; checks every configured profile.
node spawner/dist/route-test.js \
  --config /absolute/path/to/routing.json --validate-only

# Classify a prompt with the actual SDK and resolve the execution profile.
node spawner/dist/route-test.js \
  --config /absolute/path/to/routing.json \
  --prompt 'Diagnose a cross-module race condition and add regression tests'

# Read a prompt from stdin instead of exposing it in process arguments.
printf '%s' 'Update a documentation link' | \
  node spawner/dist/route-test.js --config /absolute/path/to/routing.json --stdin

# Fail the command if routing had to fall back instead of using the classifier.
node spawner/dist/route-test.js \
  --config /absolute/path/to/routing.json --prompt 'Review this design' \
  --require-classifier
```

A single quoted positional prompt is also accepted. With no prompt argument,
the command resolves the default profile without calling System One. A single
configured profile also bypasses System One, even when a prompt is provided. The npm
convenience command builds first:

```bash
npm run route:test --workspace @agent-hub/spawner -- \
  --config /absolute/path/to/routing.json --prompt 'Implement a focused fix'
```

Use optional `--routing-hint TEXT` to test supplementary routing context:

```bash
node spawner/dist/route-test.js \
  --config /absolute/path/to/routing.json \
  --prompt 'Investigate the cache invalidation failure' \
  --routing-hint 'The user prioritizes root-cause analysis across services'
```

Hints are optional; no hint is synthesized when omitted. `--routing-hint` cannot be
combined with `--validate-only`. Without an initial prompt, the default profile
is used without classification even if a hint is supplied.

With multiple profiles, prompt tests send the delegated text and any supplied
hint to TypeSafe. Single-profile routing does not call TypeSafe. `--validate-only` does not.
Output is JSON with routing source, profile, duration, resolved execution
settings, and fallback details. It does not echo prompts, hints, appended instructions,
or credentials. `has_append_system_prompt` indicates whether the selected
profile adds instructions.

Exit codes:

- **0:** successful resolution (including an explicitly reported fallback),
  disabled routing, or all profiles passed `--validate-only`.
- **1:** invalid arguments/configuration, failed profile validation in
  `--validate-only`, or an unavailable default execution profile.
- **2:** `--require-classifier` was supplied but the result was not a successful
  classifier-selected execution profile (including single-profile bypass).

`--validate-only` can fail because a non-default profile is unavailable even
though actual prompt routing can successfully fall back to the default.

## Execution and fallback policy

The supervisor classifies the delegated `prompt`, not the parent's conversation.
The optional `spawn_agent.routing_hint` (or dry-run `--routing-hint`) supplies relevant
user preferences or a concise assessment from the delegating agent. It is
advisory, not a direct model/profile override. Hints must be non-blank, contain no
NUL, and be at most 4 KiB UTF-8. The MCP schema only exposes `routing_hint`
when routing is enabled; otherwise it exposes the optional `model` argument.
Direct supervisor and dry-run hints are ignored when routing is disabled. Hints are stored
with the original input in the private task record, but are not added to the
child prompt or system instructions and are not exposed in task summaries.

System One receives `state: { delegated_task: prompt }`, with an additional
`routing_hint` field only when a hint is supplied. Each choice contains the profile description,
provider, model, and effort, with the default profile marked. It chooses only a
profile ID. It cannot generate CLI arguments or profile instructions. The
classification question focuses on scope, reasoning depth, ambiguity, and
cross-component dependencies rather than prompt length or emphatic wording. It
considers a supplied hint for explicit profile/provider/model/effort preferences
and the delegating agent's assessment. It prefers matching explicit user requests
when a configured profile satisfies them, and uses the default when no more
specific profile clearly fits. Profile system-prompt additions are not sent to
the classifier. Routing
classification is not a security boundary: phrase profile descriptions clearly
and allow only execution configurations you are willing to run.

When routing is enabled, caller execution overrides are rejected: this includes
`model`, provider, effort, profile, and prompt additions. Task-level `prompt`,
`cwd`, `name`, and the existing parent-context setting remain separate.

| Condition | Behavior |
| --- | --- |
| Valid classifier selection and executable profile | Launch selected profile |
| Exactly one configured profile | Validate and launch default; no classification, regardless of prompt or hint |
| No initial prompt | Validate and launch default; no classification |
| Missing TypeSafe key | Default fallback: `classifier_unconfigured` |
| Classifier timeout | Default fallback: `classifier_timeout` |
| Unknown/malformed selection | Default fallback: `classifier_invalid_selection` |
| API/SDK failure | Default fallback: `classifier_error` |
| Selected profile cannot resolve, lacks configured auth, or has incompatible effort | Default fallback: `selected_profile_unavailable` |
| Default profile unavailable | Fail task before launch, with a clear error |
| Cancellation or shutdown during routing | Cancel routing; do not launch a child |
| Failure after launch | Normal task failure; no duplicate execution or retry |

Each profile preflight has a 3-second budget. Classification is separate from the
child startup-handshake deadline. Spawner socket deadlines are 45 seconds to
cover the maximum classifier budget, two preflights, and normal startup.

The chosen profile's provider, exact model ID, and effort become Pi's
`--provider`, `--model`, and `--thinking` arguments. The profile's optional system
instructions are appended to the original session's system prompt on each run,
composing with optional parent context without modifying the user prompt or
triggering an extra turn. Reloads do not duplicate instructions; session switches
do not inherit them. Automatic final-answer delivery is unchanged.

The task record persists the resolved profile and full execution snapshot,
including prompt additions. Task summaries/MCP results expose routing metadata
and provider/model/effort, but not appended instructions. If the selected profile
is unavailable, `classified_profile` and `unavailable_reason` explain the
fallback. Raw API exception text is not persisted, and SDK logging is disabled
to avoid leaking prompts or keys.
