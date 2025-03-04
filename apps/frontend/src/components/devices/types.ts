import { HassEntity } from 'home-assistant-js-websocket';
import React from 'react';

// 匹配结果类型
export interface MatchResult {
  match: boolean;
  priority: number; // 0-100，数字越大优先级越高
}

// 卡片组件接口
export interface CardComponent<P> {
  component: React.ComponentType<P>;
  meta: {
    id: string;
    name: string;
    description?: string;
    author?: string;
    version?: string;
    defaultSize: { width: number; height: number };
    sizes?: Record<string, { width: number; height: number }>;
    matcher: (entity: HassEntity) => MatchResult;
  };
}
