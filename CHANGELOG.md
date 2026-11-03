# Changelog

## [0.1.1] - 2026-11-03

- Publish automatically on every push to `main` when the version is new, using npm trusted publishing with provenance.
- Document the release flow in the README.

## [0.1.0] - 2026-11-03

- Three-pane model picker: providers, models, and a model inspector.
- `/model-ui` command and `Ctrl+Shift+M` shortcut.
- Inspector shows context window, max output, capabilities, protocol, and per-1M-token pricing.
- Save the highlighted model as the global or project default with `Ctrl+S` and `Ctrl+Shift+S`.
- Show configured per-model thinking levels after the model name, color-coded by depth.
- Draw the configured thinking level as a slider over the model's supported levels, with clamped values reported.
- Read project settings only for trusted projects.
