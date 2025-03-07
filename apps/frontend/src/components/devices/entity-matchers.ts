import { HassEntity } from 'home-assistant-js-websocket';
import { MatchResult } from '@/components/devices/types';
import { Matchers } from '@/components/devices/matchers';
import { CardMatchResult } from '@/components/devices/constants';

export const EntityMatchers = {
  /**
   * 匹配实体ID前缀
   * @param prefix 实体ID前缀
   * @param customPriority 可选的自定义优先级
   */
  hasIdPrefix: (prefix: string, customPriority?: MatchResult) => {
    return (entity: HassEntity): MatchResult =>
      Matchers.startsWith(
        entity.entity_id,
        prefix,
        customPriority || CardMatchResult.DOMAIN_EXACT_MATCH
      );
  },

  /**
   * 匹配实体ID完全相等
   * @param entityId 实体ID
   * @param customPriority 可选的自定义优先级
   */
  hasExactId: (entityId: string, customPriority?: MatchResult) => {
    return (entity: HassEntity): MatchResult =>
      Matchers.equals(entity.entity_id, entityId, customPriority || CardMatchResult.ID_EXACT_MATCH);
  },

  /**
   * 匹配设备类别
   * @param deviceClass 设备类别
   * @param customPriority 可选的自定义优先级
   */
  hasDeviceClass: (deviceClass: string, customPriority?: MatchResult) => {
    return (entity: HassEntity): MatchResult =>
      Matchers.equals(
        entity.attributes.device_class,
        deviceClass,
        customPriority || CardMatchResult.DEVICE_CLASS_MATCH
      );
  },

  /**
   * 匹配制造商
   * @param manufacturer 制造商
   * @param customPriority 可选的自定义优先级
   */
  hasManufacturer: (manufacturer: string, customPriority?: MatchResult) => {
    return (entity: HassEntity): MatchResult =>
      Matchers.equals(
        entity.attributes.manufacturer,
        manufacturer,
        customPriority || CardMatchResult.MANUFACTURER_MATCH
      );
  },

  /**
   * 匹配卡片类型
   * @param cardType 卡片类型
   * @param customPriority 可选的自定义优先级
   */
  hasCardType: (cardType: string, customPriority?: MatchResult) => {
    return (entity: HassEntity): MatchResult =>
      Matchers.equals(
        entity.attributes.card_type,
        cardType,
        customPriority || CardMatchResult.USER_SPECIFIED
      );
  },

  /**
   * 匹配特定功能标志
   * @param featureFlag 功能标志
   * @param customPriority 可选的自定义优先级
   */
  hasFeature: (featureFlag: number, customPriority?: MatchResult) => {
    return (entity: HassEntity): MatchResult =>
      Matchers.hasBitFlag(
        entity.attributes.supported_features,
        featureFlag,
        customPriority || CardMatchResult.FEATURE_MATCH
      );
  },

  /**
   * 匹配特定状态
   * @param state 状态值
   * @param result 匹配结果
   */
  hasState: (state: string, result: MatchResult) => {
    return (entity: HassEntity): MatchResult => Matchers.equals(entity.state, state, result);
  },

  /**
   * 匹配特定属性
   * @param key 属性名
   * @param value 属性值
   * @param result 匹配结果
   */
  hasAttribute: (key: string, value: unknown, result: MatchResult) => {
    return (entity: HassEntity): MatchResult =>
      Matchers.equals(entity.attributes[key], value, result);
  },

  /**
   * 检查是否存在特定属性
   * @param key 属性名
   * @param result 匹配结果
   */
  hasAttributeKey: (key: string, result: MatchResult) => {
    return (entity: HassEntity): MatchResult =>
      Matchers.hasProperty(entity.attributes, key, result);
  },

  /**
   * 自定义条件匹配
   * @param fn 自定义判断函数
   * @param result 匹配结果
   */
  custom: (fn: (entity: HassEntity) => boolean, result: MatchResult) => {
    return (entity: HassEntity): MatchResult => Matchers.when(fn(entity), result);
  },
};
