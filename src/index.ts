// Pi model picker: three panes for providers, models, and model details.
// Open it with /model-ui or Ctrl+Shift+M.
// Navigate with ↑/↓ and ←/→ (or Tab), apply with Enter, cancel with Esc.
// Ctrl+S saves the highlighted model as the global default, Ctrl+Shift+S as the project default.
// The inspector shows the configured per-model thinking level when settings define one.
// Models with a configured level print it after the name; the inspector places it on the model's scale.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { clampThinkingLevel, getSupportedThinkingLevels, type Api, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type PickerModel = Model<Api>;

type SaveScope = "global" | "project";

type PickerResult = { model: PickerModel; persist?: SaveScope };

type SavedDefaults = {
  global: string | undefined;
  project: string | undefined;
  thinkingLevels: Record<string, ModelThinkingLevel>;
};

const modelRef = (model: PickerModel): string => `${model.provider}/${model.id}`;

/** Marker column width: session model, global default, and project default, separated by spaces. */
const MARKER_WIDTH = 5;

/** Lines the picker draws around the table body: borders, title, status lines, header, and footer. */
const CHROME_ROWS = 12;

type PickerTheme = {
  fg(color: "accent" | "muted" | "dim" | "text" | "success" | "warning" | "border", text: string): string;
  bg(color: "selectedBg", text: string): string;
  bold(text: string): string;
};

const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
};

const formatRate = (rate: number): string => `$${rate.toLocaleString("en-US", { maximumFractionDigits: 3 })}/M`;

class ModelPicker {
  private providerIndex: number;
  private modelIndex = 0;
  private column: "provider" | "model" = "provider";
  private readonly requiredRows: number;

  constructor(
    private readonly byProvider: Map<string, PickerModel[]>,
    private readonly providers: string[],
    private readonly current: PickerModel | undefined,
    private readonly defaults: SavedDefaults,
    private readonly terminalRows: () => number,
    private readonly theme: PickerTheme,
    private readonly onSelect: (model: PickerModel) => void,
    private readonly onSave: (model: PickerModel, scope: SaveScope) => void,
    private readonly onCancel: () => void,
  ) {
    this.providerIndex = Math.max(0, providers.indexOf(current?.provider ?? ""));
    const currentIndex = this.models.findIndex((model) => model.id === current?.id);
    this.modelIndex = Math.max(0, currentIndex);
    this.requiredRows = this.measureRows();
  }

  /** Tallest content the table body must hold, so the box keeps one height while navigating. */
  private measureRows(): number {
    const modelCounts = this.providers.map((provider) => (this.byProvider.get(provider) ?? []).length);
    const inspectorCounts = [...this.byProvider.values()].flat().map((model) => this.details(model, 40).length);
    return Math.max(12, this.providers.length, ...modelCounts, ...inspectorCounts);
  }

  /** Table body height: the tallest content, clamped to the terminal so a resize still fits. */
  private get bodyRows(): number {
    return Math.min(this.requiredRows, Math.max(12, this.terminalRows() - CHROME_ROWS));
  }

  private get provider(): string {
    return this.providers[this.providerIndex] ?? "";
  }

  private get models(): PickerModel[] {
    return this.byProvider.get(this.provider) ?? [];
  }

  private get selected(): PickerModel | undefined {
    return this.models[this.modelIndex];
  }

  private markers(model: PickerModel): string {
    const ref = modelRef(model);
    return [
      this.current?.provider === model.provider && this.current.id === model.id ? "●" : "",
      this.defaults.global === ref ? "◆" : "",
      this.defaults.project === ref ? "▲" : "",
    ].filter(Boolean).join(" ").padEnd(MARKER_WIDTH);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.onCancel();
      return;
    }

    if (matchesKey(data, Key.left)) {
      this.column = "provider";
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.column = "model";
      return;
    }
    if (matchesKey(data, Key.tab)) {
      this.column = this.column === "provider" ? "model" : "provider";
      return;
    }
    if (matchesKey(data, Key.up)) {
      if (this.column === "provider") {
        this.providerIndex = (this.providerIndex - 1 + this.providers.length) % this.providers.length;
        this.modelIndex = 0;
      } else if (this.models.length > 0) {
        this.modelIndex = (this.modelIndex - 1 + this.models.length) % this.models.length;
      }
      return;
    }
    if (matchesKey(data, Key.down)) {
      if (this.column === "provider") {
        this.providerIndex = (this.providerIndex + 1) % this.providers.length;
        this.modelIndex = 0;
      } else if (this.models.length > 0) {
        this.modelIndex = (this.modelIndex + 1) % this.models.length;
      }
      return;
    }
    if (matchesKey(data, Key.ctrlShift("s"))) {
      if (this.selected) this.onSave(this.selected, "project");
      return;
    }
    if (matchesKey(data, Key.ctrl("s"))) {
      if (this.selected) this.onSave(this.selected, "global");
      return;
    }
    if (matchesKey(data, Key.enter) && this.selected) this.onSelect(this.selected);
  }

  private fit(text: string, width: number): string {
    const truncated = truncateToWidth(text, width);
    return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
  }

  private item(label: string, selected: boolean, markers: string, width: number, level?: ModelThinkingLevel): string {
    const prefix = selected ? "›" : " ";
    const rowColor = selected ? "accent" : markers.includes("●") ? "success" : markers.trim().length > 0 ? "warning" : undefined;
    const paint = (segment: string): string => {
      if (rowColor === undefined) return segment;
      const colored = this.theme.fg(rowColor, segment);
      return selected ? this.theme.bold(colored) : colored;
    };
    const tag = level === undefined ? " " : ` ${this.theme.bold(this.theme.fg(this.levelColor(level), `[${level}]`))} `;
    const line = `${paint(`${prefix} ${label}`)}${tag}${paint(markers)}`;
    return selected ? this.theme.bg("selectedBg", this.fit(line, width)) : this.fit(line, width);
  }

  private levelColor(level: ModelThinkingLevel): "dim" | "muted" | "accent" | "success" | "warning" {
    if (level === "low") return "muted";
    if (level === "medium") return "accent";
    if (level === "high") return "success";
    if (level === "xhigh" || level === "max") return "warning";
    return "dim";
  }

  /** Level the model will start at, or undefined when settings define no entry for it. */
  private levelTag(model: PickerModel): ModelThinkingLevel | undefined {
    const configured = this.defaults.thinkingLevels[modelRef(model)];
    return configured === undefined ? undefined : clampThinkingLevel(model, configured);
  }

  /** Slider for the configured level: one stop per supported level, filled up to the active one. */
  private thinkingSection(model: PickerModel, configured: ModelThinkingLevel, effective: ModelThinkingLevel, width: number): string[] {
    const levels = getSupportedThinkingLevels(model);
    const track = Math.max(8, width - 3);
    const position = this.stopPosition(levels.length, levels.indexOf(effective), track);
    const bar = [
      this.theme.fg("accent", "━".repeat(position)),
      this.theme.fg("success", this.theme.bold("●")),
      this.theme.fg("dim", "─".repeat(Math.max(0, track - position - 1))),
    ].join("");
    const header = [
      this.theme.fg("muted", "THINKING"),
      this.theme.fg(this.levelColor(effective), this.theme.bold(effective)),
      ...(configured === effective ? [] : [this.theme.fg("dim", `(configured ${configured})`)]),
    ].join("  ");
    return [
      this.fit(`  ${header}`, width),
      this.fit(`  ${bar}`, width),
      this.theme.fg("dim", this.fit(`  ${this.levelTicks(levels, track)}`, width)),
      "",
    ];
  }

  private stopPosition(count: number, index: number, track: number): number {
    if (count <= 1) return 0;
    return Math.round((Math.max(0, index) * (track - 1)) / (count - 1));
  }

  /** Level names centered under their stops, skipped when the space is already taken. */
  private levelTicks(levels: ModelThinkingLevel[], track: number): string {
    const cells = Array.from({ length: track }, () => " ");
    let lastEnd = -2;
    levels.forEach((level, index) => {
      if (level.length > track) return;
      const start = Math.max(0, Math.min(track - level.length, this.stopPosition(levels.length, index, track) - Math.floor(level.length / 2)));
      if (start <= lastEnd + 1) return;
      for (let offset = 0; offset < level.length; offset++) cells[start + offset] = level.charAt(offset);
      lastEnd = start + level.length - 1;
    });
    return cells.join("");
  }

  private detail(label: string, value: string, width: number): string {
    const key = this.theme.fg("muted", label.padEnd(15));
    return this.fit(`  ${key}${value}`, width);
  }

  private details(model: PickerModel | undefined, width: number): string[] {
    if (!model) return [this.theme.fg("dim", this.fit("  No available models", width))];

    const current = this.current?.provider === model.provider && this.current.id === model.id;
    const ref = modelRef(model);
    const configured = this.defaults.thinkingLevels[ref];
    const effective = this.levelTag(model);
    const rates = model.cost;
    const capability = [model.reasoning ? "Reasoning" : "Standard", model.input.includes("image") ? "Vision" : "Text only"].join("  ·  ");
    const lines = [
      this.theme.fg("accent", this.fit(`  ${model.name}`, width)),
      this.theme.fg("dim", this.fit(`  ${model.id}`, width)),
      "",
      this.theme.fg("muted", this.fit("  CAPACITY", width)),
      this.detail("Context", `${formatTokens(model.contextWindow)} tokens`, width),
      this.detail("Max output", `${formatTokens(model.maxTokens)} tokens`, width),
      "",
      this.theme.fg("muted", this.fit("  CAPABILITIES", width)),
      this.detail("Mode", capability, width),
      this.detail("Protocol", model.api, width),
      "",
      ...(configured === undefined || effective === undefined ? [] : this.thinkingSection(model, configured, effective, width)),
      this.theme.fg("muted", this.fit("  PRICING / 1M TOKENS", width)),
      this.detail("Input", formatRate(rates.input), width),
      this.detail("Output", formatRate(rates.output), width),
      this.detail("Cache read", formatRate(rates.cacheRead), width),
      this.detail("Cache write", formatRate(rates.cacheWrite), width),
    ];
    const badges: string[] = [];
    if (current) badges.push(this.theme.fg("success", this.fit("  ● CURRENT SESSION MODEL", width)));
    if (this.defaults.global === ref) badges.push(this.theme.fg("warning", this.fit("  ◆ GLOBAL DEFAULT", width)));
    if (this.defaults.project === ref) badges.push(this.theme.fg("warning", this.fit("  ▲ PROJECT DEFAULT", width)));
    if (badges.length > 0) lines.splice(2, 0, ...badges);
    if (rates.tiers?.length) lines.push(this.theme.fg("dim", this.fit(`  ${rates.tiers.length} long-context price tier(s)`, width)));
    return lines.map((line) => line === "" ? " ".repeat(width) : line);
  }

  render(width: number): string[] {
    const safeWidth = Math.max(40, width);
    const innerWidth = safeWidth - 2;
    const providerWidth = Math.max(16, Math.floor(innerWidth * 0.21));
    const modelWidth = Math.max(25, Math.floor(innerWidth * 0.35));
    const detailWidth = Math.max(16, innerWidth - providerWidth - modelWidth - 2);
    const divider = this.theme.fg("border", "│");
    const header = (label: string, column: "provider" | "model", columnWidth: number, count?: number) => {
      const focused = this.column === column;
      const title = `${label}${count === undefined ? "" : `  ${count}`}`;
      const content = focused ? this.theme.fg("accent", this.theme.bold(title)) : this.theme.fg("muted", title);
      return this.fit(`  ${content}`, columnWidth);
    };

    const providerLines = this.providers.map((provider, index) =>
      this.item(provider, this.column === "provider" && index === this.providerIndex, provider === this.current?.provider ? "●" : "", providerWidth),
    );
    const modelLines = this.models.map((model, index) =>
      this.item(model.name, this.column === "model" && index === this.modelIndex, this.markers(model), modelWidth, this.levelTag(model)),
    );
    const rows = this.bodyRows;
    const detailLines = this.details(this.selected, detailWidth).slice(0, rows);
    const selectedLabel = this.selected ? `${this.selected.provider} / ${this.selected.id}` : "No selection";

    const statusLine = (glyph: string, color: "success" | "warning", label: string, value: string) =>
      `│${this.fit(` ${this.theme.fg(color, glyph)} ${this.theme.fg("muted", `${label}:`)} ${value}`, innerWidth)}│`;
    const lines = [
      this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`),
      `│${this.fit(` ${this.theme.fg("accent", this.theme.bold("MODEL STUDIO"))}  ${this.theme.fg("dim", "Choose a provider, inspect a model, apply with Enter")}`, innerWidth)}│`,
      statusLine("●", "success", "Selected", selectedLabel),
      statusLine("◆", "warning", "Global default", this.defaults.global ?? "none"),
      statusLine("▲", "warning", "Project default", this.defaults.project ?? "none"),
      this.theme.fg("border", `├${"─".repeat(providerWidth)}┬${"─".repeat(modelWidth)}┬${"─".repeat(detailWidth)}┤`),
      `│${header("PROVIDERS", "provider", providerWidth, this.providers.length)}${divider}${header("MODELS", "model", modelWidth, this.models.length)}${divider}${this.fit(`  ${this.theme.fg("muted", "INSPECTOR")}`, detailWidth)}│`,
      this.theme.fg("border", `├${"─".repeat(providerWidth)}┼${"─".repeat(modelWidth)}┼${"─".repeat(detailWidth)}┤`),
    ];

    for (let row = 0; row < rows; row++) {
      lines.push(`│${providerLines[row] ?? " ".repeat(providerWidth)}${divider}${modelLines[row] ?? " ".repeat(modelWidth)}${divider}${detailLines[row] ?? " ".repeat(detailWidth)}│`);
    }

    lines.push(this.theme.fg("border", `├${"─".repeat(innerWidth)}┤`));
    lines.push(`│${this.fit(` ${this.theme.fg("accent", "↑↓")} move   ${this.theme.fg("accent", "←→ / Tab")} switch pane   ${this.theme.fg("success", "Enter")} apply   ${this.theme.fg("muted", "Esc")} cancel`, innerWidth)}│`);
    lines.push(`│${this.fit(` ${this.theme.fg("success", "Ctrl+S")} save global default   ${this.theme.fg("warning", "Ctrl+Shift+S")} save project default`, innerWidth)}│`);
    lines.push(this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));
    return lines.map((line) => truncateToWidth(line, width));
  }

  invalidate(): void {}
}

const settingsPath = (scope: SaveScope, cwd: string): string =>
  scope === "global" ? join(getAgentDir(), "settings.json") : join(cwd, CONFIG_DIR_NAME, "settings.json");

const readSettingsFile = async (path: string): Promise<Record<string, unknown>> =>
  existsSync(path) ? JSON.parse((await readFile(path, "utf-8")).replace(/^\uFEFF/, "")) : {};

const savedModelRef = (settings: Record<string, unknown>): string | undefined =>
  typeof settings.defaultProvider === "string" && typeof settings.defaultModel === "string"
    ? `${settings.defaultProvider}/${settings.defaultModel}`
    : undefined;

/** Write `defaultProvider` and `defaultModel` into the global or project settings file. */
export const saveDefaultModel = async (cwd: string, model: PickerModel, scope: SaveScope): Promise<string> => {
  const path = settingsPath(scope, cwd);
  const settings = await readSettingsFile(path);
  settings.defaultProvider = model.provider;
  settings.defaultModel = model.id;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
  return path;
};

const savedThinkingLevels = (settings: Record<string, unknown>): Record<string, ModelThinkingLevel> => {
  const levels = settings.modelThinkingLevels;
  return typeof levels === "object" && levels !== null ? (levels as Record<string, ModelThinkingLevel>) : {};
};

/** Read the configured global and project default models and per-model thinking levels for display. */
export const loadSavedDefaults = async (cwd: string, projectTrusted: boolean): Promise<SavedDefaults> => {
  const global = await readSettingsFile(settingsPath("global", cwd));
  const project = projectTrusted ? await readSettingsFile(settingsPath("project", cwd)) : {};
  return {
    global: savedModelRef(global),
    project: savedModelRef(project),
    thinkingLevels: { ...savedThinkingLevels(global), ...savedThinkingLevels(project) },
  };
};

export default function (pi: ExtensionAPI) {
  const openPicker = async (ctx: ExtensionContext) => {
    const models = ctx.modelRegistry.getAvailable()
      .slice()
      .sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
    const byProvider = new Map<string, PickerModel[]>();
    for (const model of models) {
      const group = byProvider.get(model.provider) ?? [];
      group.push(model);
      byProvider.set(model.provider, group);
    }
    const providers = [...byProvider.keys()];
    if (providers.length === 0) {
      ctx.ui.notify("No authenticated models are available.", "warning");
      return;
    }

    const defaults = await loadSavedDefaults(ctx.cwd, ctx.isProjectTrusted());
    const result = await ctx.ui.custom<PickerResult | null>((tui, theme, _keybindings, done) => {
      const picker = new ModelPicker(
        byProvider,
        providers,
        ctx.model,
        defaults,
        () => tui.terminal.rows,
        theme as PickerTheme,
        (model) => done({ model }),
        (model, scope) => done({ model, persist: scope }),
        () => done(null),
      );
      return {
        render: (width) => picker.render(width),
        invalidate: () => picker.invalidate(),
        handleInput: (data) => {
          picker.handleInput(data);
          tui.requestRender();
        },
      };
    });

    if (!result) return;
    const { model, persist } = result;
    if (!(await pi.setModel(model))) {
      ctx.ui.notify(`Could not select ${model.provider}/${model.id}: authentication is unavailable.`, "warning");
      return;
    }
    if (!persist) {
      ctx.ui.notify(`Model set to ${model.provider}/${model.id}`, "info");
      return;
    }
    if (persist === "project" && !ctx.isProjectTrusted()) {
      ctx.ui.notify("Model set, but this project is not trusted, so no project default was saved.", "warning");
      return;
    }
    await saveDefaultModel(ctx.cwd, model, persist);
    ctx.ui.notify(persist === "global" ? `Default model: ${modelRef(model)}` : `Project default model: ${modelRef(model)}`, "info");
  };

  pi.registerCommand("model-ui", {
    description: "Select a model with provider, model, and metadata panes",
    handler: async (_args, ctx) => openPicker(ctx),
  });

  pi.registerShortcut("ctrl+shift+m", {
    description: "Open the model picker UI",
    handler: async (ctx) => openPicker(ctx),
  });
}
