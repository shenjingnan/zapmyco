/**
 * /settings command — interactive configuration menu
 *
 * TUI overlay-based graphical configuration interface:
 * - View and change the default model
 * - Configure API keys, models, and base URLs for existing providers
 * - Add new providers from a curated list
 * - All changes sync to ~/.zapmyco/settings.json in real-time
 */

import chalk from 'chalk';
import {
  showConfigView,
  showSelectList,
  showTextInput,
} from '@/cli/repl/components/legacy/dialogs';
import { _getByDotPath, _setByDotPath, readSettings, writeSettings } from '@/cli/repl/config-utils';
import type { CommandDefinition, ReplSession } from '@/cli/repl/types';
import type { SelectItem, TUI } from '@/cli/tui';
import { setLocale, t } from '@/i18n';

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

/** Built-in model IDs for known providers (fallback when not in config) */
const BUILTIN_MODEL_IDS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'],
  deepseek: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  glm: ['glm-4', 'glm-4v'],
  kimi: ['moonshot-v1-8k', 'moonshot-v1-32k'],
  minimax: ['minimax-text-01'],
};

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
  // biome-ignore lint/suspicious/noTemplateCurlyInString: 空环境变量占位符检查
  return keyStr.length > 0 && keyStr !== '${}';
}

/** Get available model IDs for a provider (from config or built-in list) */
function getProviderModels(config: Record<string, unknown>, providerName: string): string[] {
  // 1. Check explicitly declared models in config
  const models = _getByDotPath(config, `llm.providers.${providerName}.models`) as
    | Record<string, unknown>
    | undefined;
  if (models && typeof models === 'object' && Object.keys(models).length > 0) {
    return Object.keys(models);
  }

  // 2. Fall back to built-in model list
  const builtinModels = BUILTIN_MODEL_IDS[providerName];
  if (builtinModels && builtinModels.length > 0) {
    return builtinModels;
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
    aliases: [],
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
      const lines: string[] = ['', t('settings.cliMode.knownProviders')];
      for (const p of KNOWN_PROVIDERS) {
        const configured = names.includes(p.id) ? ' ✓' : '   ';
        lines.push(`  ${configured} ${p.label} (${p.id})`);
      }
      session.appendOutput(lines);
      return;
    }

    case 'list-models': {
      if (!args[1]) {
        session.appendOutput([
          '',
          `${t('settings.cliMode.usage')} /settings list-models <provider>`,
          '',
        ]);
        return;
      }
      const modelIds = getProviderModels(config, args[1]);
      if (modelIds.length === 0) {
        session.appendOutput([
          '',
          `Provider "${args[1]}" ${t('settings.messages.noModels')}`,
          t('settings.cliMode.hintConfigureFirst'),
          '',
        ]);
        return;
      }
      session.appendOutput([
        '',
        `${args[1]} ${t('settings.cliMode.availableModels')}`,
        ...modelIds.map((id) => `  - ${id}`),
        '',
      ]);
      return;
    }

    default: {
      session.appendOutput([
        '',
        t('settings.cliMode.usage'),
        `  ${t('settings.cliMode.settingsUsage')}`,
        `  ${t('settings.cliMode.listProvidersUsage')}`,
        `  ${t('settings.cliMode.listModelsUsage')}`,
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
          label: `${t('settings.apiKeyConfig.useEnvVar')} \${${envVarName}}`,
          description: t('settings.apiKeyConfig.useEnvVarDesc'),
        },
        {
          value: 'manual',
          label: t('settings.apiKeyConfig.enterManually'),
          description: t('settings.apiKeyConfig.enterManuallyDesc'),
        },
        {
          value: 'clear',
          label: t('settings.apiKeyConfig.clear'),
          description: t('settings.apiKeyConfig.clearDesc'),
        },
      ],
      { onExit: exitAll }
    );

    if (!choice) return;

    if (choice.value === 'clear') {
      setConfigValue(session, `llm.providers.${providerName}.apiKey`, '');
      session.appendOutput([
        '',
        `  ${t('settings.messages.apiKeyCleared', { provider: providerName })}`,
        '',
      ]);
    } else if (choice.value === 'env') {
      setConfigValue(session, `llm.providers.${providerName}.apiKey`, `\${${envVarName}}`);
      session.appendOutput([
        '',
        `  ${t('settings.messages.apiKeySetToEnv', { provider: providerName, envVar: envVarName })}`,
        `  ${t('settings.messages.envVarNote', { envVar: envVarName })}`,
        '',
      ]);
    } else if (choice.value === 'manual') {
      const key = await showTextInput(tui, `Enter ${providerName} API Key`, '', 'sk-...');
      if (key && key.length > 0) {
        setConfigValue(session, `llm.providers.${providerName}.apiKey`, key);
        session.appendOutput([
          '',
          `  ${t('settings.messages.apiKeyConfigured', { provider: providerName })}`,
          '',
        ]);
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
        // Clear Base URL → use provider default
        const settings = readSettings();
        _setByDotPath(settings, configPath, undefined);
        const parent = _getByDotPath(settings, `llm.providers.${providerName}`) as Record<
          string,
          unknown
        >;
        if (parent) delete parent.baseUrl;
        writeSettings(settings);
        session.appendOutput([
          '',
          `  ${t('settings.messages.baseUrlReset', { provider: providerName })}`,
          '',
        ]);
      } else {
        setConfigValue(session, configPath, url);
        session.appendOutput([
          '',
          `  ${t('settings.messages.baseUrlSet', { provider: providerName, url })}`,
          '',
        ]);
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
        `  ${providerName} ${t('settings.messages.noModels')}`,
        `  ${t('settings.messages.configureManually')}`,
        '',
      ]);
      return;
    }

    const selected = await showSelectList(
      tui,
      modelIds.map((id) => ({ value: id, label: id, description: '' })),
      { onExit: exitAll }
    );

    if (selected?.value) {
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
      session.appendOutput([
        '',
        `  ${t('settings.messages.modelSelected', { model: `${providerName}/${modelId}` })}`,
        '',
      ]);
    }
  };

  /**
   * Handle setting a provider's model as the default
   */
  const handleSetDefault = async (providerName: string): Promise<void> => {
    const modelIds = getProviderModels(state.current, providerName);
    if (modelIds.length === 0) {
      session.appendOutput(['', `  ${t('settings.messages.configureFirst')}`, '']);
      return;
    }
    // biome-ignore lint/style/noNonNullAssertion: checked modelIds.length > 0 above
    const modelKey = `${providerName}/${modelIds[0]!}`;
    setConfigValue(session, 'llm.defaultModel', modelKey);
    session.appendOutput([
      '',
      `  ${t('settings.messages.defaultModelSet', { model: modelKey })}`,
      '',
    ]);
  };

  /**
   * Generic handler for selecting a model from all providers and writing it to
   * a specific config slot (defaultModel / visionModel / lightModel / analysisModel).
   *
   * Reuses the same "show all models → select → save" flow that 'default-model'
   * uses, only the target config key and success message differ.
   */
  const handleModelSlotSelect = async (
    configKey: string,
    successMsgKey: 'defaultModelSet' | 'visionModelSet' | 'lightModelSet' | 'analysisModelSet'
  ): Promise<void> => {
    const configuredProviders = _getByDotPath(state.current, 'llm.providers') as
      | Record<string, unknown>
      | undefined;
    // Merge configured providers + built-in providers
    const configuredProviderNames = configuredProviders ? Object.keys(configuredProviders) : [];
    const builtinProviderNames = Object.keys(BUILTIN_MODEL_IDS);
    const allProviders = [...new Set([...configuredProviderNames, ...builtinProviderNames])];

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
            description: chalk.gray(t('settings.modelSelector.notConfigured')),
          });
        }
      }
    }
    // Enabled models first, then disabled
    const modelItems: SelectItem[] = [...enabledItems, ...disabledItems];

    if (modelItems.length === 0) {
      session.appendOutput(['', `  ${t('settings.cliMode.noModelsAvailable')}`, '']);
      return;
    }

    const selected = await showSelectList(tui, modelItems, { onExit: exitAll });
    if (!selected?.value) return;

    const selectedKey = selected.value;
    const slashIndex = selectedKey.indexOf('/');
    const providerName = selectedKey.slice(0, slashIndex);

    // Check if provider is enabled
    const isEnabled =
      configuredProviders !== undefined &&
      providerName in configuredProviders &&
      hasApiKey(state.current, providerName);

    if (isEnabled) {
      // Enabled provider — set the model immediately
      setConfigValue(session, configKey, selectedKey);
      session.appendOutput([
        '',
        `  ${t(`settings.messages.${successMsgKey}`, { model: selectedKey })}`,
        '',
      ]);
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

      // If apiKey was configured, set the model
      state.current = readSettings();
      if (hasApiKey(state.current, providerName)) {
        setConfigValue(session, configKey, selectedKey);
        session.appendOutput([
          '',
          `  ${t(`settings.messages.${successMsgKey}`, { model: selectedKey })}`,
          '',
        ]);
      }
    }
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
        label: t('settings.mainMenu.defaultModel'),
        description: String(
          _getByDotPath(state.current, 'llm.defaultModel') ?? t('settings.mainMenu.notConfigured')
        ),
      },
      {
        value: 'vision-model',
        label: t('settings.mainMenu.visionModel'),
        description: String(
          _getByDotPath(state.current, 'llm.visionModel') ?? t('settings.mainMenu.notConfigured')
        ),
      },
      {
        value: 'light-model',
        label: t('settings.mainMenu.lightModel'),
        description: String(
          _getByDotPath(state.current, 'llm.lightModel') ?? t('settings.mainMenu.notConfigured')
        ),
      },
      {
        value: 'analysis-model',
        label: t('settings.mainMenu.analysisModel'),
        description: String(
          _getByDotPath(state.current, 'llm.analysisModel') ?? t('settings.mainMenu.notConfigured')
        ),
      },
      {
        value: 'manage-providers',
        label: t('settings.mainMenu.manageProviders'),
        description:
          providerCount > 0
            ? t('settings.mainMenu.nConfigured', { count: providerCount })
            : t('settings.mainMenu.noneConfigured'),
      },
      {
        value: 'view-config',
        label: t('settings.mainMenu.viewConfig'),
        description: t('settings.mainMenu.displayFullConfig'),
      },
      {
        value: 'language',
        label: t('settings.mainMenu.language'),
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
      await handleModelSlotSelect('llm.defaultModel', 'defaultModelSet');
    } else if (value === 'vision-model') {
      await handleModelSlotSelect('llm.visionModel', 'visionModelSet');
    } else if (value === 'light-model') {
      await handleModelSlotSelect('llm.lightModel', 'lightModelSet');
    } else if (value === 'analysis-model') {
      await handleModelSlotSelect('llm.analysisModel', 'analysisModelSet');
    } else if (value === 'manage-providers') {
      // Manage Providers submenu — shows configured providers + Add Provider
      const providerEntries: SelectItem[] = [
        ...Object.entries(providers).map(([name]) => {
          const hasK = hasApiKey(state.current, name);
          return {
            value: `provider:${name}`,
            label: name,
            description: hasK
              ? t('settings.providerEntry.keyConfigured')
              : t('settings.providerEntry.noKey'),
          };
        }),
        {
          value: 'add-provider',
          label: t('settings.providerEntry.addProvider'),
          description: t('settings.providerEntry.addProviderDesc'),
        },
      ];

      const providerChoice = await showSelectList(tui, providerEntries, { onExit: exitAll });
      if (!providerChoice) continue; // cancelled → back to main menu

      const providerValue = providerChoice.value;

      if (providerValue.startsWith('provider:')) {
        // Provider action submenu
        const providerName = providerValue.slice('provider:'.length);

        const providerActions: SelectItem[] = [
          {
            value: 'api-key',
            label: t('settings.providerActions.configureApiKey'),
            description: '',
          },
          { value: 'model', label: t('settings.providerActions.selectModel'), description: '' },
          { value: 'base-url', label: t('settings.providerActions.baseUrl'), description: '' },
          {
            value: 'set-default',
            label: t('settings.providerActions.setAsDefault'),
            description: '',
          },
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
            description: p.apiFormat
              ? t('settings.providerEntry.apiFormat', { format: p.apiFormat })
              : t('settings.providerEntry.openaiCompatible'),
          })),
          { maxVisible: 12, onExit: exitAll }
        );

        if (!selected?.value) continue;

        const providerName = selected.value;

        // Check if already exists
        const existingProviders = _getByDotPath(state.current, 'llm.providers') as
          | Record<string, unknown>
          | undefined;
        if (existingProviders && providerName in existingProviders) {
          session.appendOutput([
            '',
            `  ${providerName} ${t('settings.messages.alreadyExists')}`,
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

        session.appendOutput([
          '',
          `  ${t('settings.messages.providerAdded', { provider: providerName })}`,
          '',
        ]);

        // Prompt to configure API key
        const shouldConfigure = await showSelectList(
          tui,
          [
            {
              value: 'yes',
              label: t('settings.addProvider.yes'),
              description: t('settings.addProvider.yesDesc'),
            },
            {
              value: 'no',
              label: t('settings.addProvider.later'),
              description: t('settings.addProvider.laterDesc'),
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
      if (!selected?.value) continue;

      if (selected.value !== currentLocale) {
        setConfigValue(session, 'locale', selected.value);
        setLocale(selected.value);
        session.appendOutput([
          '',
          `  ${t('settings.messages.languageSet', { locale: selected.value })}`,
          `  ${t('settings.messages.restartRequired')}`,
          '',
        ]);
      }
    }
  }
}
