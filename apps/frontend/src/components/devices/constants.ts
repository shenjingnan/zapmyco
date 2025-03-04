import { MatchResult } from './types';

// 卡片匹配结果常量
export const CardMatchResult = {
  // 不匹配
  NO_MATCH: { match: false, priority: 0 },

  // 默认卡片（最低优先级）
  DEFAULT_CARD: { match: true, priority: 1 },

  // 模糊匹配（基于部分属性或特征）
  WEAK_MATCH: { match: true, priority: 10 },

  // 类别匹配（基于设备类别）
  CATEGORY_MATCH: { match: true, priority: 20 },

  // 功能匹配（基于功能特性）
  FEATURE_MATCH: { match: true, priority: 30 },

  // 制造商匹配（基于制造商信息）
  MANUFACTURER_MATCH: { match: true, priority: 40 },

  // 实体类型匹配（基于entity_id前缀）
  ENTITY_TYPE_MATCH: { match: true, priority: 50 },

  // 设备类型匹配（基于device_class）
  DEVICE_CLASS_MATCH: { match: true, priority: 60 },

  // 模型匹配（基于具体模型）
  MODEL_MATCH: { match: true, priority: 70 },

  // 域名精确匹配（比如专为灯、开关等领域设计的卡片）
  DOMAIN_EXACT_MATCH: { match: true, priority: 80 },

  // ID精确匹配（基于实体ID）
  ID_EXACT_MATCH: { match: true, priority: 90 },

  // 用户指定卡片（最高优先级）
  USER_SPECIFIED: { match: true, priority: 100 },

  // 创建自定义优先级
  custom: (priority: number): MatchResult => ({ match: true, priority }),
};
