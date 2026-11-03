# Pi Model Picker

A three-pane model picker for the [Pi coding agent](https://pi.dev). Pick a provider on the left, a model in the middle, and inspect the highlighted model on the right. Models whose default thinking level is configured show it next to the name, and the inspector draws that level on the model's scale.

```
╭────────────────────────────────────────────────────────────────────────────────────╮
│ MODEL STUDIO  Choose a provider, inspect a model, apply with Enter                 │
│ ● Selected: iwhalex / i-gpt-5.6-terra                                              │
├──────────────────┬──────────────────────────────┬──────────────────────────────────┤
│  PROVIDERS  5    │  MODELS  7                   │  INSPECTOR                       │
├──────────────────┼──────────────────────────────┼──────────────────────────────────┤
│  iwhale          │  DeepSeek Flash [max] ◆      │  GPT-5.6-Terra                   │
│› iwhalex ●       │  GPT-5.6-Sol                 │  i-gpt-5.6-terra                 │
│  minimax-cn      │  GPT-5.6-Terra [medium] ●    │  ● CURRENT SESSION MODEL         │
│  owner           │  GPT-6-Astra                 │                                  │
│  ownerx          │  GPT-6-Luna [medium]         │  CAPACITY                        │
│                  │  GPT-6-Sol                   │  Context        1.1M tokens      │
│                  │  GPT-6.1-Sol                 │  Max output     128K tokens      │
│                  │                              │                                  │
│                  │                              │  CAPABILITIES                    │
│                  │                              │  Mode           Reasoning · Vision│
│                  │                              │  Protocol       openai-responses │
│                  │                              │                                  │
│                  │                              │  THINKING  medium                │
│                  │                              │  ━━━━━━━━━━━━━●──────────────────│
│                  │                              │  low   medium  high  xhigh   max │
│                  │                              │                                  │
│                  │                              │  PRICING / 1M TOKENS             │
│                  │                              │  Input          $3/M             │
├──────────────────┴──────────────────────────────┴──────────────────────────────────┤
│ ↑↓ move   ←→ / Tab switch pane   Enter apply   Esc cancel                          │
╰────────────────────────────────────────────────────────────────────────────────────╯
```

## Install

```bash
pi install npm:@butcool/pi-model-picker
```

Try it without touching your settings:

```bash
pi -e npm:@butcool/pi-model-picker
```

Install into a project instead of your personal configuration:

```bash
pi install npm:@butcool/pi-model-picker -l
```

## Usage

Open the picker with `/model-ui` or `Ctrl+Shift+M`.

| Key | Action |
|---|---|
| `↑` `↓` | Move within the focused pane |
| `←` `→` or `Tab` | Switch between the provider and model panes |
| `Enter` | Apply the highlighted model to the current session |
| `Esc` or `Ctrl+C` | Close the picker |
| `Ctrl+S` | Save the highlighted model as the global default |
| `Ctrl+Shift+S` | Save the highlighted model as the project default |

Applying a model runs the same path as `/model`, so the configured per-model thinking level takes effect immediately.

Markers in the model list:

| Marker | Meaning |
|---|---|
| `●` | Model used by the current session |
| `◆` | Global default model |
| `▲` | Project default model |

## Per-model thinking levels

Pi supports `modelThinkingLevels` in `settings.json`:

```json
{
  "modelThinkingLevels": {
    "anthropic/claude-sonnet-4-6": "high",
    "openai/gpt-5.6-terra": "medium"
  }
}
```

The picker reads the global settings file plus the project settings file of a trusted project, with project entries overriding global ones.

- A model with an entry shows the level after its name, for example `GPT-5.6-Terra [medium]`. Levels are color-coded and bold: dim for `off`/`minimal`, gray for `low`, teal for `medium`, green for `high`, orange for `xhigh`/`max`.
- The inspector renders the level as a slider over the levels the model actually supports, with the active stop marked and labeled.
- Models without an entry show no level and no thinking section.
- When a configured level is outside the model's supported range, the picker shows the level the session will actually use and notes the configured value, for example `THINKING high (configured medium)`.

The model list rows and the level tags are colored by state: the current session model row is green, rows carrying a default marker are orange, and the level tag keeps its own color inside them.

## Requirements

- Pi 1.5.0 or newer
- Node.js 22 or newer

## Development

```bash
npm install
npm run typecheck      # TypeScript strict check
npm test               # drives the real TUI through a pty (requires uv)
```

`npm test` starts Pi inside a temporary agent directory, declares this package as a local package, opens `/model-ui`, and asserts what the renderer writes for configured, missing, and clamped thinking levels. It needs `pi` on `PATH` and a Unix pty (macOS or Linux).

## Releasing

Publishing runs on every push to `main`. The workflow publishes with npm trusted publishing (OIDC) and provenance, so no npm token is stored in the repository.

A release only happens when `package.json` carries a version that is not on the registry yet. Bump the version and update the changelog in one commit:

```bash
npm version patch --no-git-tag-version
git commit -am "release: v0.1.1"
git push
```

`npm version` rewrites `package.json` and the lockfile. Pushes with an already published version skip the publish step and finish green.

## License

MIT
