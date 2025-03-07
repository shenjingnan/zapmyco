import { CardComponent } from '@/types';
import { HumidifierCard, type HumidifierCardProps } from './HumidifierCard';
import { CombineMatchers, EntityMatchers } from '../matching-system';

const humidifierCardSpec: CardComponent<HumidifierCardProps> = {
  component: HumidifierCard,
  meta: {
    id: 'third-party/smart-humidifier',
    name: '高级智能加湿器控制',
    description: '提供智能加湿器的控制功能',
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
      EntityMatchers.hasExactId('sensor.linp_cn_blt_3_1kd89jrngco00_es2_illumination_p_2_1005')
    ),
  },
};
export { humidifierCardSpec };
