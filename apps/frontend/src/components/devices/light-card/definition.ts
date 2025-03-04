import { CardComponent } from '@/types';
import { LightCard, type LightCardProps } from './LightCard';
import { HassEntity } from 'home-assistant-js-websocket';

const definition: CardComponent<LightCardProps> = {
  component: LightCard,
  meta: {
    id: 'third-party/smart-light',
    name: '高级智能灯控制',
    description: '提供智能灯的高级控制功能',
    author: 'Third Party Company',
    version: '1.0.0',
    defaultSize: {
      width: 4,
      height: 4,
    },

    sizes: {
      compact: { width: 1, height: 1 },
      large: { width: 3, height: 2 },
    },

    matcher: (entity: HassEntity) => {
      if (['switch', 'light', 'input_boolean'].includes(entity.entity_id.split('.', 1)[0])) {
        return true;
      }
      return false;
      // // 精确匹配
      // if (entity.attributes.card_type === 'third-party/smart-light') {
      //   return { match: true, priority: 100 };
      // }

      // // 功能匹配
      // if (entity.entity_id.startsWith('light.')) {
      //   return { match: true, priority: 50 };
      // }

      // // 属性匹配
      // if (entity.attributes.device_class === 'light') {
      //   return { match: true, priority: 30 };
      // }

      // // 制造商匹配
      // if (entity.attributes.manufacturer === 'third-party-company') {
      //   return { match: true, priority: 20 };
      // }

      // return { match: false, priority: 0 };
    },
  },
};
export { definition };
