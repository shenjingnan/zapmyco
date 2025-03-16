declare module '@zapmyco/ui' {
  import { HassEntity } from 'home-assistant-js-websocket';
  import React from 'react';

  export interface ServiceCardProps {
    entity: HassEntity;
    children: React.ReactNode;
    className?: string;
  }

  export const ServiceCard: React.FC<ServiceCardProps>;

  // 导出其他组件和类型...
  export type { HassEntity };
} 