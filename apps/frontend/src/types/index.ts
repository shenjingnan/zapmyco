import { HassEntity } from 'home-assistant-js-websocket';

interface CardComponent<T> {
  component: React.FC<T>;
  meta: {
    id: string;
    name: string;
    description: string;
    author: string;
    version: string;
    defaultSize: {
      width: number;
      height: number;
    };
    sizes: {
      compact: { width: number; height: number };
      large: { width: number; height: number };
    };
    matcher: (entity: HassEntity) => boolean;
  };
}

export type { CardComponent };
