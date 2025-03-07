import React from 'react';
import { HassEntity } from 'home-assistant-js-websocket';
import { cardRegistry, DefaultCard } from '@/components/devices';

interface DynamicCardRendererProps {
  entity: HassEntity;
  config?: Record<string, unknown>;
}

interface CardProps {
  entity: HassEntity;
  config?: Record<string, unknown>;
}

export const DynamicCardRenderer: React.FC<DynamicCardRendererProps> = ({
  entity,
  config = {},
}) => {
  const matchedCardContent = cardRegistry.findCardForEntity(entity);

  if (!matchedCardContent) {
    return <DefaultCard entity={entity} />;
  }

  const CardComponent = matchedCardContent.component as React.ComponentType<CardProps>;

  return <CardComponent entity={entity} config={config} />;
};
