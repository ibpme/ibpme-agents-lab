# Registry

Machine-local discovery and live snapshots for Pi and Claude agents. The
registry runs inside the [agent-hub service](../service/README.md):

```bash
agent-hub start --background                 # with the spawn supervisor
agent-hub start --background --registry-only # registry alone
```

See the **[registry guide](../docs/registry.md)** for configuration,
architecture, Claude/Pi publishers, schemas, and verification, or the
[documentation index](../docs/README.md) for related components.
