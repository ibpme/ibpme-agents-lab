# OpenAI fast tier

- `/fast` toggles the fast service-tier request.
- `/fast on` and `/fast off` explicitly enable/disable it.
- Off by default in new sessions; saved as session metadata for resume/reload.

With an OpenAI Responses model selected, enabling this adds `service_tier: "priority"` to matching
outgoing requests. Supports `openai`, labeled accounts such as `openai:work`, and the legacy
`openai-codex` provider. It does not change the model or thinking level. Disabling it removes this
extension's override, leaving any provider/other extension default alone.

The command/badge say “fast”, but the wire value is `priority`, matching
[Codex's Fast mapping](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/config_types.rs).
Some endpoints accept `fast` as an alias; subscription endpoints can reject it with
`Unsupported service_tier: fast`, so this extension uses `priority` consistently.

The footer shows **⚡ fast** after the thinking level (or after the model for non-reasoning models).
The badge indicates a **requested** tier, not confirmation that OpenAI honored it. With the custom
status-line disabled, it remains a normal extension status in Pi's default footer.

OpenAI controls model/account/endpoint eligibility, latency, pricing, and subscription quota usage.
Fast service may cost more or consume quota faster. Unsupported requests may be rejected; this
extension does not silently retry at another tier. If that happens, use `/fast off` and retry.

Switching to another provider hides the badge and leaves its requests unchanged. Switching back to
OpenAI restores the badge if enabled; `/account` also retains the preference across OpenAI accounts.
You must select an OpenAI Responses model to enable fast, but can disable it from any model.
The setting is session-wide: tree navigation does not rewind it, while a new session starts off.

Pi's request hook does not expose the actual request model. The extension guards on the active
provider/API and matching payload model ID, leaving requests for other models untouched. A nested
call using the same model ID is indistinguishable in that hook and also receives the override while
an eligible OpenAI model is active. The extension changes no credentials, endpoints, or headers.
