# Message listener

Local, same-user messaging into interactive Pi sessions. Included in the
[Pi package](../../../docs/setup.md#install-the-pi-extensions); only TUI sessions
open a listener.

```text
/listen             toggle
/listen on          enable
/listen off         disable
/listen status      show the socket path
```

Messages can trigger model turns and tools with Pi's permissions. Do not expose
the socket to untrusted clients. Registry publication requires the separate
registry publisher and an explicitly started registry.

See the **[listener guide](../../../docs/message-listener.md)** for the v2
protocol, ACKs, retries, security, and registry/MCP integration.
