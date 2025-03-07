import { CardComponent } from '@/types';
import { EnergyCard, type EnergyCardProps } from './EnergyCard';
import { CombineMatchers, EntityMatchers } from '../matching-system';

const energyCardSpec: CardComponent<EnergyCardProps> = {
  component: EnergyCard,
  meta: {
    id: 'third-party/smart-energy',
    name: '高级智能能源控制',
    description: '提供智能能源的高级控制功能',
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
      EntityMatchers.hasExactId('sensor.linp_cn_blt_3_1kd89jrngco00_es2_occupancy_status_p_2_1078')
    ),
  },
};
export { energyCardSpec };
