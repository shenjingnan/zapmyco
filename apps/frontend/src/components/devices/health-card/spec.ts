import { CardComponent } from '@/types';
import { HealthCard, type HealthCardProps } from './HealthCard';
import { CombineMatchers, EntityMatchers } from '../matching-system';

const healthCardSpec: CardComponent<HealthCardProps> = {
  component: HealthCard,
  meta: {
    id: 'third-party/smart-health',
    name: '高级智能健康控制',
    description: '提供智能健康的控制功能',
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
      EntityMatchers.hasExactId('sensor.xiaomi_cn_1143886953_hub1_ip_address_p_2_2')
    ),
  },
};
export { healthCardSpec };
