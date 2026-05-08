/**
 * /settings command — interactive configuration menu
 *
 * TUI overlay-based graphical configuration interface:
 * - View and change the default model
 * - Configure API keys, models, and base URLs for existing providers
 * - Add new providers from a curated list
 * - All changes sync to ~/.zapmyco/settings.json in real-time
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { getModels } from '@mariozechner/pi-ai';
import {
  type Component,
  Input,
  type OverlayHandle,
  type OverlayOptions,
  type SelectItem,
  SelectList,
  type SelectListTheme,
  type TUI,
} from '@mariozechner/pi-tui';
import chalk from 'chalk';
import type { CommandDefinition, ReplSession } from '@/cli/repl/types';
import { HOME_CONFIG_PATH } from '@/config/loader';

// ============ Constants ============

/** Overlay layout options for menus */
const OVERLAY_OPTIONS: OverlayOptions = {
  width: '100%',
  anchor: 'top-left',
  margin: { top: 1, bottom: 1 },
};

/** Curated list of known providers (sorted by popularity) */
const KNOWN_PROVIDERS: { id: string; label: string; apiFormat?: string }[] = [
  { id: 'anthropic', label: 'Anthropic', apiFormat: 'anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'google', label: 'Google (Gemini)' },
  { id: 'mistral', label: 'Mistral AI' },
  { id: 'xai', label: 'xAI (Grok)' },
  { id: 'groq', label: 'Groq' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'cerebras', label: 'Cerebras' },
  { id: 'fireworks', label: 'Fireworks AI' },
  { id: 'github-copilot', label: 'GitHub Copilot' },
  { id: 'huggingface', label: 'Hugging Face' },
  { id: 'moonshotai', label: 'Moonshot AI (Kimi)' },
  { id: 'cloudflare-workers-ai', label: 'Cloudflare Workers AI' },
  { id: 'amazon-bedrock', label: 'Amazon Bedrock' },
  { id: 'zai', label: 'ZAI' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'opencode', label: 'OpenCode' },
];

// ============ SelectList Theme ============

const SELECT_THEME: SelectListTheme = {
  selectedPrefix: (text: string) => chalk.green(`❯ ${text}`),
  selectedText: (text: string) => chalk.green.bold(text),
  description: (text: string) => chalk.gray(text),
  scrollInfo: (text: string) => chalk.gray(text),
  noMatch: (text: string) => chalk.red(text),
};

// ============ SelectList with Footer ============

/**
 * Wraps SelectList with a footer hint showing available keybindings.
 * This lets users discover navigation keys without relying on terminal conventions.
 */
class SelectListWithFooter implements Component {
  private selectList: SelectList;
  private tui: TUI;

  /** Callbacks stored at wrapper level, forwarded through inner SelectList */
  onSelect?: (item: SelectItem) => void;
  onCancel?: () => void;

  constructor(tui: TUI, items: SelectItem[], maxVisible: number, theme: SelectListTheme) {
    this.tui = tui;
    this.selectList = new SelectList(items, maxVisible, theme);
    // Forward inner callbacks through wrapper properties (resolved at call time)
    this.selectList.onSelect = (item) => {
      this.onSelect?.(item);
    };
    this.selectList.onCancel = () => {
      this.onCancel?.();
    };
  }

  handleInput(data: string): void {
    this.selectList.handleInput(data);
  }

  invalidate(): void {
    this.selectList.invalidate();
  }

  render(width: number): string[] {
    const lines = this.selectList.render(width);

    // Push footer to the bottom of the terminal by padding with blank lines
    const termHeight = this.tui.terminal.rows;
    const overlayStartRow = 1; // OVERLAY_OPTIONS.margin.top
    const footerLines = 3; // separator + hint + trailing empty
    const padding = Math.max(0, termHeight - overlayStartRow - lines.length - footerLines);
    for (let i = 0; i < padding; i++) {
      lines.push('');
    }

    // Append footer separator and keybinding hints
    if (width >= 50) {
      lines.push(chalk.gray(`  ${'─'.repeat(Math.max(0, width - 4))}`));
      lines.push(chalk.gray('  k/j ↑↓ 导航  ·  Enter 选择  ·  Esc 取消'));
    } else {
      // Short hint for narrow terminals
      lines.push(chalk.gray('  ↑↓=k/j  Enter  Esc'));
    }
    lines.push('');
    return lines;
  }
}

// ============ Overlay Helpers ============

/**
 * Show a SelectList overlay and wait for user selection
 * @returns The selected item, or null if cancelled
 */
function showSelectList(
  tui: TUI,
  items: SelectItem[],
  options?: { maxVisible?: number; title?: string }
): Promise<SelectItem | null> {
  return new Promise((resolve) => {
    const list = new SelectListWithFooter(tui, items, options?.maxVisible ?? 10, SELECT_THEME);
    let handle: OverlayHandle | null = null;

    list.onSelect = (item: SelectItem) => {
      handle?.hide();
      resolve(item);
    };
    list.onCancel = () => {
      handle?.hide();
      resolve(null);
    };

    handle = tui.showOverlay(list, OVERLAY_OPTIONS);
  });
}

// ============ Text Input Component (for API Key / Base URL) ============

class TextInputComponent implements Component {
  private input: Input;
  private label: string;

  constructor(
    label: string,
    initialValue: string,
    placeholder: string,
    onSubmit: (value: string) => void,
    onCancel: () => void
  ) {
    this.label = label;
    this.input = new Input();
    if (initialValue) {
      this.input.setValue(initialValue);
    }

    this.input.onSubmit = (value: string) => {
      const finalValue = value === placeholder ? initialValue : value;
      onSubmit(finalValue);
    };
    this.input.onEscape = () => {
      onCancel();
    };
  }

  get focused(): boolean {
    return this.input.focused;
  }

  set focused(v: boolean) {
    this.input.focused = v;
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
  }

  invalidate(): void {
    this.input.invalidate();
  }

  render(width: number): string[] {
    const c = chalk;
    return [
      '',
      c.bold(`  ${this.label}`),
      '',
      c.gray(`  ${'─'.repeat(Math.min(width - 4, 50))}`),
      `  ${this.input.render(width - 4)[0] ?? ''}`,
      c.gray(`  ${'─'.repeat(Math.min(width - 4, 50))}`),
      '',
      c.gray('  Enter to confirm · Esc to cancel'),
      '',
    ];
  }
}

/**
 * Show a text input overlay
 * @returns The entered text, or null if cancelled
 */
function showTextInput(
  tui: TUI,
  label: string,
  initialValue: string,
  placeholder?: string
): Promise<string | null> {
  return new Promise((resolve) => {
    let handle: OverlayHandle | null = null;

    const component = new TextInputComponent(
      label,
      initialValue,
      placeholder ?? '',
      (value: string) => {
        handle?.hide();
        resolve(value);
      },
      () => {
        handle?.hide();
        resolve(null);
      }
    );

    handle = tui.showOverlay(component, {
      width: '60%',
      minWidth: 50,
      maxHeight: 12,
      anchor: 'top-left',
    });
  });
}

// ============ Config Read/Write Utilities ============

/** Read settings.json and return a mutable object */
function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(HOME_CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/** Write back to settings.json */
function writeSettings(settings: Record<string, unknown>): void {
  writeFileSync(HOME_CONFIG_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

/** Set a dot-path value and persist to disk */
function setConfigValue(session: ReplSession, dotPath: string, value: unknown): void {
  const settings = readSettings();
  _setByDotPath(settings, dotPath, value);
  writeSettings(settings);
  // Sync in-memory config
  _setByDotPath(session.config as unknown as Record<string, unknown>, dotPath, value);
  session.applyConfigUpdate(dotPath);
}

/** Safely set a nested property (prototype-chain safe) */
function _setByDotPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1]!;
  if (lastKey === '__proto__' || lastKey === 'constructor' || lastKey === 'prototype') return;
  current[lastKey] = value;
}

/** Get a nested property value via dot-path */
function _getByDotPath(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

/** Check if a provider has an API key configured */
function hasApiKey(config: Record<string, unknown>, providerName: string): boolean {
  const key = _getByDotPath(config, `llm.providers.${providerName}.apiKey`);
  if (!key) return false;
  const keyStr = String(key);
  // Env var references count as configured (resolved at runtime)
  return keyStr.length > 0 && keyStr !== '${}';
}

/** Get available model IDs for a provider (from config or pi-ai) */
function getProviderModels(config: Record<string, unknown>, providerName: string): string[] {
  // 1. Check explicitly declared models in config
  const models = _getByDotPath(config, `llm.providers.${providerName}.models`) as
    | Record<string, unknown>
    | undefined;
  if (models && typeof models === 'object' && Object.keys(models).length > 0) {
    return Object.keys(models);
  }

  // 2. Try pi-ai built-in registry
  try {
    const piModels = getModels(providerName as never);
    if (piModels && piModels.length > 0) {
      return piModels.map((m: { id: string }) => m.id);
    }
  } catch {
    // pi-ai has no model registry for this provider
  }

  return [];
}

// ============ Command Implementation ============

/**
 * Create the /settings command definition
 */
export function createSettingsCommand(): CommandDefinition {
  return {
    name: 'settings',
    aliases: ['set'],
    description: 'Interactive configuration menu — manage model providers and API keys',
    usage: '/settings [list-providers | list-models <provider>]',
    async handler(args: string[], session: ReplSession) {
      const tui = session.getTui();
      const config = readSettings();

      // CLI mode
      if (args.length > 0) {
        await handleCommandLine(args, session, tui, config);
        return;
      }

      // Interactive menu mode
      await handleInteractiveMode(tui, session, config);
    },
  };
}

/**
 * CLI mode — quick operations via arguments
 */
async function handleCommandLine(
  args: string[],
  session: ReplSession,
  _tui: TUI,
  config: Record<string, unknown>
): Promise<void> {
  switch (args[0]) {
    case 'list-providers': {
      const providers = _getByDotPath(config, 'llm.providers') as
        | Record<string, unknown>
        | undefined;
      const names = providers ? Object.keys(providers) : [];
      const lines: string[] = ['', 'Known providers:'];
      for (const p of KNOWN_PROVIDERS) {
        const configured = names.includes(p.id) ? ' ✓' : '   ';
        lines.push(`  ${configured} ${p.label} (${p.id})`);
      }
      session.appendOutput(lines);
      return;
    }

    case 'list-models': {
      if (!args[1]) {
        session.appendOutput(['', 'Usage: /settings list-models <provider>', '']);
        return;
      }
      const modelIds = getProviderModels(config, args[1]);
      if (modelIds.length === 0) {
        session.appendOutput([
          '',
          `Provider "${args[1]}" has no known models`,
          'Hint: use /settings to configure this provider first',
          '',
        ]);
        return;
      }
      session.appendOutput([
        '',
        `${args[1]} available models:`,
        ...modelIds.map((id) => `  - ${id}`),
        '',
      ]);
      return;
    }

    default: {
      session.appendOutput([
        '',
        'Usage:',
        '  /settings                    — Open interactive configuration menu',
        '  /settings list-providers     — List all known providers',
        '  /settings list-models <name> — List available models for a provider',
        '',
      ]);
    }
  }
}

/**
 * Interactive menu mode — main flow
 */
async function handleInteractiveMode(
  tui: TUI,
  session: ReplSession,
  config: Record<string, unknown>
): Promise<void> {
  // Mutable ref so callbacks always read the latest config
  const state: { current: Record<string, unknown> } = { current: config };

  /**
   * Handle API Key configuration
   */
  const handleApiKeyConfig = async (providerName: string, _currentKey: string): Promise<void> => {
    const envVarName = `${providerName.toUpperCase().replace(/-/g, '_')}_API_KEY`;

    const choice = await showSelectList(tui, [
      {
        value: 'env',
        label: `Use env var ${'${' + envVarName + '}'}`,
        description: 'Recommended — more secure',
      },
      {
        value: 'manual',
        label: 'Enter manually',
        description: 'Type the key directly (stored in plaintext in settings.json)',
      },
      {
        value: 'clear',
        label: 'Clear',
        description: 'Remove the configured key',
      },
    ]);

    if (!choice) return;

    if (choice.value === 'clear') {
      setConfigValue(session, `llm.providers.${providerName}.apiKey`, '');
      session.appendOutput(['', `  [ok] Cleared API key for ${providerName}`, '']);
    } else if (choice.value === 'env') {
      setConfigValue(session, `llm.providers.${providerName}.apiKey`, `\${${envVarName}}`);
      session.appendOutput([
        '',
        `  [ok] Set ${providerName} API key to env var \${${envVarName}}`,
        `  Make sure ${envVarName} is set in your shell`,
        '',
      ]);
    } else if (choice.value === 'manual') {
      const key = await showTextInput(tui, `Enter ${providerName} API Key`, '', 'sk-...');
      if (key && key.length > 0) {
        setConfigValue(session, `llm.providers.${providerName}.apiKey`, key);
        session.appendOutput(['', `  [ok] Configured API key for ${providerName}`, '']);
      }
    }
  };

  /**
   * Handle Base URL configuration
   */
  const handleBaseUrlConfig = async (providerName: string, _currentUrl: string): Promise<void> => {
    const url = await showTextInput(
      tui,
      `Enter ${providerName} Base URL`,
      '',
      'https://api.example.com'
    );
    if (url !== null) {
      const configPath = `llm.providers.${providerName}.baseUrl`;
      if (url.length === 0) {
        // Clear Base URL → use pi-ai default
        const settings = readSettings();
        _setByDotPath(settings, configPath, undefined);
        const parent = _getByDotPath(settings, `llm.providers.${providerName}`) as Record<
          string,
          unknown
        >;
        if (parent) delete parent.baseUrl;
        writeSettings(settings);
        session.appendOutput(['', `  [ok] Reset ${providerName} Base URL to default`, '']);
      } else {
        setConfigValue(session, configPath, url);
        session.appendOutput(['', `  [ok] Set ${providerName} Base URL: ${url}`, '']);
      }
    }
  };

  /**
   * Handle model selection
   */
  const handleModelSelect = async (providerName: string): Promise<void> => {
    const modelIds = getProviderModels(state.current, providerName);
    if (modelIds.length === 0) {
      session.appendOutput([
        '',
        `  ${providerName} has no available model list`,
        '  Configure models manually in settings.json or check the provider name',
        '',
      ]);
      return;
    }

    const selected = await showSelectList(
      tui,
      modelIds.map((id) => ({ value: id, label: id, description: '' }))
    );

    if (selected && selected.value) {
      const modelId = selected.value;
      // Register the model in config
      const settings = readSettings();
      _setByDotPath(settings, `llm.providers.${providerName}.models.${modelId}`, { id: modelId });
      writeSettings(settings);
      // Sync to in-memory config
      _setByDotPath(
        session.config as unknown as Record<string, unknown>,
        `llm.providers.${providerName}.models`,
        (_getByDotPath(settings, `llm.providers.${providerName}.models`) as
          | Record<string, unknown>
          | undefined) ?? {}
      );
      session.appendOutput(['', `  [ok] Selected model: ${providerName}/${modelId}`, '']);
    }
  };

  /**
   * Handle setting a provider's model as the default
   */
  const handleSetDefault = async (providerName: string): Promise<void> => {
    const modelIds = getProviderModels(state.current, providerName);
    if (modelIds.length === 0) {
      session.appendOutput(['', '  Configure a model first before setting it as default', '']);
      return;
    }
    const modelKey = `${providerName}/${modelIds[0]!}`;
    setConfigValue(session, 'llm.defaultModel', modelKey);
    session.appendOutput(['', `  [ok] Default model set to: ${modelKey}`, '']);
  };

  // ============ Main Loop ============

  let running = true;

  while (running) {
    // Refresh config
    state.current = readSettings();

    // Main menu — uses SelectList (items are actions, not values)
    const mainActions: SelectItem[] = [
      {
        value: 'default-model',
        label: `Default Model`,
        description: String(_getByDotPath(state.current, 'llm.defaultModel') ?? 'not configured'),
      },
      ...Object.entries(
        (_getByDotPath(state.current, 'llm.providers') as Record<string, unknown>) ?? {}
      ).map(([name]) => {
        const hasK = hasApiKey(state.current, name);
        return {
          value: `provider:${name}`,
          label: name,
          description: hasK ? 'key configured' : 'no key',
        };
      }),
      {
        value: 'add-provider',
        label: 'Add Provider',
        description: 'Select from a list of known providers',
      },
      {
        value: 'view-config',
        label: 'View Config',
        description: 'Show current configuration in the output area',
      },
    ];

    const choice = await showSelectList(tui, mainActions);

    if (!choice) {
      // Cancelled → exit
      running = false;
      break;
    }

    const value = choice.value;

    if (value === 'default-model') {
      // Model selector
      const providers = _getByDotPath(state.current, 'llm.providers') as
        | Record<string, unknown>
        | undefined;
      if (!providers || Object.keys(providers).length === 0) {
        session.appendOutput(['', '  Configure at least one provider first', '']);
        continue;
      }

      const modelItems: SelectItem[] = [];
      for (const [providerName] of Object.entries(providers)) {
        const models = getProviderModels(state.current, providerName);
        for (const modelId of models) {
          modelItems.push({
            value: `${providerName}/${modelId}`,
            label: `${providerName}/${modelId}`,
            description: '',
          });
        }
      }

      if (modelItems.length === 0) {
        session.appendOutput([
          '',
          '  No models available',
          '  Configure a provider with models first',
          '',
        ]);
        continue;
      }

      const selected = await showSelectList(tui, modelItems);
      if (selected && selected.value) {
        setConfigValue(session, 'llm.defaultModel', selected.value);
        session.appendOutput(['', `  [ok] Default model set to: ${selected.value}`, '']);
      }
    } else if (value.startsWith('provider:')) {
      const providerName = value.slice('provider:'.length);

      // Provider action menu
      const providerActions: SelectItem[] = [
        { value: 'api-key', label: 'Configure API Key', description: '' },
        { value: 'model', label: 'Select Model', description: '' },
        { value: 'base-url', label: 'Base URL', description: '' },
        { value: 'set-default', label: 'Set as Default', description: '' },
      ];

      const action = await showSelectList(tui, providerActions);
      if (!action) continue;

      switch (action.value) {
        case 'api-key':
          await handleApiKeyConfig(
            providerName,
            String(_getByDotPath(state.current, `llm.providers.${providerName}.apiKey`) ?? '')
          );
          break;
        case 'model':
          await handleModelSelect(providerName);
          break;
        case 'base-url':
          await handleBaseUrlConfig(
            providerName,
            String(_getByDotPath(state.current, `llm.providers.${providerName}.baseUrl`) ?? '')
          );
          break;
        case 'set-default':
          await handleSetDefault(providerName);
          break;
      }
    } else if (value === 'add-provider') {
      // Add new provider
      const selected = await showSelectList(
        tui,
        KNOWN_PROVIDERS.map((p) => ({
          value: p.id,
          label: `${p.label} (${p.id})`,
          description: p.apiFormat ? `API format: ${p.apiFormat}` : 'OpenAI compatible',
        })),
        { maxVisible: 12 }
      );

      if (!selected || !selected.value) continue;

      const providerName = selected.value;

      // Check if already exists
      const existingProviders = _getByDotPath(state.current, 'llm.providers') as
        | Record<string, unknown>
        | undefined;
      if (existingProviders && providerName in existingProviders) {
        session.appendOutput([
          '',
          `  ${providerName} already exists, use the provider entry to configure it`,
          '',
        ]);
        continue;
      }

      // Add to config
      const known = KNOWN_PROVIDERS.find((p) => p.id === providerName);
      const newProvider: Record<string, unknown> = {
        apiKey: '',
      };
      if (known?.apiFormat) {
        newProvider.apiFormat = known.apiFormat;
      }

      const settings = readSettings();
      _setByDotPath(settings, `llm.providers.${providerName}`, newProvider);
      writeSettings(settings);
      _setByDotPath(
        session.config as unknown as Record<string, unknown>,
        `llm.providers.${providerName}`,
        newProvider
      );

      session.appendOutput(['', `  [ok] Added provider: ${providerName}`, '']);

      // Prompt to configure API key
      const shouldConfigure = await showSelectList(tui, [
        {
          value: 'yes',
          label: 'Yes, configure API Key now',
          description: 'Go to API Key settings',
        },
        {
          value: 'no',
          label: 'Later',
          description: 'Return to main menu',
        },
      ]);

      if (shouldConfigure?.value === 'yes') {
        await handleApiKeyConfig(providerName, '');
      }
    } else if (value === 'view-config') {
      const renderer = session.getRenderer();
      const configLines = renderer.renderConfig(session.config);
      session.appendOutput(configLines);
    }
  }
}
