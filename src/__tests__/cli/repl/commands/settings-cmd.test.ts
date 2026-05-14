import type { Component } from '@mariozechner/pi-tui';
import { describe, expect, it, vi } from 'vitest';
import { createSettingsCommand } from '@/cli/repl/commands/settings-cmd';
import type { ReplSession } from '@/cli/repl/types';

// ============ Mock node:fs so readSettings() returns testable config ============

const TEST_CONFIG = {
  llm: {
    defaultModel: 'deepseek/deepseek-chat',
    providers: {
      deepseek: { apiKey: 'sk-test-key' },
      anthropic: {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: 环境变量占位符
        apiKey: '${ANTHROPIC_API_KEY}',
      },
    },
    defaults: { maxTokens: 8192, temperature: 0.7 },
  },
};

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => JSON.stringify(TEST_CONFIG)),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

// Mock matchesKey — 测试中使用解析后的键名（如 'escape'）进行比较
vi.mock('@mariozechner/pi-tui', async (importOriginal) => {
  const actual = await importOriginal();
  return Object.assign({}, actual, {
    matchesKey: vi.fn((data: string, key: string) => data === key),
  });
});

// ============ Mock helpers ============

interface MockTui {
  capturedComponents: Component[];
  showOverlay: ReturnType<typeof vi.fn>;
  terminal: { rows: number };
}

function createMockTui(): MockTui {
  const capturedComponents: Component[] = [];
  return {
    capturedComponents,
    showOverlay: vi.fn((component: Component) => {
      capturedComponents.push(component);
      return { hide: vi.fn() };
    }),
    terminal: { rows: 40 },
  };
}

function createMockSession(tui?: MockTui): ReplSession {
  return {
    currentState: 'idle' as const,
    replOptions: {
      color: false,
      debug: false,
      maxHistorySize: 100,
      prompt: '> ',
      continuationPrompt: '... ',
    },
    config: {
      llm: {
        defaultModel: 'deepseek/deepseek-chat',
        providers: {
          deepseek: {
            apiKey: 'sk-test-key',
            models: {
              'deepseek-chat': { id: 'deepseek-chat' },
            },
          },
          anthropic: {
            // biome-ignore lint/suspicious/noTemplateCurlyInString: 环境变量占位符
            apiKey: '${ANTHROPIC_API_KEY}',
          },
        },
        defaults: { maxTokens: 8192, temperature: 0.7 },
      },
      scheduler: {
        maxConcurrency: 5,
        maxPerAgent: 3,
        taskTimeoutMs: 1800000,
        maxRetries: 3,
        retryBaseDelayMs: 1000,
      },
      agents: [{ id: 'code-agent', enabled: true }],
      cli: { color: true, debug: false, outputFormat: 'text' },
    },
    shutdown: vi.fn(),
    getRenderer: vi.fn().mockReturnValue({
      renderWelcome: vi.fn().mockReturnValue([]),
      renderError: vi.fn().mockReturnValue([]),
      renderResult: vi.fn().mockReturnValue([]),
      renderTaskGraph: vi.fn().mockReturnValue([]),
      renderAgents: vi.fn().mockReturnValue([]),
      renderConfig: vi.fn().mockReturnValue(['', '  ⚙️  current config', '']),
      renderHistory: vi.fn().mockReturnValue([]),
      renderStatus: vi.fn().mockReturnValue([]),
    }),
    getHistoryStore: vi.fn(),
    getStats: vi.fn(),
    executeGoal: vi.fn(),
    appendOutput: vi.fn(),
    clearOutput: vi.fn(),
    requestRender: vi.fn(),
    getCommandRegistry: vi.fn(),
    getInputParser: vi.fn(),
    getTui: vi.fn().mockReturnValue(tui),
    applyConfigUpdate: vi.fn(),
  };
}

/** Wait for the nth captured component to appear */
async function waitForComponent(captured: Component[], index: number): Promise<Component> {
  return vi.waitFor(() => {
    expect(captured.length).toBeGreaterThan(index);
    return captured[index] as Component;
  });
}

/** Manually trigger selection on a captured SelectList component */
function selectItem(component: Component, value: string): void {
  type WithSelect = {
    onSelect?: (item: { value: string; label: string; description: string }) => void;
  };
  (component as unknown as WithSelect).onSelect?.({ value, label: value, description: '' });
}

/** Cancel selection on a captured SelectList component */
function cancelSelection(component: Component): void {
  type WithCancel = { onCancel?: () => void };
  (component as unknown as WithCancel).onCancel?.();
}

/** Trigger exit (q/escape) on a captured SelectList component */
function exitSelection(component: Component): void {
  type WithExit = { onExit?: () => void };
  (component as unknown as WithExit).onExit?.();
}

/** Trigger back (backspace/h) on a captured SelectList component */
function backSelection(component: Component): void {
  type WithBack = { onBack?: () => void };
  (component as unknown as WithBack).onBack?.();
}

// ============ Tests ============

describe('/settings command', () => {
  describe('createSettingsCommand', () => {
    it('应返回正确的命令定义', () => {
      const cmd = createSettingsCommand();
      expect(cmd.name).toBe('settings');
      expect(cmd.aliases).toEqual([]);
      expect(cmd.description).toContain('configuration menu');
      expect(cmd.usage).toContain('list-providers');
    });
  });

  describe('CLI 模式 — list-providers', () => {
    it('应列出所有已知提供商并标记已配置状态', async () => {
      const session = createMockSession();
      const cmd = createSettingsCommand();

      await cmd.handler(['list-providers'], session);

      const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lines = (calls[0]?.[0] as string[]) ?? [];
      const output = lines.join('\n');

      expect(output).toContain('已知提供商:');
      expect(output).toContain('Anthropic');
      expect(output).toContain('DeepSeek');
      expect(output).toContain('OpenAI');
      expect(output).toContain('xAI');
      expect(output).toContain('Groq');
    });
  });

  describe('CLI 模式 — list-models', () => {
    it('无提供商参数时应显示用法提示', async () => {
      const session = createMockSession();
      const cmd = createSettingsCommand();

      await cmd.handler(['list-models'], session);

      const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lines = (calls[0]?.[0] as string[]) ?? [];
      const output = lines.join('\n');
      expect(output).toContain('用法');
    });

    it('提供商有模型时应列出模型', async () => {
      const session = createMockSession();
      const cmd = createSettingsCommand();

      await cmd.handler(['list-models', 'deepseek'], session);

      const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lines = (calls[0]?.[0] as string[]) ?? [];
      const output = lines.join('\n');
      expect(output).toContain('可用模型:');
      expect(output).toContain('deepseek-v4-flash');
    });

    it('提供商没有模型时应提示', async () => {
      const session = createMockSession();
      const cmd = createSettingsCommand();

      await cmd.handler(['list-models', 'nonexistent'], session);

      const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lines = (calls[0]?.[0] as string[]) ?? [];
      const output = lines.join('\n');
      expect(output).toContain('没有可用的模型列表');
    });
  });

  describe('CLI 模式 — 未知参数', () => {
    it('应显示用法说明', async () => {
      const session = createMockSession();
      const cmd = createSettingsCommand();

      await cmd.handler(['invalid-arg'], session);

      const calls = (session.appendOutput as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lines = (calls[0]?.[0] as string[]) ?? [];
      const output = lines.join('\n');
      expect(output).toContain('用法:');
    });
  });

  describe('交互模式 — 主菜单', () => {
    it('取消应退出交互菜单', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      cancelSelection(mockTui.capturedComponents[0] as Component);
      await handlerPromise;

      // handler completed without error
      expect(session.shutdown).not.toHaveBeenCalled();
    });

    it('q 应退出交互菜单', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      exitSelection(mockTui.capturedComponents[0] as Component);
      await handlerPromise;

      expect(session.shutdown).not.toHaveBeenCalled();
    });

    it('backspace 在主菜单应退出（无父级菜单）', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      backSelection(mockTui.capturedComponents[0] as Component);
      await handlerPromise;

      expect(session.shutdown).not.toHaveBeenCalled();
    });

    it('View Config 应显示配置并返回主菜单', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      // Select "View Config"
      selectItem(mockTui.capturedComponents[0] as Component, 'view-config');

      // Config view overlay should appear (not appendOutput)
      const configView = await waitForComponent(mockTui.capturedComponents, 1);
      expect(session.appendOutput).not.toHaveBeenCalled();

      // Dismiss config view (press q)
      configView.handleInput?.('q');

      // Main menu should re-appear
      await waitForComponent(mockTui.capturedComponents, 2);

      // Cancel to exit
      cancelSelection(mockTui.capturedComponents[2] as Component);
      await handlerPromise;
    });
  });

  describe('交互模式 — SelectListWithFooter 搜索', () => {
    it('按 / 应进入搜索模式', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      const menu = mockTui.capturedComponents[0] as unknown as {
        handleInput: (data: string) => void;
        isFiltering: boolean;
        onCancel?: () => void;
      };
      expect(menu.isFiltering).toBe(false);

      menu.handleInput('/');
      expect(menu.isFiltering).toBe(true);

      cancelSelection(mockTui.capturedComponents[0] as Component);
      await handlerPromise;
    });

    it('搜索模式下输入文字应过滤列表', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      const menu = mockTui.capturedComponents[0] as unknown as {
        handleInput: (data: string) => void;
        filterText: string;
        selectList: {
          items: Array<{ value: string }>;
          filteredItems: Array<{ value: string }>;
        };
        onCancel?: () => void;
      };

      // Enter filter mode and type characters
      menu.handleInput('/');
      menu.handleInput('m');
      expect(menu.filterText).toBe('m');
      menu.handleInput('a');
      expect(menu.filterText).toBe('ma');

      const filteredItems = menu.selectList.filteredItems;
      expect(filteredItems.length).toBeGreaterThan(0);
      expect(filteredItems.length).toBeLessThan(menu.selectList.items.length);
      for (const item of filteredItems) {
        expect(item.value.toLowerCase()).toContain('ma');
      }

      cancelSelection(mockTui.capturedComponents[0] as Component);
      await handlerPromise;
    });

    it('退格键应删除搜索文字中的字符', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      const menu = mockTui.capturedComponents[0] as unknown as {
        handleInput: (data: string) => void;
        filterText: string;
        isFiltering: boolean;
        onCancel?: () => void;
      };

      menu.handleInput('/');
      menu.handleInput('a');
      menu.handleInput('b');
      expect(menu.filterText).toBe('ab');

      // Backspace (DEL character)
      menu.handleInput('\x7f');
      expect(menu.filterText).toBe('a');

      cancelSelection(mockTui.capturedComponents[0] as Component);
      await handlerPromise;
    });

    it('Escape 应取消搜索并清除筛选', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      const menu = mockTui.capturedComponents[0] as unknown as {
        handleInput: (data: string) => void;
        filterText: string;
        isFiltering: boolean;
        onCancel?: () => void;
      };

      menu.handleInput('/');
      menu.handleInput('t');
      menu.handleInput('e');
      menu.handleInput('s');
      menu.handleInput('t');
      expect(menu.isFiltering).toBe(true);

      menu.handleInput('escape');
      expect(menu.isFiltering).toBe(false);
      expect(menu.filterText).toBe('');

      cancelSelection(mockTui.capturedComponents[0] as Component);
      await handlerPromise;
    });

    it('搜索模式下渲染应包含搜索栏', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      const menu = mockTui.capturedComponents[0] as unknown as {
        handleInput: (data: string) => void;
        filterText: string;
        render: (width: number) => string[];
        isFiltering: boolean;
        onCancel?: () => void;
      };

      // Enter filter mode and type
      menu.handleInput('/');
      menu.handleInput('t');
      menu.handleInput('e');
      menu.handleInput('s');
      menu.handleInput('t');

      // Render with filter — search bar should contain the typed text
      const linesAfter = menu.render(100);
      const searchBar = linesAfter.find((l) => l.includes('/test'));
      expect(searchBar).toBeDefined();

      cancelSelection(mockTui.capturedComponents[0] as Component);
      await handlerPromise;
    });

    it('Enter 在搜索模式下应退出搜索', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      const menu = mockTui.capturedComponents[0] as unknown as {
        handleInput: (data: string) => void;
        isFiltering: boolean;
        onCancel?: () => void;
      };

      menu.handleInput('/');
      menu.handleInput('a');
      expect(menu.isFiltering).toBe(true);

      menu.handleInput('enter');
      expect(menu.isFiltering).toBe(false);

      cancelSelection(mockTui.capturedComponents[0] as Component);
      await handlerPromise;
    });

    it('普通模式下 q 应触发退出', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      const menu = mockTui.capturedComponents[0] as unknown as {
        handleInput: (data: string) => void;
        onExit?: () => void;
      };

      let exitCalled = false;
      const origExit = menu.onExit;
      menu.onExit = () => {
        exitCalled = true;
        origExit?.();
      };

      menu.handleInput('q');
      expect(exitCalled).toBe(true);

      // cleanup: onCancel still works (not overridden), resolves the promise
      cancelSelection(mockTui.capturedComponents[0] as Component);
      await handlerPromise;
    });

    it('普通模式下 h 应触发返回', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      const menu = mockTui.capturedComponents[0] as unknown as {
        handleInput: (data: string) => void;
        onBack?: () => void;
        onCancel?: () => void;
      };

      let backCalled = false;
      menu.onBack = () => {
        backCalled = true;
      };

      menu.handleInput('h');
      expect(backCalled).toBe(true);

      cancelSelection(mockTui.capturedComponents[0] as Component);
      await handlerPromise;
    });

    it('普通模式下 backspace 应触发返回', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      const menu = mockTui.capturedComponents[0] as unknown as {
        handleInput: (data: string) => void;
        onBack?: () => void;
        onCancel?: () => void;
      };

      let backCalled = false;
      menu.onBack = () => {
        backCalled = true;
      };

      menu.handleInput('backspace');
      expect(backCalled).toBe(true);

      cancelSelection(mockTui.capturedComponents[0] as Component);
      await handlerPromise;
    });

    it('普通模式下 escape 应触发退出而非取消', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      const menu = mockTui.capturedComponents[0] as unknown as {
        handleInput: (data: string) => void;
        onExit?: () => void;
        onCancel?: () => void;
      };

      let exitCalled = false;
      let cancelCalled = false;
      const origExit = menu.onExit;
      const origCancel = menu.onCancel;
      menu.onExit = () => {
        exitCalled = true;
        origExit?.();
      };
      menu.onCancel = () => {
        cancelCalled = true;
        origCancel?.();
      };

      menu.handleInput('escape');
      expect(exitCalled).toBe(true);
      // Should NOT trigger onCancel — escape is now an exit key
      expect(cancelCalled).toBe(false);

      // cleanup: onCancel chains to original, resolves the promise
      cancelSelection(mockTui.capturedComponents[0] as Component);
      await handlerPromise;
    });
  });

  describe('交互模式 — Default Model 子菜单', () => {
    it('已启用模型应排在未启用模型之前', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      // Select "Default Model"
      selectItem(mockTui.capturedComponents[0] as Component, 'default-model');

      // Wait for model list to appear
      await waitForComponent(mockTui.capturedComponents, 1);

      const modelComponent = mockTui.capturedComponents[1] as unknown as {
        selectList: {
          items: Array<{ value: string; description: string }>;
        };
      };

      const items = modelComponent.selectList.items;
      expect(items.length).toBeGreaterThan(0);

      // Find indices of first enabled and first disabled items
      // Enabled items have empty description (not chalk.gray)
      const firstEnabledIdx = items.findIndex(
        (item) => !item.description || item.description === ''
      );
      const firstDisabledIdx = items.findIndex(
        (item) => item.description && item.description.includes('未配置')
      );

      // Enabled items should come before disabled (if both exist)
      if (firstDisabledIdx >= 0 && firstEnabledIdx >= 0) {
        expect(firstEnabledIdx).toBeLessThan(firstDisabledIdx);
      }

      // Cancel back to main menu
      cancelSelection(mockTui.capturedComponents[1] as Component);

      // Cancel main menu to exit
      await waitForComponent(mockTui.capturedComponents, 2);
      cancelSelection(mockTui.capturedComponents[2] as Component);
      await handlerPromise;
    });

    it('选择视觉模型后应写入 llm.visionModel', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      // Select "视觉模型"
      selectItem(mockTui.capturedComponents[0] as Component, 'vision-model');

      // Wait for model list to appear
      await waitForComponent(mockTui.capturedComponents, 1);

      // Select a model
      selectItem(mockTui.capturedComponents[1] as Component, 'deepseek/deepseek-chat');

      // Wait for main menu to re-render
      await waitForComponent(mockTui.capturedComponents, 2);

      // Verify llm.visionModel was written
      const finalConfig = session.config as Record<string, unknown>;
      const llm = finalConfig.llm as Record<string, unknown>;
      expect(llm.visionModel).toBe('deepseek/deepseek-chat');

      cancelSelection(mockTui.capturedComponents[2] as Component);
      await handlerPromise;
    });

    it('选择轻量模型后应写入 llm.lightModel', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      // Select "轻量模型"
      selectItem(mockTui.capturedComponents[0] as Component, 'light-model');

      // Wait for model list to appear
      await waitForComponent(mockTui.capturedComponents, 1);

      // Select a model
      selectItem(mockTui.capturedComponents[1] as Component, 'deepseek/deepseek-chat');

      // Wait for main menu to re-render
      await waitForComponent(mockTui.capturedComponents, 2);

      // Verify llm.lightModel was written
      const finalConfig = session.config as Record<string, unknown>;
      const llm = finalConfig.llm as Record<string, unknown>;
      expect(llm.lightModel).toBe('deepseek/deepseek-chat');

      cancelSelection(mockTui.capturedComponents[2] as Component);
      await handlerPromise;
    });

    it('选择分析模型后应写入 llm.analysisModel', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      // Select "分析模型"
      selectItem(mockTui.capturedComponents[0] as Component, 'analysis-model');

      // Wait for model list to appear
      await waitForComponent(mockTui.capturedComponents, 1);

      // Select a model
      selectItem(mockTui.capturedComponents[1] as Component, 'deepseek/deepseek-chat');

      // Wait for main menu to re-render
      await waitForComponent(mockTui.capturedComponents, 2);

      // Verify llm.analysisModel was written
      const finalConfig = session.config as Record<string, unknown>;
      const llm = finalConfig.llm as Record<string, unknown>;
      expect(llm.analysisModel).toBe('deepseek/deepseek-chat');

      cancelSelection(mockTui.capturedComponents[2] as Component);
      await handlerPromise;
    });

    it('vision-model / light-model / analysis-model 入口显示在菜单中', async () => {
      const mockTui = createMockTui();
      const session = createMockSession(mockTui);
      const cmd = createSettingsCommand();

      const handlerPromise = cmd.handler([], session);
      await waitForComponent(mockTui.capturedComponents, 0);

      // Extract the main menu items
      const mainMenuComponent = mockTui.capturedComponents[0] as unknown as {
        selectList: {
          items: Array<{ value: string }>;
        };
      };
      const values = mainMenuComponent.selectList.items.map((item) => item.value);

      // All four model slots should be present
      expect(values).toContain('default-model');
      expect(values).toContain('vision-model');
      expect(values).toContain('light-model');
      expect(values).toContain('analysis-model');

      // Order: model slots should come before manage-providers
      const defaultIdx = values.indexOf('default-model');
      const visionIdx = values.indexOf('vision-model');
      const lightIdx = values.indexOf('light-model');
      const analysisIdx = values.indexOf('analysis-model');
      const manageIdx = values.indexOf('manage-providers');

      expect(defaultIdx).toBeLessThan(manageIdx);
      expect(visionIdx).toBeLessThan(manageIdx);
      expect(lightIdx).toBeLessThan(manageIdx);
      expect(analysisIdx).toBeLessThan(manageIdx);

      cancelSelection(mockTui.capturedComponents[0] as Component);
      await handlerPromise;
    });
  });
});
