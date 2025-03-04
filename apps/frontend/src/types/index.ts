import { HassEntity } from 'home-assistant-js-websocket';

interface MatchResult {
  match: boolean;
  priority: number; // 0-100，数字越大优先级越高
}

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
    matcher: (entity: HassEntity) => MatchResult;
  };
}

export type { MatchResult, CardComponent };
