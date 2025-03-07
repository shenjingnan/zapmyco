import { CardComponent } from '@/types';
import { SmartPlugCard, type SmartPlugCardProps } from './SmartPlugCard';
import { CombineMatchers, EntityMatchers } from '../matching-system';

const smartPlugCardSpec: CardComponent<SmartPlugCardProps> = {
  component: SmartPlugCard,
  meta: {
    id: 'third-party/smart-plug',
    name: '高级智能插座控制',
    description: '提供智能插座的控制功能',
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

    matcher: CombineMatchers.any(EntityMatchers.hasExactId('conversation.home_assistant')),
  },
};
export { smartPlugCardSpec };
