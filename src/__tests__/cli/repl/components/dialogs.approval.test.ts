/**
 * 安全审批对话框组件测试
 */

import { describe, expect, it, vi } from 'vitest';
import { ApprovalDialogComponentForTesting } from '@/cli/repl/components/dialogs';
import type { ApprovalRequest } from '@/security/types';

// Mock matchesKey — 在测试中使用解析后的键名（如 'escape', 'enter'）进行比较
vi.mock('@mariozechner/pi-tui', async (importOriginal) => {
  const actual = await importOriginal();
  return Object.assign({}, actual, {
    matchesKey: vi.fn((data: string, key: string) => data === key),
  });
});

// ============ 辅助函数 ============

function makeApprovalRequest(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    toolId: 'Skill',
    toolLabel: '技能调用',
    params: { skill: 'commit-push-pr' },
    risk: 'medium',
    reason: '需要审批',
    sessionId: 'test-session',
    ...overrides,
  };
}

function createComponent(request?: ApprovalRequest): {
  component: ApprovalDialogComponentForTesting;
  onResolve: ReturnType<typeof vi.fn>;
} {
  const onResolve = vi.fn();
  const component = new ApprovalDialogComponentForTesting(
    request ?? makeApprovalRequest(),
    onResolve
  );
  return { component, onResolve };
}

// ============ 测试 ============

describe('ApprovalDialogComponent', () => {
  describe('constructor and initial state', () => {
    it('should initialize without error', () => {
      const { component } = createComponent();
      expect(component).toBeDefined();
    });
  });

  describe('render', () => {
    it('should render without error at normal width', () => {
      const { component } = createComponent();
      const lines = component.render(80);
      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBeGreaterThan(0);
    });

    it('should render title with toolId and param value', () => {
      const { component } = createComponent();
      const lines = component.render(80);
      const joined = lines.join('\n');
      expect(joined).toContain('Skill');
      expect(joined).toContain('commit-push-pr');
    });

    it('should render all three options', () => {
      const { component } = createComponent();
      const lines = component.render(80);
      const joined = lines.join('\n');
      expect(joined).toContain('允许本次');
      expect(joined).toContain('本次会话始终允许');
      expect(joined).toContain('拒绝');
    });

    it('should render footer at wide width', () => {
      const { component } = createComponent();
      const lines = component.render(80);
      const joined = lines.join('\n');
      expect(joined).toContain('Esc 取消');
      expect(joined).toContain('Tab 切换');
    });

    it('should render minimal footer at narrow width', () => {
      const { component } = createComponent();
      const lines = component.render(30);
      const joined = lines.join('\n');
      expect(joined).toContain('Esc 取消');
      expect(joined).not.toContain('Tab 切换');
    });

    it('should render with empty params', () => {
      const request = makeApprovalRequest({ params: {} });
      const { component } = createComponent(request);
      const lines = component.render(80);
      const joined = lines.join('\n');
      // Should still render the toolId without parentheses
      expect(joined).toContain('Skill');
      expect(joined).not.toContain('()');
    });

    it('should truncate long param values', () => {
      const longStr = 'a'.repeat(100);
      const request = makeApprovalRequest({ params: { data: longStr } });
      const { component } = createComponent(request);
      const lines = component.render(80);
      const joined = lines.join('\n');
      // Should contain truncated value (47 chars + '...')
      expect(joined).toContain('...');
      expect(joined.length).toBeLessThan(200);
    });

    it('should highlight focused option with green', () => {
      const { component } = createComponent();
      const lines = component.render(80);
      // First option should be focused by default (contains ❯)
      const firstOptionLine = lines.find((l) => l.includes('允许本次'));
      expect(firstOptionLine).toBeDefined();
      expect(firstOptionLine).toContain('❯');
    });
  });

  describe('handleInput - cancel', () => {
    it('should deny on Escape', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('escape');
      expect(onResolve).toHaveBeenCalledWith({ approved: false });
    });

    it('should deny on q', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('q');
      expect(onResolve).toHaveBeenCalledWith({ approved: false });
    });
  });

  describe('handleInput - navigation', () => {
    it('should move selection down with j', () => {
      const { component } = createComponent();
      component.handleInput('j');
      component.handleInput('enter');
      // Second option selected → 'session' scope
    });

    it('should move selection up with k', () => {
      const { component } = createComponent();
      component.handleInput('j');
      component.handleInput('k');
      // Back to first option
    });

    it('should cycle selection with Tab', () => {
      const { component } = createComponent();
      component.handleInput('tab');
      component.handleInput('tab');
      component.handleInput('tab');
      // Should cycle through all 3 options without crash
    });

    it('should not wrap below zero on up arrow', () => {
      const { component } = createComponent();
      component.handleInput('up');
      component.handleInput('up');
      // Should stay at 0 without crash
    });

    it('should not wrap beyond last on down arrow', () => {
      const { component } = createComponent();
      component.handleInput('down');
      component.handleInput('down');
      component.handleInput('down');
      // Should stay at last without crash
    });
  });

  describe('handleInput - Enter confirmation', () => {
    it('should allow once when Enter on first option', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('enter');
      expect(onResolve).toHaveBeenCalledWith({ approved: true, scope: 'once' });
    });

    it('should allow session when Enter on second option', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('j'); // Move to second option
      component.handleInput('enter');
      expect(onResolve).toHaveBeenCalledWith({ approved: true, scope: 'session' });
    });

    it('should deny when Enter on third option', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('j');
      component.handleInput('j'); // Move to third option
      component.handleInput('enter');
      expect(onResolve).toHaveBeenCalledWith({ approved: false });
    });
  });

  describe('handleInput - digit shortcuts', () => {
    it('should allow once on 1', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('1');
      expect(onResolve).toHaveBeenCalledWith({ approved: true, scope: 'once' });
    });

    it('should allow session on 2', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('2');
      expect(onResolve).toHaveBeenCalledWith({ approved: true, scope: 'session' });
    });

    it('should deny on 3', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('3');
      expect(onResolve).toHaveBeenCalledWith({ approved: false });
    });

    it('should ignore unrecognized digits', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('9');
      expect(onResolve).not.toHaveBeenCalled();
    });

    it('should ignore 0 (no longer mapped)', () => {
      const { component, onResolve } = createComponent();
      component.handleInput('0');
      expect(onResolve).not.toHaveBeenCalled();
    });
  });

  describe('invalidate', () => {
    it('should be a no-op', () => {
      const { component } = createComponent();
      expect(() => component.invalidate()).not.toThrow();
    });
  });
});
