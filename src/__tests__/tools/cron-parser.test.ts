import { describe, expect, it } from 'vitest';
import { getMissedOneShotJobs, parseCron } from '@/cli/repl/cron/cron-parser';

/** 创建本地时间的 Date 对象（避免 UTC 时区混淆） */
function localDate(spec: string): Date {
  // ISO 字符串无时区后缀时，JS 视为 UTC，这里手动构造本地时间
  const [datePart, timePart] = spec.split('T');
  const [y, mo, d] = datePart!.split('-').map(Number);
  const [h, m, s] = (timePart ?? '00:00:00').split(':').map(Number);
  return new Date(y!, (mo ?? 1) - 1, d ?? 1, h ?? 0, m ?? 0, s ?? 0);
}

/**
 * cron-parser 5-field cron 解析器单元测试
 *
 * 覆盖: 通配符、步进、精确值、范围、列表、边界场景、错误输入
 */
describe('cron-parser', () => {
  describe('parseCron', () => {
    // ========== 通配符 ==========
    it('* * * * * 匹配每分钟', () => {
      const schedule = parseCron('* * * * *');
      expect(schedule).not.toBeNull();

      const now = localDate('2026-05-03T10:30:00');
      const next = schedule!.nextFrom(now);
      expect(next).not.toBeNull();
      expect(next!.getHours()).toBe(10);
      expect(next!.getMinutes()).toBe(31);
    });

    // ========== 精确值 ==========
    it('精确时间 30 14 * * * 匹配每天 14:30', () => {
      const schedule = parseCron('30 14 * * *');
      expect(schedule).not.toBeNull();

      const now = localDate('2026-05-03T10:00:00');
      const next = schedule!.nextFrom(now);
      expect(next).not.toBeNull();
      expect(next!.getHours()).toBe(14);
      expect(next!.getMinutes()).toBe(30);
    });

    it('精确时间在当天已过时应返回次日', () => {
      const schedule = parseCron('30 14 * * *');
      expect(schedule).not.toBeNull();

      const now = localDate('2026-05-03T15:00:00');
      const next = schedule!.nextFrom(now);
      expect(next).not.toBeNull();
      // 应该是第二天的 14:30
      expect(next!.getHours()).toBe(14);
      expect(next!.getMinutes()).toBe(30);
      expect(next!.getDate()).toBe(4);
    });

    // ========== 步进 ==========
    it('*/5 * * * * 每 5 分钟触发', () => {
      const schedule = parseCron('*/5 * * * *');
      expect(schedule).not.toBeNull();

      const now = localDate('2026-05-03T10:01:00');
      const next = schedule!.nextFrom(now);
      expect(next).not.toBeNull();
      // 下一个 5 分钟整点: 10:05
      expect(next!.getMinutes()).toBe(5);
    });

    it('*/15 * * * * 每 15 分钟触发', () => {
      const schedule = parseCron('*/15 * * * *');
      expect(schedule).not.toBeNull();

      const now = localDate('2026-05-03T10:16:00');
      const next = schedule!.nextFrom(now);
      expect(next).not.toBeNull();
      expect(next!.getMinutes()).toBe(30);
    });

    // ========== 范围 ==========
    it('0 9-17 * * * 匹配 9 点到 17 点', () => {
      const schedule = parseCron('0 9-17 * * *');
      expect(schedule).not.toBeNull();

      const now = localDate('2026-05-03T08:00:00');
      const next = schedule!.nextFrom(now);
      expect(next).not.toBeNull();
      expect(next!.getHours()).toBe(9);
    });

    it('范围外的时间跳转到次日', () => {
      const schedule = parseCron('0 9-17 * * *');
      expect(schedule).not.toBeNull();

      const now = localDate('2026-05-03T18:00:00');
      const next = schedule!.nextFrom(now);
      expect(next).not.toBeNull();
      expect(next!.getHours()).toBe(9);
      expect(next!.getDate()).toBe(4);
    });

    // ========== 列表 ==========
    it('0 9,15,21 * * * 匹配多个小时', () => {
      const schedule = parseCron('0 9,15,21 * * *');
      expect(schedule).not.toBeNull();

      const now = localDate('2026-05-03T10:00:00');
      const next = schedule!.nextFrom(now);
      expect(next).not.toBeNull();
      expect(next!.getHours()).toBe(15);
    });

    // ========== 星期 ==========
    it('0 9 * * 1-5 工作日早上 9 点', () => {
      const schedule = parseCron('0 9 * * 1-5');
      expect(schedule).not.toBeNull();

      // 2026-05-03 是周日(0)，下一个工作日是周一(1): 2026-05-04
      const now = localDate('2026-05-03T10:00:00');
      const next = schedule!.nextFrom(now);
      expect(next).not.toBeNull();
      expect(next!.getDay()).toBe(1); // 周一
      expect(next!.getHours()).toBe(9);
    });

    // ========== 月份和日期 ==========
    it('0 0 1 1 * 元旦（1月1日 0:00）', () => {
      const schedule = parseCron('0 0 1 1 *');
      expect(schedule).not.toBeNull();

      const now = localDate('2026-12-03T10:00:00');
      const next = schedule!.nextFrom(now);
      expect(next).not.toBeNull();
      expect(next!.getMonth()).toBe(0); // 1 月 (0-indexed)
      expect(next!.getDate()).toBe(1);
    });

    // ========== 组合场景 ==========
    it('0 9 * * 0 周日上午 9 点', () => {
      const schedule = parseCron('0 9 * * 0');
      expect(schedule).not.toBeNull();

      // 2026-05-03 是周日，从 8:00 开始
      const now = localDate('2026-05-03T08:00:00');
      const next = schedule!.nextFrom(now);
      expect(next).not.toBeNull();
      expect(next!.getDay()).toBe(0); // Sunday
      expect(next!.getHours()).toBe(9);
    });

    // ========== 无效输入 ==========
    it('无效表达式（字段不足）返回 null', () => {
      expect(parseCron('* * * *')).toBeNull();
      expect(parseCron('')).toBeNull();
    });

    it('无效表达式（字段过多）返回 null', () => {
      expect(parseCron('* * * * * *')).toBeNull();
    });

    it('无效表达式（值超出范围）返回 null', () => {
      expect(parseCron('60 * * * *')).toBeNull();
      expect(parseCron('* 24 * * *')).toBeNull();
      expect(parseCron('* * 32 * *')).toBeNull();
      expect(parseCron('* * * 13 *')).toBeNull();
      expect(parseCron('* * * * 7')).toBeNull();
    });

    it('无效的步进值返回 null', () => {
      expect(parseCron('*/0 * * * *')).toBeNull();
    });

    // ========== 描述 ==========
    it('description 返回可读的中文描述', () => {
      const s1 = parseCron('0 9 * * *');
      expect(s1!.description).toContain('9');

      const s2 = parseCron('*/5 * * * *');
      expect(s2!.description).toContain('5');

      const s3 = parseCron('0 9 * * 1-5');
      expect(s3!.description).toContain('周');
    });

    // ========== 边界 ==========
    it('月末日期 31 号在 4 月应跳过', () => {
      const schedule = parseCron('0 0 31 * *');
      expect(schedule).not.toBeNull();

      // 4月只有 30 天
      const now = localDate('2026-04-01T10:00:00');
      const next = schedule!.nextFrom(now);
      expect(next).not.toBeNull();
      // 应该跳到 5 月 31 日
      expect(next!.getMonth()).toBe(4); // 5 月 (0-indexed)
    });

    it('从下一秒开始计算（不包含 from 时间本身）', () => {
      const schedule = parseCron('30 10 * * *');
      expect(schedule).not.toBeNull();

      const now = localDate('2026-05-03T10:30:00');
      const next = schedule!.nextFrom(now);
      expect(next).not.toBeNull();
      // 应该是明天的 10:30，因为当前时间刚好是触发时间
      expect(next!.getDate()).toBe(4);
    });
  });

  describe('getMissedOneShotJobs', () => {
    it('应该返回错过的一次性任务', () => {
      const now = localDate('2026-05-03T12:00:00');
      const jobs = [
        {
          id: 'test1',
          cron: '0 9 * * *',
          createdAt: localDate('2026-05-03T08:00:00').getTime(),
        },
        {
          id: 'test2',
          cron: '0 15 * * *',
          createdAt: localDate('2026-05-03T08:00:00').getTime(),
          lastFiredAt: localDate('2026-05-03T09:00:00').getTime(), // 已触发过
        },
      ];

      const missed = getMissedOneShotJobs(jobs, now);
      expect(missed.length).toBe(1);
      expect(missed[0]!.id).toBe('test1');
    });

    it('不应返回未来时间的一次性任务', () => {
      const now = localDate('2026-05-03T08:00:00');
      const jobs = [
        {
          id: 'test1',
          cron: '0 9 * * *',
          createdAt: localDate('2026-05-03T08:00:00').getTime(),
        },
      ];

      const missed = getMissedOneShotJobs(jobs, now);
      expect(missed.length).toBe(0);
    });

    it('应跳过已触发的任务', () => {
      const now = localDate('2026-05-03T12:00:00');
      const jobs = [
        {
          id: 'test1',
          cron: '0 9 * * *',
          createdAt: localDate('2026-05-03T08:00:00').getTime(),
          lastFiredAt: localDate('2026-05-03T09:00:00').getTime(),
        },
      ];

      const missed = getMissedOneShotJobs(jobs, now);
      expect(missed.length).toBe(0);
    });
  });
});
