import { MatchResult } from '@/components/devices/types';
import { CardMatchResult } from '@/components/devices/constants';

export const Matchers = {
  /**
   * 检查条件，如果为true则返回指定优先级的匹配结果
   * @param condition 要检查的条件
   * @param result 条件为true时返回的匹配结果
   */
  when: (condition: boolean, result: MatchResult): MatchResult => {
    return condition ? result : CardMatchResult.NO_MATCH;
  },

  /**
   * 检查字符串前缀
   * @param value 要检查的字符串
   * @param prefix 前缀
   * @param result 条件满足时返回的匹配结果
   */
  startsWith: (value: string, prefix: string, result: MatchResult): MatchResult => {
    return value.startsWith(prefix) ? result : CardMatchResult.NO_MATCH;
  },

  /**
   * 检查相等性
   * @param value 要检查的值
   * @param expected 期望的值
   * @param result 条件满足时返回的匹配结果
   */
  equals: (value: unknown, expected: unknown, result: MatchResult): MatchResult => {
    return value === expected ? result : CardMatchResult.NO_MATCH;
  },

  /**
   * 检查存在性
   * @param value 要检查的值
   * @param result 值存在时返回的匹配结果
   */
  exists: (value: unknown, result: MatchResult): MatchResult => {
    return value !== undefined && value !== null ? result : CardMatchResult.NO_MATCH;
  },

  /**
   * 检查位掩码
   * @param value 要检查的数值
   * @param flag 位标志
   * @param result 条件满足时返回的匹配结果
   */
  hasBitFlag: (value: number | undefined, flag: number, result: MatchResult): MatchResult => {
    return value !== undefined && (value & flag) === flag ? result : CardMatchResult.NO_MATCH;
  },

  /**
   * 检查值是否包含在数组中
   * @param value 要检查的值
   * @param array 数组
   * @param result 条件满足时返回的匹配结果
   */
  includes: <T>(value: T, array: T[], result: MatchResult): MatchResult => {
    return array.includes(value) ? result : CardMatchResult.NO_MATCH;
  },

  /**
   * 检查对象是否有特定属性
   * @param obj 要检查的对象
   * @param prop 属性名
   * @param result 条件满足时返回的匹配结果
   */
  hasProperty: (obj: unknown, prop: string, result: MatchResult): MatchResult => {
    return obj && typeof obj === 'object' && prop in obj ? result : CardMatchResult.NO_MATCH;
  },
};
