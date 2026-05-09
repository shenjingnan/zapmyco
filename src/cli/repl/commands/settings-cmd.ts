/**
 * /settings command — interactive configuration menu
 *
 * TUI overlay-based graphical configuration interface:
 * - View and change the default model
 * - Configure API keys, models, and base URLs for existing providers
 * - Add new providers from a curated list
 * - All changes sync to ~/.zapmyco/settings.json in real-time
 */

import { getModels, getProviders } from '@mariozechner/pi-ai';
import type { SelectItem, TUI } from '@mariozechner/pi-tui';
import chalk from 'chalk';
import { showConfigView, showSelectList, showTextInput } from '@/cli/repl/components/dialogs';
import { _getByDotPath, _setByDotPath, readSettings, writeSettings } from '@/cli/repl/config-utils';
import type { CommandDefinition, ReplSession } from '@/cli/repl/types';

// ============ Constants ============

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

/** Supported language locales */
const SUPPORTED_LOCALES: { value: string; label: string; description: string }[] = [
  { value: 'zh-CN', label: '简体中文', description: 'Chinese (Simplified)' },
  { value: 'en', label: 'English', description: 'English' },
];

// ============ Config Utilities ============

/** Set a dot-path value, persist to disk and hot-reload agent */
function setConfigValue(session: ReplSession, dotPath: string, value: unknown): void {
  const settings = readSettings();
  _setByDotPath(settings, dotPath, value);
  writeSettings(settings);
  // Sync in-memory config
  _setByDotPath(session.config as unknown as Record<string, unknown>, dotPath, value);
  session.applyConfigUpdate(dotPath);
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

    const choice = await showSelectList(
      tui,
      [
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
      ],
      { onExit: exitAll }
    );

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
      modelIds.map((id) => ({ value: id, label: id, description: '' })),
      { onExit: exitAll }
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
  const exitAll = () => {
    running = false;
  };

  while (running) {
    // Refresh config
    state.current = readSettings();

    // Main menu — uses SelectList (items are actions, not values)
    const providers =
      (_getByDotPath(state.current, 'llm.providers') as Record<string, unknown> | undefined) ?? {};
    const providerCount = Object.keys(providers).length;

    const mainActions: SelectItem[] = [
      {
        value: 'default-model',
        label: 'Default Model',
        description: String(_getByDotPath(state.current, 'llm.defaultModel') ?? 'not configured'),
      },
      {
        value: 'manage-providers',
        label: 'Manage Providers',
        description: providerCount > 0 ? `${providerCount} configured` : 'none configured',
      },
      {
        value: 'view-config',
        label: 'View Config',
        description: 'Display full configuration details',
      },
      {
        value: 'language',
        label: 'Language / 语言',
        description: String(_getByDotPath(state.current, 'locale') ?? 'zh-CN'),
      },
    ];

    const choice = await showSelectList(tui, mainActions, { onExit: exitAll });

    if (!choice) {
      // Cancelled → exit
      running = false;
      break;
    }

    const value = choice.value;

    if (value === 'default-model') {
      // Model selector — show all models from all pi-ai providers
      const configuredProviders = _getByDotPath(state.current, 'llm.providers') as
        | Record<string, unknown>
        | undefined;
      const allProviders = getProviders();

      const enabledItems: SelectItem[] = [];
      const disabledItems: SelectItem[] = [];
      for (const providerName of allProviders) {
        const models = getProviderModels(state.current, providerName);
        if (models.length === 0) continue;

        const isEnabled =
          configuredProviders !== undefined &&
          providerName in configuredProviders &&
          hasApiKey(state.current, providerName);

        for (const modelId of models) {
          const key = `${providerName}/${modelId}`;
          if (isEnabled) {
            enabledItems.push({ value: key, label: key, description: '' });
          } else {
            disabledItems.push({
              value: key,
              label: chalk.gray(key),
              description: chalk.gray('未配置 - Enter 设置 API Key'),
            });
          }
        }
      }
      // Enabled models first, then disabled
      const modelItems: SelectItem[] = [...enabledItems, ...disabledItems];

      if (modelItems.length === 0) {
        session.appendOutput(['', '  No models available from pi-ai registry', '']);
        continue;
      }

      const selected = await showSelectList(tui, modelItems, { onExit: exitAll });
      if (!selected || !selected.value) continue;

      const selectedKey = selected.value;
      const slashIndex = selectedKey.indexOf('/');
      const providerName = selectedKey.slice(0, slashIndex);

      // Check if provider is enabled
      const isEnabled =
        configuredProviders !== undefined &&
        providerName in configuredProviders &&
        hasApiKey(state.current, providerName);

      if (isEnabled) {
        // Enabled provider — set as default immediately
        setConfigValue(session, 'llm.defaultModel', selectedKey);
        session.appendOutput(['', `  [ok] Default model set to: ${selectedKey}`, '']);
      } else {
        // Not enabled — add provider and guide apiKey setup first
        if (!configuredProviders || !(providerName in configuredProviders)) {
          const known = KNOWN_PROVIDERS.find((p) => p.id === providerName);
          const newProvider: Record<string, unknown> = { apiKey: '' };
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
          state.current = readSettings();
        }

        // Prompt for apiKey
        await handleApiKeyConfig(providerName, '');

        // If apiKey was configured, set as default
        state.current = readSettings();
        if (hasApiKey(state.current, providerName)) {
          setConfigValue(session, 'llm.defaultModel', selectedKey);
          session.appendOutput(['', `  [ok] Default model set to: ${selectedKey}`, '']);
        }
      }
    } else if (value === 'manage-providers') {
      // Manage Providers submenu — shows configured providers + Add Provider
      const providerEntries: SelectItem[] = [
        ...Object.entries(providers).map(([name]) => {
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
      ];

      const providerChoice = await showSelectList(tui, providerEntries, { onExit: exitAll });
      if (!providerChoice) continue; // cancelled → back to main menu

      const providerValue = providerChoice.value;

      if (providerValue.startsWith('provider:')) {
        // Provider action submenu
        const providerName = providerValue.slice('provider:'.length);

        const providerActions: SelectItem[] = [
          { value: 'api-key', label: 'Configure API Key', description: '' },
          { value: 'model', label: 'Select Model', description: '' },
          { value: 'base-url', label: 'Base URL', description: '' },
          { value: 'set-default', label: 'Set as Default', description: '' },
        ];

        const action = await showSelectList(tui, providerActions, { onExit: exitAll });
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
      } else if (providerValue === 'add-provider') {
        // Add new provider from curated list
        const selected = await showSelectList(
          tui,
          KNOWN_PROVIDERS.map((p) => ({
            value: p.id,
            label: `${p.label} (${p.id})`,
            description: p.apiFormat ? `API format: ${p.apiFormat}` : 'OpenAI compatible',
          })),
          { maxVisible: 12, onExit: exitAll }
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
        const shouldConfigure = await showSelectList(
          tui,
          [
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
          ],
          { onExit: exitAll }
        );

        if (shouldConfigure?.value === 'yes') {
          await handleApiKeyConfig(providerName, '');
        }
      }
    } else if (value === 'view-config') {
      const renderer = session.getRenderer();
      await showConfigView(tui, session.config, renderer);
    } else if (value === 'language') {
      const currentLocale = String(_getByDotPath(state.current, 'locale') ?? 'zh-CN');
      const localeItems = SUPPORTED_LOCALES.map((loc) => ({
        ...loc,
        label: loc.value === currentLocale ? `${loc.label} ✓` : loc.label,
      }));

      const selected = await showSelectList(tui, localeItems, { onExit: exitAll });
      if (!selected || !selected.value) continue;

      if (selected.value !== currentLocale) {
        setConfigValue(session, 'locale', selected.value);
        session.appendOutput([
          '',
          `  [ok] Language set to: ${selected.value}`,
          '  Some changes may require a session restart to take full effect.',
          '',
        ]);
      }
    }
  }
}
