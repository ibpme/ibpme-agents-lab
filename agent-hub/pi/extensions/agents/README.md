# `/agents`: live registry browser

Browse live Pi and Claude agents, preview transcripts, and act on eligible tmux
panes. The browser reads registry snapshots; it never starts the registry.

Install the [Pi package](../../../docs/setup.md#install-the-pi-extensions), reload
existing sessions, and start the [registry](../../../docs/registry.md) separately.
Run `/agents` in Pi.

- Up/Down or `j`/`k`: navigate; Right/Left: open/close transcript.
- Enter: attach or show details; `i`: metadata.
- `V` / `H`: move a pane into a split; Ctrl+X: confirm killing a pane.
- `r`: refresh; Escape or `q`: back/close.

See the **[browser guide](../../../docs/agents-pi.md)** for all controls, listener
indicators, transcript behavior, freshness checks, and pane-action safeguards.

This directory is a thin launcher and native-overlay adapter. The shared browser
implementation and tests live in [`agent-hub/agents-browser`](../../../agents-browser/README.md).
