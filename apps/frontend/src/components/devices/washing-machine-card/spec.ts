import { CardComponent } from '@/types';
import { WashingMachineCard, type WashingMachineCardProps } from './WashingMachineCard';
import { EntityMatchers } from '../matching-system';
import { CombineMatchers } from '../matching-system';

const washingMachineCardSpec: CardComponent<WashingMachineCardProps> = {
  component: WashingMachineCard,
  meta: {
    id: 'third-party/washing-machine',
    name: '高级智能洗衣机',
    description: '提供智能洗衣机的控制功能',
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

    matcher: CombineMatchers.any(EntityMatchers.hasExactId('zone.home')),
  },
};
export { washingMachineCardSpec };
