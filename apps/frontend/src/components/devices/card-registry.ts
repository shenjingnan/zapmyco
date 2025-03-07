import { HassEntity } from 'home-assistant-js-websocket';
import { CardComponent, MatchResult } from './types';
import { CardMatchResult } from './constants';
import { Matchers } from './matchers';

// 卡片注册中心
class CardRegistry {
  private cards: CardComponent<unknown>[] = [];

  // 注册卡片
  register(card: CardComponent<unknown>) {
    this.cards.push(card);
    console.log(`注册卡片: ${card.meta.id}`);
    return this;
  }

  // 根据entity匹配卡片
  findCardForEntity(entity: HassEntity): CardComponent<unknown> | undefined {
    // 收集所有匹配的卡片及其优先级
    const matchedCards = this.cards
      .map((card) => {
        const result = card.meta.matcher(entity);
        return {
          card,
          result,
        };
      })
      .filter((item) => item.result.match);

    // 按优先级排序，返回最高优先级的卡片
    if (matchedCards.length > 0) {
      return matchedCards
        .sort((a, b) => b.result.priority - a.result.priority)
        .map((item) => item.card)[0];
    }

    return undefined;
  }

  // 获取所有已注册卡片
  getAllCards() {
    return [...this.cards];
  }

  debugMatchingProcess(entity: HassEntity): void {
    console.group(`卡片匹配过程: ${entity.entity_id}`);

    const matchResults = this.cards
      .map((card) => {
        const result = card.meta.matcher(entity);
        return {
          cardId: card.meta.id,
          match: result.match,
          priority: result.priority,
        };
      })
      .sort((a, b) => b.priority - a.priority);

    console.table(matchResults);

    const selectedCard = matchResults.find((r) => r.match);
    console.log(`选中的卡片: ${selectedCard ? selectedCard.cardId : '无匹配卡片'}`);

    console.groupEnd();
  }
}

// 单例实例
const cardRegistry = new CardRegistry();

export { cardRegistry };

export const CombineMatchers = {
  /**
   * All conditions must match, returns the highest priority
   *
   * @param results - Multiple match results
   * @returns Combined match result
   *
   * @example
   * ```typescript
   * matcher: (entity: HassEntity) => {
   *   return CombineMatchers.all(
   *     entity.entity_id.startsWith('light.') ? CardMatchResult.DOMAIN_EXACT_MATCH : CardMatchResult.NO_MATCH,
   *     entity.attributes.manufacturer === 'philips' ? CardMatchResult.MANUFACTURER_MATCH : CardMatchResult.NO_MATCH
   *   );
   * }
   * ```
   */
  all: (...results: MatchResult[]): MatchResult => {
    if (results.every((r) => r.match)) {
      return {
        match: true,
        priority: Math.max(...results.map((r) => r.priority)),
      };
    }
    return CardMatchResult.NO_MATCH;
  },

  /**
   * Any condition matching will return the highest priority
   *
   * @param results - Multiple match results
   * @returns Combined match result
   *
   * @example
   * ```typescript
   * matcher: (entity: HassEntity) => {
   *   return CombineMatchers.any(
   *     entity.entity_id.startsWith('light.') ? CardMatchResult.DOMAIN_EXACT_MATCH : CardMatchResult.NO_MATCH,
   *     entity.attributes.device_class === 'light' ? CardMatchResult.DEVICE_CLASS_MATCH : CardMatchResult.NO_MATCH,
   *     entity.attributes.manufacturer === 'philips' ? CardMatchResult.MANUFACTURER_MATCH : CardMatchResult.NO_MATCH
   *   );
   * }
   * ```
   */
  any: (...results: MatchResult[]): MatchResult => {
    const matching = results.filter((r) => r.match);
    if (matching.length > 0) {
      return {
        match: true,
        priority: Math.max(...matching.map((r) => r.priority)),
      };
    }
    return CardMatchResult.NO_MATCH;
  },
};

// 实体匹配器，更贴合实体数据结构
export const EntityMatchers = {
  /**
   * 匹配实体ID前缀
   */
  hasIdPrefix: (prefix: string, result: MatchResult) => {
    return (entity: HassEntity): MatchResult =>
      Matchers.startsWith(entity.entity_id, prefix, result);
  },

  /**
   * 匹配设备类别
   */
  hasDeviceClass: (deviceClass: string, result: MatchResult) => {
    return (entity: HassEntity): MatchResult =>
      Matchers.equals(entity.attributes.device_class, deviceClass, result);
  },

  /**
   * 匹配制造商
   */
  hasManufacturer: (manufacturer: string, result: MatchResult) => {
    return (entity: HassEntity): MatchResult =>
      Matchers.equals(entity.attributes.manufacturer, manufacturer, result);
  },

  /**
   * 匹配卡片类型
   */
  hasCardType: (cardType: string, result: MatchResult) => {
    return (entity: HassEntity): MatchResult =>
      Matchers.equals(entity.attributes.card_type, cardType, result);
  },

  /**
   * 匹配特定功能
   */
  hasFeature: (featureFlag: number, result: MatchResult) => {
    return (entity: HassEntity): MatchResult =>
      Matchers.hasBitFlag(entity.attributes.supported_features, featureFlag, result);
  },
};
