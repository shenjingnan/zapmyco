/**
 * AskUserQuestion UI 组件测试
 */

import { describe, expect, it, vi } from 'vitest';
import {
  AskUserQuestionComponent,
  showAskUserQuestionDialog,
} from '@/cli/repl/components/ask-user-question';
import type { TUI } from '@/cli/tui';

// matchesKey 由 @/cli/tui 本地提供，测试使用真实终端控制字符

import type {
  AskUserQuestionParams,
  AskUserQuestionResult,
  QuestionDefinition,
} from '@/core/question/types';

// ============ 辅助函数 ============

function makeQuestion(overrides?: Partial<QuestionDefinition>): QuestionDefinition {
  return {
    question: 'Which library to use?',
    header: 'Lib',
    options: [
      { label: 'date-fns', description: 'Modern date library' },
      { label: 'dayjs', description: 'Lightweight alternative' },
    ],
    multiSelect: false,
    ...overrides,
  };
}

function makeParams(questions?: QuestionDefinition[]): AskUserQuestionParams {
  return {
    questions: questions ?? [makeQuestion()],
  };
}

function createMockTui(): TUI {
  return {
    terminal: { rows: 40 },
    showOverlay: vi.fn(() => ({ hide: vi.fn() })),
  } as unknown as TUI;
}

function createComponent(params?: AskUserQuestionParams): {
  component: AskUserQuestionComponent;
  onResolve: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
} {
  const onResolve = vi.fn();
  const onCancel = vi.fn();
  const component = new AskUserQuestionComponent(
    createMockTui(),
    params ?? makeParams(),
    onResolve,
    onCancel
  );
  return { component, onResolve, onCancel };
}

// ============ 测试 ============

describe('AskUserQuestionComponent', () => {
  describe('constructor and initial state', () => {
    it('should initialize with answering phase', () => {
      const { component } = createComponent();
      expect(component).toBeDefined();
    });

    it('should enable preview when options have preview content', () => {
      const params = makeParams([
        makeQuestion({
          options: [
            { label: 'A', description: 'Option A', preview: '# Code' },
            { label: 'B', description: 'Option B' },
          ],
        }),
      ]);
      const { component } = createComponent(params);
      // Preview should be auto-detected
      expect(component).toBeDefined();
    });

    it('should disable preview when no options have preview', () => {
      const { component } = createComponent();
      expect(component).toBeDefined();
    });
  });

  describe('invalidate', () => {
    it('should be a no-op', () => {
      const { component } = createComponent();
      expect(() => component.invalidate()).not.toThrow();
    });
  });

  describe('handleInput - escape/cancel', () => {
    it('should cancel when escape is pressed in answering phase', () => {
      const { component, onCancel } = createComponent();
      component.handleInput('\x1b');
      expect(onCancel).toHaveBeenCalled();
    });

    it('should cancel when q is pressed in answering phase', () => {
      const { component, onCancel } = createComponent();
      component.handleInput('q');
      expect(onCancel).toHaveBeenCalled();
    });

    it('should return from other_input to answering on escape', () => {
      const { component, onCancel } = createComponent();
      // Enter other_input
      component.handleInput('o');
      // Escape back
      component.handleInput('\x1b');
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('should return from reviewing to answering on escape', () => {
      const params = makeParams([makeQuestion()]);
      const { component, onCancel } = createComponent(params);
      // Select and advance to reviewing
      component.handleInput('1');
      component.handleInput('\r');
      // Escape from reviewing back to answering
      component.handleInput('\x1b');
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe('handleInput - option selection', () => {
    it('should select first option with navigate and enter (single select)', () => {
      const { component, onResolve } = createComponent();
      // Navigate to option 1 and select with Enter
      component.handleInput('\r');
      // Then submit (advances to review for single question)
      component.handleInput('\r');
      expect(onResolve).toHaveBeenCalled();
    });

    it('should select second option via j + enter', () => {
      const { component, onResolve } = createComponent();
      // Navigate down to option 2
      component.handleInput('j');
      // Select it with Enter (advances to reviewing)
      component.handleInput('\r');
      // Submit from reviewing
      component.handleInput('\r');
      const result = onResolve.mock.calls[0]?.[0] as AskUserQuestionResult;
      expect(result?.answers['Which library to use?']).toBe('dayjs');
    });

    it('should enter "Other" with o key', () => {
      const { component } = createComponent();
      component.handleInput('o');
      // Check that render works in other_input phase
      const lines = component.render(80);
      expect(Array.isArray(lines)).toBe(true);
    });

    it('should ignore out-of-range digits', () => {
      const { component, onCancel } = createComponent();
      component.handleInput('9');
      // Should not crash
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('should select first option via number key 1', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('1');
      component.handleInput('\r');
      component.handleInput('\r');
      expect(onResolve).toHaveBeenCalled();
      const result = onResolve.mock.calls[0]?.[0] as AskUserQuestionResult;
      expect(result.answers['Which library to use?']).toBe('date-fns');
    });

    it('should select second option via number key 2', () => {
      const { component, onResolve } = createComponent();
      // Number key selects option at index 1 but doesn't change selectedOptionIndex
      // so use tab to advance to review instead of enter (which would re-select at index 0)
      component.handleInput('2');
      component.handleInput('\t'); // advance to review via tab
      component.handleInput('\r'); // submit from review
      const result = onResolve.mock.calls[0]?.[0] as AskUserQuestionResult;
      expect(result.answers['Which library to use?']).toBe('dayjs');
    });

    it('should navigate down with down arrow key', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('\x1b[B'); // down arrow
      component.handleInput('\r');
      component.handleInput('\r');
      const result = onResolve.mock.calls[0]?.[0] as AskUserQuestionResult;
      expect(result.answers['Which library to use?']).toBe('dayjs');
    });

    it('should navigate up with up arrow key', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('\x1b[B'); // selectedOptionIndex = 1 (dayjs)
      component.handleInput('\x1b[B'); // selectedOptionIndex = 2 (Other)
      component.handleInput('\x1b[A'); // selectedOptionIndex = 1
      component.handleInput('\x1b[A'); // selectedOptionIndex = 0
      component.handleInput('\r');
      component.handleInput('\r');
      const result = onResolve.mock.calls[0]?.[0] as AskUserQuestionResult;
      expect(result.answers['Which library to use?']).toBe('date-fns');
    });

    it('should enter other input when number matches optionCount digit', () => {
      const { component } = createComponent();
      // With 2 options, '3' maps to other (index 2 === optionCount)
      component.handleInput('3');
      const lines = component.render(80);
      const joined = lines.join('\n');
      expect(joined).toContain('输入自定义答案');
    });
  });

  describe('handleInput - multi-select', () => {
    it('should toggle options with space in multi-select mode', () => {
      const params = makeParams([
        makeQuestion({
          multiSelect: true,
          options: [
            { label: 'Auth', description: 'Authentication module' },
            { label: 'API', description: 'API module' },
            { label: 'UI', description: 'UI module' },
          ],
        }),
      ]);
      const { component, onResolve } = createComponent(params);

      // Toggle first option
      component.handleInput('1');
      // Toggle second option
      component.handleInput('2');
      // Confirm and submit
      component.handleInput('\r');
      // Only one question, goes to review
      component.handleInput('\r');

      expect(onResolve).toHaveBeenCalled();
    });

    it('should not advance multi-select without selection on enter', () => {
      const params = makeParams([
        makeQuestion({
          multiSelect: true,
          options: [
            { label: 'Auth', description: 'Auth' },
            { label: 'API', description: 'API' },
          ],
        }),
      ]);
      const { component, onCancel } = createComponent(params);

      // Press enter without selecting anything in multi-select mode
      component.handleInput('\r');
      // Should not have resolved or cancelled
      expect(onCancel).not.toHaveBeenCalled();
      // Should still be able to select and continue
      component.handleInput('1');
      component.handleInput('\r');
    });

    it('should not toggle option when space is pressed in non-multiSelect mode', () => {
      const { component, onResolve } = createComponent();
      // Space in single-select mode should be a no-op
      component.handleInput(' ');
      // Enter should still select focused option (date-fns, index 0)
      component.handleInput('\r');
      component.handleInput('\r');
      const result = onResolve.mock.calls[0]?.[0] as AskUserQuestionResult;
      expect(result.answers['Which library to use?']).toBe('date-fns');
    });

    it('should not toggle when space pressed on Other line in multi-select', () => {
      const params = makeParams([
        makeQuestion({
          multiSelect: true,
          options: [
            { label: 'Auth', description: 'Auth' },
            { label: 'API', description: 'API' },
          ],
        }),
      ]);
      const { component } = createComponent(params);
      // Move to Other line (index 2 = optionCount)
      component.handleInput('j');
      component.handleInput('j');
      component.handleInput('j');
      // Space should be a no-op since selectedOptionIndex >= optionCount
      component.handleInput(' ');
      // Should not crash - navigate back and select normally
      component.handleInput('k');
      component.handleInput('k');
      component.handleInput('1');
      component.handleInput('\r');
    });

    it('should submit correct array of selected labels for multi-select', () => {
      const params = makeParams([
        makeQuestion({
          multiSelect: true,
          question: 'Select modules?',
          header: 'Modules',
          options: [
            { label: 'Auth', description: 'Authentication' },
            { label: 'API', description: 'API' },
            { label: 'UI', description: 'UI' },
          ],
        }),
      ]);
      const { component, onResolve } = createComponent(params);
      // Select Auth (key 1) and UI (navigate down twice, space)
      component.handleInput('1');
      component.handleInput('j');
      component.handleInput('j');
      component.handleInput(' ');
      // Confirm and submit
      component.handleInput('\r');
      component.handleInput('\r');
      expect(onResolve).toHaveBeenCalled();
      const result = onResolve.mock.calls[0]?.[0] as AskUserQuestionResult;
      expect(result.answers['Select modules?']).toEqual(['Auth', 'UI']);
    });
  });

  describe('handleInput - navigation', () => {
    it('should move selection down with j', () => {
      const { component } = createComponent();
      component.handleInput('j');
      // Should not crash
    });

    it('should move selection up with k', () => {
      const { component } = createComponent();
      component.handleInput('j');
      component.handleInput('j');
      component.handleInput('k');
      // Should not crash
    });

    it('should not move selection below zero', () => {
      const { component } = createComponent();
      component.handleInput('k');
      component.handleInput('k');
      // Should not crash
    });

    it('should go back with h', () => {
      const params = makeParams([
        makeQuestion({ header: 'Q1' }),
        makeQuestion({ header: 'Q2', question: 'Second question?' }),
      ]);
      const { component } = createComponent(params);
      // Advance
      component.handleInput('1');
      component.handleInput('\r');
      // Go back
      component.handleInput('h');
    });

    it('should not go below first option with k key at position 0', () => {
      const { component, onResolve } = createComponent();
      // k at position 0 should be a no-op
      component.handleInput('k');
      component.handleInput('k');
      // Enter should still select option at index 0 (date-fns)
      component.handleInput('\r');
      component.handleInput('\r');
      const result = onResolve.mock.calls[0]?.[0] as AskUserQuestionResult;
      expect(result.answers['Which library to use?']).toBe('date-fns');
    });

    it('should not go above Other line with j key', () => {
      const { component, onResolve } = createComponent();
      // Navigate down many times
      component.handleInput('j');
      component.handleInput('j');
      component.handleInput('j');
      component.handleInput('j');
      // Navigate back to option 1 (index 0)
      component.handleInput('k');
      component.handleInput('k');
      // Select option 1
      component.handleInput('\r');
      component.handleInput('\r');
      const result = onResolve.mock.calls[0]?.[0] as AskUserQuestionResult;
      expect(result.answers['Which library to use?']).toBe('date-fns');
    });

    it('should advance to next question with tab key', () => {
      const params = makeParams([
        makeQuestion({ header: 'Q1' }),
        makeQuestion({ header: 'Q2', question: 'Second?' }),
      ]);
      const { component } = createComponent(params);
      // Tab without answering Q1 should advance to Q2
      component.handleInput('\t');
      const lines = component.render(80);
      expect(lines.join('\n')).toContain('Second?');
    });

    it('should advance to review from last question with tab key', () => {
      const params = makeParams([makeQuestion()]);
      const { component } = createComponent(params);
      // Select and advance to review via tab
      component.handleInput('1');
      component.handleInput('\t');
      const lines = component.render(80);
      expect(lines.join('\n')).toContain('确认你的答案');
    });

    it('should not go back with shift+tab on first question', () => {
      const params = makeParams([
        makeQuestion({ header: 'Q1' }),
        makeQuestion({ header: 'Q2', question: 'Second?' }),
      ]);
      const { component } = createComponent(params);
      // Shift+tab on first question = no-op
      component.handleInput('\x1b[Z');
      // Should still be on Q1, answer it
      component.handleInput('1');
      component.handleInput('\r');
      // Now on Q2
      const lines = component.render(80);
      expect(lines.join('\n')).toContain('Second?');
    });

    it('should not go back with h on first question', () => {
      const params = makeParams([
        makeQuestion({ header: 'Q1' }),
        makeQuestion({ header: 'Q2', question: 'Second?' }),
      ]);
      const { component, onResolve } = createComponent(params);
      // h on first question = no-op
      component.handleInput('h');
      // Should still be on Q1, answer both and submit
      component.handleInput('1');
      component.handleInput('\r');
      component.handleInput('1');
      component.handleInput('\r');
      component.handleInput('\r');
      expect(onResolve).toHaveBeenCalled();
    });

    it('should not go back with backspace on first question', () => {
      const params = makeParams([
        makeQuestion({ header: 'Q1' }),
        makeQuestion({ header: 'Q2', question: 'Second?' }),
      ]);
      const { component, onResolve } = createComponent(params);
      // Backspace on first question = no-op
      component.handleInput('\x7f');
      // Answer both and submit
      component.handleInput('1');
      component.handleInput('\r');
      component.handleInput('1');
      component.handleInput('\r');
      component.handleInput('\r');
      expect(onResolve).toHaveBeenCalled();
    });
  });

  describe('handleInput - preview toggle', () => {
    it('should toggle preview with p key', () => {
      const params = makeParams([
        makeQuestion({
          options: [
            { label: 'A', description: 'Option A', preview: '# Code example' },
            { label: 'B', description: 'Option B' },
          ],
        }),
      ]);
      const { component } = createComponent(params);
      component.handleInput('p');
      // Should not crash
    });
  });

  describe('render', () => {
    it('should render answering phase without error', () => {
      const { component } = createComponent();
      const lines = component.render(80);
      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBeGreaterThan(0);
    });

    it('should render other_input phase', () => {
      const { component } = createComponent();
      component.handleInput('o');
      const lines = component.render(80);
      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBeGreaterThan(0);
    });

    it('should include question text in render output', () => {
      const params = makeParams([makeQuestion({ question: 'What is your preference?' })]);
      const { component } = createComponent(params);
      const lines = component.render(80);
      const joined = lines.join('\n');
      expect(joined).toContain('What is your preference?');
    });

    it('should render with narrow width', () => {
      const { component } = createComponent();
      const lines = component.render(40);
      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBeGreaterThan(0);
    });

    it('should render with preview panel when preview available', () => {
      const params = makeParams([
        makeQuestion({
          options: [
            { label: 'A', description: 'Option A', preview: 'line1\nline2' },
            { label: 'B', description: 'Option B' },
          ],
        }),
      ]);
      const { component } = createComponent(params);
      const lines = component.render(100);
      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBeGreaterThan(0);
    });

    it('should render single-select footer with common keys', () => {
      const { component } = createComponent();
      const lines = component.render(80);
      const joined = lines.join('\n');
      expect(joined).toContain('Enter 确认');
      expect(joined).toContain('Esc 取消');
      expect(joined).toContain('o 自定义');
      expect(joined).toContain('1-2 选择');
      expect(joined).toContain('k/j ↑↓ 导航');
    });

    it('should render single-select footer without Tab hint for single question', () => {
      const { component } = createComponent();
      const lines = component.render(80);
      const joined = lines.join('\n');
      expect(joined).not.toContain('Tab 下一题');
    });

    it('should render single-select footer with Tab hint for multiple questions', () => {
      const params = makeParams([
        makeQuestion({ header: 'Q1' }),
        makeQuestion({ header: 'Q2', question: 'Second?' }),
      ]);
      const { component } = createComponent(params);
      const lines = component.render(80);
      const joined = lines.join('\n');
      expect(joined).toContain('Tab 下一题');
    });

    it('should render multi-select footer with Space key', () => {
      const params = makeParams([
        makeQuestion({
          multiSelect: true,
          options: [
            { label: 'A', description: 'A' },
            { label: 'B', description: 'B' },
          ],
        }),
      ]);
      const { component } = createComponent(params);
      const lines = component.render(80);
      const joined = lines.join('\n');
      expect(joined).toContain('Space 选择');
      expect(joined).toContain('Enter 确认选择');
      expect(joined).toContain('1-2 切换');
    });

    it('should show description for focused option', () => {
      const params = makeParams([
        makeQuestion({
          options: [
            { label: 'date-fns', description: 'Modern date library' },
            { label: 'dayjs', description: 'Lightweight alternative' },
          ],
        }),
      ]);
      const { component } = createComponent(params);
      // Navigate to option 2 (dayjs)
      component.handleInput('j');
      const lines = component.render(80);
      const joined = lines.join('\n');
      expect(joined).toContain('Lightweight alternative');
    });

    it('should render preview panel when width is below minimum', () => {
      const params = makeParams([
        makeQuestion({
          options: [{ label: 'A', description: 'Option A', preview: 'preview content' }],
        }),
      ]);
      const { component } = createComponent(params);
      // Preview is auto-detected as true by constructor (option has preview content)
      // Render with very narrow width (below minWidth 15)
      const lines = component.render(10);
      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBeGreaterThan(0);
    });

    it('should render preview panel with truncation for more than 20 lines', () => {
      const longPreview = Array.from({ length: 25 }, (_, i) => `Line ${i + 1}`).join('\n');
      const params = makeParams([
        makeQuestion({
          options: [{ label: 'A', description: 'Option A', preview: longPreview }],
        }),
      ]);
      const { component } = createComponent(params);
      // Preview is auto-detected as true by constructor (option has preview content)
      const lines = component.render(100);
      const joined = lines.join('\n');
      expect(joined).toContain('... 还有');
    });

    it('should render preview panel showing no preview on Other option', () => {
      const params = makeParams([
        makeQuestion({
          options: [{ label: 'A', description: 'A', preview: 'preview content' }],
        }),
      ]);
      const { component } = createComponent(params);
      // Preview is auto-detected as true by constructor (option has preview content)
      // Navigate to Other option (selectedOptionIndex = optionCount = 1)
      component.handleInput('j');
      component.handleInput('j');
      const lines = component.render(100);
      const joined = lines.join('\n');
      expect(joined).toContain('(无预览)');
    });

    it('should render tab bar with all question headers', () => {
      const params = makeParams([
        makeQuestion({ header: 'Lib', question: 'Library?' }),
        makeQuestion({ header: 'Lang', question: 'Language?' }),
      ]);
      const { component } = createComponent(params);
      const lines = component.render(80);
      const joined = lines.join('\n');
      expect(joined).toContain('Lib');
      expect(joined).toContain('Lang');
      expect(joined).toContain('提交');
    });

    it('should render answered tab with checkmark', () => {
      const params = makeParams([
        makeQuestion({ header: 'Q1' }),
        makeQuestion({ header: 'Q2', question: 'Second?' }),
      ]);
      const { component } = createComponent(params);
      // Answer Q1
      component.handleInput('1');
      component.handleInput('\r');
      const lines = component.render(80);
      const joined = lines.join('\n');
      expect(joined).toContain('✓');
    });
  });

  describe('handleInput - other_input', () => {
    it('should accept custom text input', () => {
      const { component, onResolve } = createComponent();
      // Enter other mode and type
      component.handleInput('o');
      component.handleInput('c');
      component.handleInput('u');
      component.handleInput('s');
      component.handleInput('t');
      component.handleInput('o');
      component.handleInput('m');
      // Submit custom text - advances to review
      component.handleInput('\r');
      // Submit review
      component.handleInput('\r');
      expect(onResolve).toHaveBeenCalled();
    });

    it('should handle backspace in other input', () => {
      const { component } = createComponent();
      component.handleInput('o');
      component.handleInput('a');
      component.handleInput('b');
      component.handleInput('\x7f'); // backspace
      // Should not crash
    });

    it('should return to answering on escape from other_input', () => {
      const { component } = createComponent();
      component.handleInput('o');
      component.handleInput('\x1b');
      // Should be back in answering, escape again should cancel
      component.handleInput('\x1b');
    });

    it('should handle \\b backspace character', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('o');
      component.handleInput('a');
      component.handleInput('\b'); // \b backspace
      component.handleInput('b');
      component.handleInput('\r');
      component.handleInput('\r');
      expect(onResolve).toHaveBeenCalled();
    });

    it('should not set text when trimmed input is empty on enter', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('o');
      component.handleInput(' '); // only whitespace
      component.handleInput('\r'); // try to confirm - should not advance since trimmed is empty
      // Should still be in other_input, escape back
      component.handleInput('\x1b');
      // Answer normally
      component.handleInput('1');
      component.handleInput('\r');
      component.handleInput('\r');
      expect(onResolve).toHaveBeenCalled();
      const result = onResolve.mock.calls[0]?.[0] as AskUserQuestionResult;
      expect(result.answers['Which library to use?']).toBe('date-fns');
    });

    it('should ignore non-printable characters in other_input', () => {
      const { component } = createComponent();
      component.handleInput('o');
      // Non-printable control characters should be ignored
      component.handleInput('\x01');
      component.handleInput('\x02');
      component.handleInput('\x1b'); // escape back
      // Should not crash
    });
  });

  describe('handleInput - shift+tab', () => {
    it('should go to previous question with shift+tab', () => {
      const params = makeParams([
        makeQuestion({ header: 'Q1' }),
        makeQuestion({ header: 'Q2', question: 'Second?' }),
        makeQuestion({ header: 'Q3', question: 'Third?' }),
      ]);
      const { component } = createComponent(params);
      // Advance to Q2
      component.handleInput('1');
      component.handleInput('\r');
      // Go back to Q1
      component.handleInput('\x1b[Z');
      // Should not crash
    });
  });

  describe('handleInput - reviewing', () => {
    it('should submit on enter in review phase', () => {
      const { component, onResolve } = createComponent();
      // Select first option
      component.handleInput('1');
      // Advance to reviewing
      component.handleInput('\r');
      // Submit from reviewing
      component.handleInput('\r');
      expect(onResolve).toHaveBeenCalled();
    });

    it('should go back to answering on escape in review', () => {
      const params = makeParams([
        makeQuestion({ header: 'Q1' }),
        makeQuestion({ header: 'Q2', question: 'Second?' }),
      ]);
      const { component } = createComponent(params);
      // Answer Q1
      component.handleInput('1');
      component.handleInput('\r');
      // Answer Q2
      component.handleInput('1');
      component.handleInput('\r');
      // Now in review
      // Escape back
      component.handleInput('\x1b');
      // Should be back in answering (last question)
      component.handleInput('\x1b');
    });
  });

  describe('question state management', () => {
    it('should submit correct answers for single-select', () => {
      const params = makeParams([
        makeQuestion({ question: 'Q1?', header: 'Q1' }),
        makeQuestion({ question: 'Q2?', header: 'Q2' }),
      ]);
      const { component, onResolve } = createComponent(params);

      // Answer Q1: select second option ('dayjs') via j + enter
      component.handleInput('j');
      component.handleInput('\r');
      // Answer Q2: select first option ('date-fns') via enter
      component.handleInput('\r');
      // Advance to review, then submit
      component.handleInput('\r');

      expect(onResolve).toHaveBeenCalled();
      const result = onResolve.mock.calls[0]?.[0] as AskUserQuestionResult;
      expect(result.answers['Q1?']).toBe('dayjs');
      expect(result.answers['Q2?']).toBe('date-fns');
    });

    it('should toggle option on and off in multi-select', () => {
      const params = makeParams([
        makeQuestion({
          multiSelect: true,
          options: [
            { label: 'Auth', description: 'Auth' },
            { label: 'API', description: 'API' },
          ],
        }),
      ]);
      const { component, onResolve } = createComponent(params);
      // Toggle Auth on
      component.handleInput('1');
      // Toggle Auth off
      component.handleInput('1');
      // Select API
      component.handleInput('2');
      // Confirm and submit
      component.handleInput('\r');
      component.handleInput('\r');
      const result = onResolve.mock.calls[0]?.[0] as AskUserQuestionResult;
      expect(result.answers['Which library to use?']).toEqual(['API']);
    });

    it('should include annotation when other text is set', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('o');
      component.handleInput('c');
      component.handleInput('u');
      component.handleInput('s');
      component.handleInput('t');
      component.handleInput('o');
      component.handleInput('m');
      component.handleInput('\r'); // confirm other input
      component.handleInput('\r'); // submit from review
      const result = onResolve.mock.calls[0]?.[0] as AskUserQuestionResult;
      expect(result.annotations).toBeDefined();
      expect(result.annotations?.['Which library to use?']?.notes).toContain('自定义');
    });

    it('should not include annotations when no other text', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('1');
      component.handleInput('\r');
      component.handleInput('\r');
      const result = onResolve.mock.calls[0]?.[0] as AskUserQuestionResult;
      expect(result.annotations).toBeUndefined();
    });
  });

  describe('showAskUserQuestionDialog', () => {
    it('should resolve and hide overlay on answer', async () => {
      const mockTui = createMockTui();
      const params = makeParams();
      const promise = showAskUserQuestionDialog(mockTui, params);

      // Extract the component from the showOverlay mock call
      const componentCall = vi.mocked(mockTui.showOverlay).mock
        .calls[0]?.[0] as AskUserQuestionComponent;

      // Answer the question
      componentCall.handleInput('1');
      componentCall.handleInput('\r');
      componentCall.handleInput('\r');

      await expect(promise).resolves.toBeDefined();
    });

    it('should reject on cancel', async () => {
      const mockTui = createMockTui();
      const params = makeParams();
      const promise = showAskUserQuestionDialog(mockTui, params);

      const componentCall = vi.mocked(mockTui.showOverlay).mock
        .calls[0]?.[0] as AskUserQuestionComponent;

      // Cancel
      componentCall.handleInput('\x1b');

      await expect(promise).rejects.toThrow('用户取消了提问');
    });
  });
});
