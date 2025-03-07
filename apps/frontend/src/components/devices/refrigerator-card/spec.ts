import { CardComponent } from '@/types';
import { CombineMatchers, EntityMatchers } from '@/components/devices/matching-system';
import { RefrigeratorCard, type RefrigeratorCardProps } from './RefrigeratorCard';

const refrigeratorCardSpec: CardComponent<RefrigeratorCardProps> = {
  component: RefrigeratorCard,
  meta: {
    id: 'third-party/smart-refrigerator',
    name: '高级智能冰箱控制',
    description: '提供智能冰箱的控制功能',
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

    matcher: CombineMatchers.any(EntityMatchers.hasExactId('todo.shopping_list')),
  },
};
export { refrigeratorCardSpec };
