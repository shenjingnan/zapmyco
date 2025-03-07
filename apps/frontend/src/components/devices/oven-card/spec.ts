import { CardComponent } from '@/types';
import { OvenCard, type OvenCardProps } from './OvenCard';
import { CombineMatchers, EntityMatchers } from '../matching-system';

const ovenCardSpec: CardComponent<OvenCardProps> = {
  component: OvenCard,
  meta: {
    id: 'third-party/smart-oven',
    name: '高级智能烤箱控制',
    description: '提供智能烤箱的控制功能',
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
      EntityMatchers.hasExactId('sensor.xiaomi_cn_1143886953_hub1_access_mode_p_2_1')
    ),
  },
};
export { ovenCardSpec };
