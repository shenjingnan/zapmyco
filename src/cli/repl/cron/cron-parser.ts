/**
 * 自定义 5-field cron 表达式解析器
 *
 * 支持标准的 cron 字段和通配符，不引入外部依赖。
 * 语法: "minute hour day-of-month month day-of-week"
 *
 * 字段规格:
 * - minute:        0-59
 * - hour:          0-23
 * - day-of-month:  1-31
 * - month:         1-12
 * - day-of-week:   0-6 (0=Sunday)
 *
 * 每个字段支持: *(通配), 步进, N(精确值), N-M(范围), N,M(列表)
 *
 * @module cli/repl/cron/cron-parser
 */

// ============ 字段解析 ============

interface FieldMatcher {
  /** 检查给定值是否匹配此字段 */
  matches(value: number): boolean;
}

/** 通配符 * — 匹配所有值 */
class WildcardMatcher implements FieldMatcher {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  matches(_value: number): boolean {
    return true;
  }
}

/** 步进（每 N 个值匹配一次） */
class StepMatcher implements FieldMatcher {
  private step: number;
  private min: number;

  constructor(step: number, min: number) {
    this.step = step;
    this.min = min;
  }

  matches(value: number): boolean {
    return (value - this.min) % this.step === 0;
  }
}

/** 精确值 N */
class ValueMatcher implements FieldMatcher {
  private accepted: Set<number>;

  constructor(values: number[]) {
    this.accepted = new Set(values);
  }

  matches(value: number): boolean {
    return this.accepted.has(value);
  }
}

/** 范围 N-M */
class RangeMatcher implements FieldMatcher {
  private start: number;
  private end: number;

  constructor(start: number, end: number) {
    this.start = start;
    this.end = end;
  }

  matches(value: number): boolean {
    return value >= this.start && value <= this.end;
  }
}

// ============ 字段定义 ============

interface CronFieldSpec {
  name: string;
  min: number;
  max: number;
}

const FIELD_SPECS: CronFieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day-of-week', min: 0, max: 6 },
];

// ============ 解析函数 ============

/**
 * 解析单个 cron 字段为 Matcher 数组
 */
function parseField(field: string, spec: CronFieldSpec): FieldMatcher[] | null {
  const trimmed = field.trim();
  if (trimmed.length === 0) return null;

  const matchers: FieldMatcher[] = [];

  // 逗号分隔的多个表达式
  const parts = trimmed.split(',');
  for (const part of parts) {
    const p = part.trim();
    if (p.length === 0) return null;

    const matcher = parseFieldPart(p, spec);
    if (!matcher) return null;
    matchers.push(matcher);
  }

  return matchers.length > 0 ? matchers : null;
}

function parseFieldPart(part: string, spec: CronFieldSpec): FieldMatcher | null {
  // */N 步进
  if (part.startsWith('*/')) {
    const step = parseInt(part.slice(2), 10);
    if (isNaN(step) || step < 1) return null;
    return new StepMatcher(step, spec.min);
  }

  // * 通配符
  if (part === '*') {
    return new WildcardMatcher();
  }

  // N-M 范围
  const rangeMatch = part.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1] ?? '', 10);
    const end = parseInt(rangeMatch[2] ?? '', 10);
    if (isNaN(start) || isNaN(end)) return null;
    if (start < spec.min || end > spec.max || start > end) return null;
    return new RangeMatcher(start, end);
  }

  // 精确值 N
  const value = parseInt(part, 10);
  if (!isNaN(value) && value >= spec.min && value <= spec.max) {
    return new ValueMatcher([value]);
  }

  return null;
}

// ============ 公开 API ============

export interface CronSchedule {
  /** 字段匹配器数组，顺序: [minute, hour, dom, month, dow] */
  fields: FieldMatcher[][];
  /** 人类可读描述 */
  description: string;

  /**
   * 计算给定时间之后的下一次触发时间
   * @param from 起始时间（不包含）
   * @returns 下一次触发时间，如果未来 2 年内无匹配则返回 null
   */
  nextFrom(from: Date): Date | null;
}

/**
 * 创建 CronSchedule
 * @param expr 5-field cron 表达式
 * @returns 解析后的 CronSchedule，无效表达式返回 null
 */
function createCronSchedule(expr: string): CronSchedule | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const parsedFields: FieldMatcher[][] = [];
  for (let i = 0; i < 5; i++) {
    const matchers = parseField(fields[i] ?? '', FIELD_SPECS[i]!);
    if (!matchers) return null;
    parsedFields.push(matchers);
  }

  const description = buildDescription(fields, parsedFields);

  return {
    fields: parsedFields,
    description,

    nextFrom(from: Date): Date | null {
      return computeNextFrom(from, parsedFields);
    },
  };
}

/**
 * 解析 cron 表达式
 * @param expr 5-field cron 表达式
 * @returns 解析后的 CronSchedule，无效表达式返回 null
 */
export function parseCron(expr: string): CronSchedule | null {
  return createCronSchedule(expr);
}

// ============ 触发时间计算 ============

/**
 * 计算月份的最后一天
 */
function lastDayOfMonth(year: number, month: number): number {
  // month: 1-12
  return new Date(year, month, 0).getDate(); // month 0 = 前一个月的最后一天
}

/**
 * 计算下一次触发时间
 *
 * 算法：从起始时间开始逐分钟递增，直到所有字段匹配。
 * 使用月份/日期边界跳跃优化，避免过多次循环。
 */
function computeNextFrom(from: Date, fields: FieldMatcher[][]): Date | null {
  // 最大查找范围：2 年
  const maxDate = new Date(from);
  maxDate.setFullYear(maxDate.getFullYear() + 2);

  // 从下一分钟开始（+60s 然后重置秒）
  let current = new Date(from.getTime() + 60000);
  current.setSeconds(0, 0);

  let iterations = 0;
  const MAX_ITERATIONS = 366 * 24 * 60; // 最多检查一年的分钟数

  while (current.getTime() <= maxDate.getTime()) {
    iterations++;
    if (iterations > MAX_ITERATIONS) return null;

    // 快速检查月份
    const month = current.getMonth() + 1;
    if (!matchersAnyMatch(month, fields[3]!)) {
      // 跳到下个月
      current.setMonth(current.getMonth() + 1, 1);
      current.setHours(0, 0, 0, 0);
      continue;
    }

    // 快速检查日期
    const dom = current.getDate();
    const maxDom = lastDayOfMonth(current.getFullYear(), month);
    if (dom > maxDom || !matchersAnyMatch(dom <= maxDom ? dom : maxDom, fields[2]!)) {
      // 跳到下一天
      const nextDay = new Date(current);
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);

      // 如果跨月，重置到 1 号
      if (nextDay.getDate() === 1) {
        current = nextDay;
      } else {
        current.setDate(current.getDate() + 1);
        current.setHours(0, 0, 0, 0);
      }
      continue;
    }

    // 快速检查 day-of-week（与 dom 需要同时满足）
    const dow = current.getDay();
    if (!matchersAnyMatch(dow, fields[4]!)) {
      // 跳过一天
      current.setDate(current.getDate() + 1);
      current.setHours(0, 0, 0, 0);
      continue;
    }

    // 检查小时
    const hour = current.getHours();
    if (!matchersAnyMatch(hour, fields[1]!)) {
      // 跳到下一个可能的小时
      current.setHours(hour + 1, 0, 0, 0);
      continue;
    }

    // 检查分钟
    const minute = current.getMinutes();
    if (matchersAnyMatch(minute, fields[0]!)) {
      return new Date(current);
    }

    // 下一分钟
    current.setMinutes(minute + 1, 0, 0);
  }

  return null;
}

function matchersAnyMatch(value: number, matchers: FieldMatcher[]): boolean {
  for (const m of matchers) {
    if (m.matches(value)) return true;
  }
  return false;
}

// ============ 人类可读描述 ============

function buildDescription(rawFields: string[], _parsedFields: FieldMatcher[][]): string {
  const parts: string[] = [];

  // minute
  parts.push(describeField(rawFields[0] ?? '*', '分钟', '每', ''));
  // hour
  parts.push(describeField(rawFields[1] ?? '*', '小时', '', '点'));
  // day-of-month
  const domStr = describeField(rawFields[2] ?? '*', '日', '每月', '号');
  if (domStr.length > 0 && rawFields[2] !== '*') {
    parts.push(domStr);
  }
  // month
  const monthStr = describeField(rawFields[3] ?? '*', '月', '', '月');
  if (monthStr.length > 0 && rawFields[3] !== '*') {
    parts.push(monthStr);
  }
  // day-of-week
  const dowStr = describeDow(rawFields[4] ?? '*');
  if (dowStr.length > 0 && rawFields[4] !== '*') {
    parts.push(dowStr);
  }

  if (parts.length === 0) return '每分钟';
  return parts.join(' ');
}

function describeField(raw: string, unit: string, prefix: string, suffix: string): string {
  if (raw === '*') return '';

  if (raw.startsWith('*/')) {
    const n = raw.slice(2);
    return `${prefix}每${n}${unit}${suffix}`;
  }

  if (raw.includes(',')) {
    return `${prefix}${raw}${unit}${suffix}`;
  }

  if (raw.includes('-')) {
    return `${prefix}${raw.replace('-', '到')}${unit}${suffix}`;
  }

  return `${prefix}${raw}${unit}${suffix}`;
}

function describeDow(raw: string): string {
  const DOW_NAMES: Record<string, string> = {
    '0': '周日',
    '1': '周一',
    '2': '周二',
    '3': '周三',
    '4': '周四',
    '5': '周五',
    '6': '周六',
  };

  if (raw === '*') return '';

  if (raw.startsWith('*/')) return '';

  if (raw.includes('-')) {
    const parts = raw.split('-');
    const start = parts[0] ?? '';
    const end = parts[1] ?? '';
    const startName = DOW_NAMES[start] ?? start;
    const endName = DOW_NAMES[end] ?? end;
    return `${startName}到${endName}`;
  }

  if (raw.includes(',')) {
    return raw
      .split(',')
      .map((d) => DOW_NAMES[d.trim()] ?? d.trim())
      .join('、');
  }

  return DOW_NAMES[raw] ?? raw;
}

// ============ 错过任务检测 ============

/**
 * 检测启动时错过的一次性任务
 * 如果 nextFrom(createdAt) < now 且 lastFiredAt 为空，说明错过了
 */
export function getMissedOneShotJobs(
  jobs: { id: string; cron: string; createdAt: number; lastFiredAt?: number }[],
  now: Date
): { id: string; createdAt: number }[] {
  const missed: { id: string; createdAt: number }[] = [];

  for (const job of jobs) {
    if (job.lastFiredAt) continue;

    const schedule = parseCron(job.cron);
    if (!schedule) continue;

    const next = schedule.nextFrom(new Date(job.createdAt));
    if (next && next.getTime() < now.getTime()) {
      missed.push({ id: job.id, createdAt: job.createdAt });
    }
  }

  return missed;
}
