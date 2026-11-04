# OpenAI accounts

Adds a separate ChatGPT OAuth account as `openai:work`, without changing the built-in `openai` login.
Requires Pi 1.3.0 or newer. Uses the host's current OpenAI chat catalog, OAuth login/refresh, and Responses
implementation; no tokens or model lists are copied into this extension.

## Sign in and switch

1. Install the extension collection using `pi/install.sh` if not already installed, then run `/reload`.
2. Run `/login` and choose **OpenAI (work)**. Complete **Sign in with ChatGPT** using the second account.
3. Run `/model` and select a model under **openai:work**. Choose a model under **openai** to switch back.
4. Use `/account` (or `/account switch`) to switch accounts: with exactly two available OpenAI accounts,
   it switches directly to the other one; with more, it opens a picker. Only logged-in/configured accounts
   are counted. The current model is preserved; if the target does not offer it, use `/model` instead.
   From a non-OpenAI provider, it opens the picker rather than choosing an arbitrary account.
5. `/logout` lists the two providers separately; logging out of one does not remove the other.

Pi stores the separate credential under `openai:work` in its agent-directory `auth.json` (normally
`~/.pi/agent/auth.json`) and refreshes it independently. No manual auth-file editing is necessary.
The extension is OAuth-only: `OPENAI_API_KEY` does not make a labeled account available or act as a fallback.
Only chat models are exposed, since the built-in classifier API does not accept ChatGPT OAuth.

The label is not an OpenAI account selector or a guarantee of which account was authorized. The browser
may already be signed in to your first account. Switch accounts in the browser before authorizing, or
open the displayed authorization URL in the appropriate browser profile/private window. Complete one
login at a time; OpenAI's callback port is shared with other Pi sessions and the Codex CLI.

## Custom labels

Optionally create `~/.pi/agent/openai-accounts.json` (or in `PI_AGENT_DIR` when set):

```json
{
  "labels": ["work", "personal", "client-a"]
}
```

Run `/reload` after changing it. Each label registers `openai:<label>` and has its own `/login` entry.
Labels accept letters, digits, `_`, and `-`, starting with a letter or digit. Duplicates are ignored.
A missing file defaults to `["work"]`; `{"labels": []}` disables all aliases. Invalid configuration
fails extension loading rather than silently choosing another account. Renaming/removing a label does
not migrate/delete its stored credential; log out before removing it if you want the credential deleted.

## Implementation

This follows the custom OAuth provider approach suggested in
[Pi issue #1391](https://github.com/earendil-works/pi/issues/1391).
Pi owns credential storage, refresh locking, cancellation, and login/logout. The extension delegates
streaming to OpenAI with its original provider identity because Pi uses that identity to enable
subscription-specific request rules. Its own assistant history is normalized for that delegate, and
streamed messages are relabeled back to the account alias for session persistence and model selection.
Request hooks still receive the upstream `openai` model. Native deferred-response and non-chat operations
are not exposed by this wrapper.
