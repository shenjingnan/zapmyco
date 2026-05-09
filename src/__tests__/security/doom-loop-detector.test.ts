import { describe, expect, it } from 'vitest';
import { createDoomLoopDetector, DoomLoopDetector } from '@/security/doom-loop-detector';

describe('DoomLoopDetector', () => {
  // ============ 构造函数 ============
  describe('constructor', () => {
    it('应该使用默认配置创建', () => {
      const detector = new DoomLoopDetector();
      expect(detector).toBeDefined();
    });

    it('应该接受自定义配置', () => {
      const detector = new DoomLoopDetector({
        enabled: true,
        maxRepeatedCalls: 5,
        maxConsecutiveFailures: 10,
      });
      const stats = detector.getStats();
      expect(stats.consecutiveFailures).toBe(0);
    });

    it('禁用的检测器不应该检测任何问题', () => {
      const detector = new DoomLoopDetector({ enabled: false });
      const result = detector.recordCall('ReadFile', { file_path: '/test' });
      expect(result.detected).toBe(false);
      expect(result.shouldBlock).toBe(false);
    });
  });

  // ============ 工厂函数 ============
  describe('createDoomLoopDetector', () => {
    it('应该创建 DoomLoopDetector 实例', () => {
      const detector = createDoomLoopDetector();
      expect(detector).toBeInstanceOf(DoomLoopDetector);
    });

    it('应该接受可选配置', () => {
      const detector = createDoomLoopDetector({ maxRepeatedCalls: 10 });
      expect(detector).toBeInstanceOf(DoomLoopDetector);
    });
  });

  // ============ 重复调用检测 ============
  describe('重复调用检测', () => {
    it('单次调用不应该触发检测', () => {
      const detector = new DoomLoopDetector();
      const result = detector.recordCall('ReadFile', { file_path: '/a' });
      expect(result.detected).toBe(false);
    });

    it('不同工具调用不应该触发检测', () => {
      const detector = new DoomLoopDetector();
      detector.recordCall('ReadFile', { file_path: '/a' });
      detector.recordCall('Glob', { pattern: '*.ts' });
      // 第三个调用是不同工具
      const result = detector.recordCall('Grep', { pattern: 'test' });
      expect(result.detected).toBe(false);
    });

    it('连续相同调用达到阈值应该触发检测', () => {
      const detector = new DoomLoopDetector({ maxRepeatedCalls: 3 });
      detector.recordCall('ReadFile', { file_path: '/a' });
      detector.recordCall('ReadFile', { file_path: '/a' });
      const result = detector.recordCall('ReadFile', { file_path: '/a' });
      expect(result.detected).toBe(true);
      expect(result.type).toBe('repeated-call');
      expect(result.reason).toContain('ReadFile');
    });

    it('超过阈值后应该建议阻止', () => {
      const detector = new DoomLoopDetector({ maxRepeatedCalls: 2 });
      detector.recordCall('WebFetch', { url: 'http://example.com' });
      detector.recordCall('WebFetch', { url: 'http://example.com' });
      // 第 3 次连续调用
      detector.recordCall('WebFetch', { url: 'http://example.com' });
      // 第 4 次连续调用 → shouldBlock (阈值 2 + 2 = 4)
      const result = detector.recordCall('WebFetch', { url: 'http://example.com' });
      expect(result.detected).toBe(true);
      expect(result.shouldBlock).toBe(true);
    });

    it('不同的参数不算相同调用', () => {
      const detector = new DoomLoopDetector({ maxRepeatedCalls: 3 });
      detector.recordCall('ReadFile', { file_path: '/a' });
      detector.recordCall('ReadFile', { file_path: '/b' });
      const result = detector.recordCall('ReadFile', { file_path: '/c' });
      // 不同文件路径，不是相同调用
      expect(result.detected).toBe(false);
    });

    it('execute 工具相同命令算相同调用', () => {
      const detector = new DoomLoopDetector({ maxRepeatedCalls: 2 });
      detector.recordCall('Exec', { command: 'npm test' });
      const result = detector.recordCall('Exec', { command: 'npm test' });
      expect(result.detected).toBe(true);
      expect(result.type).toBe('repeated-call');
    });
  });

  // ============ 连续失败检测 ============
  describe('连续失败检测', () => {
    it('初始状态应该没有失败', () => {
      const detector = new DoomLoopDetector();
      const stats = detector.getStats();
      expect(stats.consecutiveFailures).toBe(0);
    });

    it('成功调用应该重置失败计数', () => {
      const detector = new DoomLoopDetector();
      detector.recordResult(false);
      detector.recordResult(false);
      detector.recordResult(true);
      expect(detector.getStats().consecutiveFailures).toBe(0);
    });

    it('连续失败达到阈值应该触发检测', () => {
      const detector = new DoomLoopDetector({ maxConsecutiveFailures: 3 });
      detector.recordResult(false);
      detector.recordResult(false);
      const result = detector.recordResult(false);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('consecutive-failure');
    });

    it('超过连续失败阈值应该建议阻止', () => {
      const detector = new DoomLoopDetector({ maxConsecutiveFailures: 2 });
      detector.recordResult(false);
      detector.recordResult(false);
      detector.recordResult(false);
      detector.recordResult(false);
      const result = detector.recordResult(false);
      // 5 次 = 阈值 2 + 3，应该建议阻止
      expect(result.shouldBlock).toBe(true);
    });

    it('禁用的检测器不记录失败', () => {
      const detector = new DoomLoopDetector({ enabled: false });
      const result = detector.recordResult(false);
      expect(result.detected).toBe(false);
    });
  });

  // ============ 速率限制 ============
  describe('速率限制', () => {
    it('正常调用频率不应该触发限速', () => {
      const detector = new DoomLoopDetector({
        maxCallsPerWindow: 50,
        rateWindowSec: 60,
      });
      const result = detector.recordCall('ReadFile', { file_path: '/a' });
      expect(result.detected).toBe(false);
    });

    it('超过速率限制应该触发检测', () => {
      const detector = new DoomLoopDetector({
        maxCallsPerWindow: 3,
        rateWindowSec: 60,
        maxRepeatedCalls: 100, // 避免触发重复调用检测
      });
      detector.recordCall('ReadFile', { file_path: '/1' });
      detector.recordCall('Glob', { pattern: '*.ts' });
      detector.recordCall('Grep', { pattern: 'a' });
      const result = detector.recordCall('WebFetch', { url: 'http://a.com' });
      expect(result.detected).toBe(true);
      expect(result.type).toBe('rate-limit');
      expect(result.shouldBlock).toBe(true);
    });
  });

  // ============ 重置 ============
  describe('reset', () => {
    it('重置后应该清除所有状态', () => {
      const detector = new DoomLoopDetector({ maxConsecutiveFailures: 2 });
      detector.recordResult(false);
      detector.recordResult(false);
      detector.reset();
      const stats = detector.getStats();
      expect(stats.consecutiveFailures).toBe(0);
      expect(stats.consecutiveSameCall).toBe(0);
      expect(stats.recentCallCount).toBe(0);
    });

    it('重置后重复调用计数器应该归零', () => {
      const detector = new DoomLoopDetector({ maxRepeatedCalls: 2 });
      detector.recordCall('ReadFile', { file_path: '/a' });
      detector.recordCall('ReadFile', { file_path: '/a' });
      detector.reset();
      // 重置后相同调用应该不再触发
      const result = detector.recordCall('ReadFile', { file_path: '/a' });
      expect(result.detected).toBe(false);
    });
  });

  // ============ 统计 ============
  describe('getStats', () => {
    it('应该返回当前统计信息', () => {
      const detector = new DoomLoopDetector();
      const stats = detector.getStats();
      expect(stats).toHaveProperty('consecutiveFailures');
      expect(stats).toHaveProperty('consecutiveSameCall');
      expect(stats).toHaveProperty('recentCallCount');
      expect(stats.consecutiveFailures).toBe(0);
      expect(stats.consecutiveSameCall).toBe(0);
    });

    it('调用后统计应该更新', () => {
      const detector = new DoomLoopDetector();
      detector.recordCall('ReadFile', { file_path: '/a' });
      const stats = detector.getStats();
      expect(stats.recentCallCount).toBe(1);
      expect(stats.consecutiveSameCall).toBe(1);
    });
  });

  // ============ 更新配置 ============
  describe('updateConfig', () => {
    it('应该能运行时更新配置', () => {
      const detector = new DoomLoopDetector({ maxRepeatedCalls: 5 });
      detector.updateConfig({ maxRepeatedCalls: 1 });
      detector.recordCall('ReadFile', { file_path: '/a' });
      const result = detector.recordCall('ReadFile', { file_path: '/a' });
      expect(result.detected).toBe(true);
    });

    it('可以通过配置禁用检测器', () => {
      const detector = new DoomLoopDetector();
      detector.updateConfig({ enabled: false });
      const result = detector.recordCall('ReadFile', { file_path: '/a' });
      expect(result.detected).toBe(false);
    });
  });

  // ============ 边界场景 ============
  describe('边界场景', () => {
    it('空参数应该正常工作', () => {
      const detector = new DoomLoopDetector({ maxRepeatedCalls: 3 });
      const result = detector.recordCall('Exec', {});
      expect(result.detected).toBe(false);
    });

    it('大量不同调用应触发速率限制但不触发重复检测', () => {
      const detector = new DoomLoopDetector({
        maxRepeatedCalls: 100,
        maxCallsPerWindow: 5,
        rateWindowSec: 60,
      });
      for (let i = 0; i < 6; i++) {
        detector.recordCall(`Tool${i}`, { index: i });
      }
      // 速率限制应在第 6 次触发
    });

    it('记录成功后的失败计数应该从零开始', () => {
      const detector = new DoomLoopDetector({ maxConsecutiveFailures: 3 });
      detector.recordResult(false);
      detector.recordResult(true);
      detector.recordResult(false);
      const result = detector.recordResult(false);
      // 只有 2 次连续失败（成功重置了计数）
      expect(result.detected).toBe(false);
    });
  });
});
