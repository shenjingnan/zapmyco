import React from 'react';
import { HassEntity } from 'home-assistant-js-websocket';
import { cardRegistry, DefaultCard } from '@/components/devices';

interface DynamicCardRendererProps {
  entity: HassEntity;
  size: { width: number; height: number };
  // 可以添加用户自定义配置
  config?: Record<string, any>;
}

export const DynamicCardRenderer: React.FC<DynamicCardRendererProps> = ({
  entity,
  size,
  config = {},
}) => {
  const matchedCard = cardRegistry.findCardForEntity(entity);

  if (!matchedCard) {
    return <DefaultCard entity={entity} />;
  }

  const CardComponent = matchedCard.component;

  // 将entity和用户配置传递给卡片组件
  return <CardComponent entity={entity} config={config} />;
};
