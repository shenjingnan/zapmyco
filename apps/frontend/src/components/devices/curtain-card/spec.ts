import { CardComponent } from '@/types';
import { CurtainCard, type CurtainCardProps } from './CurtainCard';
import { CombineMatchers, EntityMatchers } from '../matching-system';

const curtainCardSpec: CardComponent<CurtainCardProps> = {
  component: CurtainCard,
  meta: {
    id: 'third-party/smart-curtain',
    name: '高级智能窗帘控制',
    description: '提供智能窗帘的高级控制功能',
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

    matcher: CombineMatchers.any(
      EntityMatchers.hasExactId('event.xiaomi_cn_1143886953_hub1_network_changed_e_2_2')
    ),
  },
};
export { curtainCardSpec };
