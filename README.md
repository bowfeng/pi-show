# pi-show

Show pi-coding-agent instance information — commands, skills, prompts, tools, themes, and model.

## Installation

```bash
pi install npm:pi-show
```

Then run `/reload` to activate the extension.

## Usage

| Command | Description |
|---------|-------------|
| `/show` | Overview of all resources |
| `/show <name>` | Detailed info about a specific resource |

### Examples

```
/show                          # Show overview
/show read                     # Show details for the read tool
/show ls                       # Show details for the ls tool
/show git                      # Partial match search
```

## What it shows

- **Model** — current model id and provider
- **Commands** — all slash commands registered from extensions
- **Skills** — skills loaded in the current session
- **Prompt Templates** — prompt templates available
- **Tools** — all tools (built-in and custom)
- **Themes** — all available themes and their paths

## Colors

Uses the active theme for formatting:
- `accent` — command/tool names (bold)
- `mdCode` — paths, counts, labels
- `muted` — source types, brackets, bullets
- `success` — provider names
- `error` — not-found queries
