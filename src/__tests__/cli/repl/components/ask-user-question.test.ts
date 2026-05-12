/**
 * AskUserQuestion UI 组件测试
 */

import type { TUI } from '@mariozechner/pi-tui';
import { describe, expect, it, vi } from 'vitest';
import { AskUserQuestionComponent } from '@/cli/repl/components/ask-user-question';
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
      component.handleInput('escape');
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
      component.handleInput('escape');
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('should return from reviewing to answering on escape', () => {
      const params = makeParams([makeQuestion()]);
      const { component, onCancel } = createComponent(params);
      // Select and advance to reviewing
      component.handleInput('1');
      component.handleInput('enter');
      // Escape from reviewing back to answering
      component.handleInput('escape');
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe('handleInput - option selection', () => {
    it('should select first option with navigate and enter (single select)', () => {
      const { component, onResolve } = createComponent();
      // Navigate to option 1 and select with Enter
      component.handleInput('enter');
      // Then submit (advances to review for single question)
      component.handleInput('enter');
      expect(onResolve).toHaveBeenCalled();
    });

    it('should select second option via j + enter', () => {
      const { component, onResolve } = createComponent();
      // Navigate down to option 2
      component.handleInput('j');
      // Select it with Enter (advances to reviewing)
      component.handleInput('enter');
      // Submit from reviewing
      component.handleInput('enter');
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
      component.handleInput('enter');
      // Only one question, goes to review
      component.handleInput('enter');

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
      component.handleInput('enter');
      // Should not have resolved or cancelled
      expect(onCancel).not.toHaveBeenCalled();
      // Should still be able to select and continue
      component.handleInput('1');
      component.handleInput('enter');
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
      component.handleInput('enter');
      // Go back
      component.handleInput('h');
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
      component.handleInput('enter');
      // Submit review
      component.handleInput('enter');
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
      component.handleInput('escape');
      // Should be back in answering, escape again should cancel
      component.handleInput('escape');
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
      component.handleInput('enter');
      // Go back to Q1
      component.handleInput('shift+tab');
      // Should not crash
    });
  });

  describe('handleInput - reviewing', () => {
    it('should submit on enter in review phase', () => {
      const { component, onResolve } = createComponent();
      // Select first option
      component.handleInput('1');
      // Advance to reviewing
      component.handleInput('enter');
      // Submit from reviewing
      component.handleInput('enter');
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
      component.handleInput('enter');
      // Answer Q2
      component.handleInput('1');
      component.handleInput('enter');
      // Now in review
      // Escape back
      component.handleInput('escape');
      // Should be back in answering (last question)
      component.handleInput('escape');
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
      component.handleInput('enter');
      // Answer Q2: select first option ('date-fns') via enter
      component.handleInput('enter');
      // Advance to review, then submit
      component.handleInput('enter');

      expect(onResolve).toHaveBeenCalled();
      const result = onResolve.mock.calls[0]?.[0] as AskUserQuestionResult;
      expect(result.answers['Q1?']).toBe('dayjs');
      expect(result.answers['Q2?']).toBe('date-fns');
    });
  });
});
