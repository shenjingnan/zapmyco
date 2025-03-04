import { HassEntity } from 'home-assistant-js-websocket';
import { MatchResult } from './types';
import { CardMatchResult } from './constants';

// 组合匹配器
export const CombineMatchers = {
  /**
   * 所有条件必须匹配，返回最高优先级
   * @param conditions 条件匹配器函数列表
   */
  all: (...conditions: Array<(entity: HassEntity) => MatchResult>) => {
    return (entity: HassEntity): MatchResult => {
      const results = conditions.map((condition) => condition(entity));
      if (results.every((r) => r.match)) {
        return {
          match: true,
          priority: Math.max(...results.map((r) => r.priority)),
        };
      }
      return CardMatchResult.NO_MATCH;
    };
  },

  /**
   * 任意条件匹配即可，返回最高优先级
   * @param conditions 条件匹配器函数列表
   */
  any: (...conditions: Array<(entity: HassEntity) => MatchResult>) => {
    return (entity: HassEntity): MatchResult => {
      const results = conditions.map((condition) => condition(entity));
      const matching = results.filter((r) => r.match);
      if (matching.length > 0) {
        return {
          match: true,
          priority: Math.max(...matching.map((r) => r.priority)),
        };
      }
      return CardMatchResult.NO_MATCH;
    };
  },

  /**
   * 按优先级顺序尝试匹配，返回第一个匹配的结果
   * @param conditions 条件匹配器函数列表
   */
  firstMatch: (...conditions: Array<(entity: HassEntity) => MatchResult>) => {
    return (entity: HassEntity): MatchResult => {
      for (const condition of conditions) {
        const result = condition(entity);
        if (result.match) {
          return result;
        }
      }
      return CardMatchResult.NO_MATCH;
    };
  },
};
