import { CardComponent } from '@/types';
import { OccupancySensorCard, type OccupancySensorCardProps } from './OccupancySensorCard';
import { CombineMatchers, EntityMatchers } from '../matching-system';

const occupancySensorCardSpec: CardComponent<OccupancySensorCardProps> = {
  component: OccupancySensorCard,
  meta: {
    id: 'third-party/smart-occupancy-sensor',
    name: '高级智能人体感应器控制',
    description: '提供智能人体感应器的控制功能',
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
      EntityMatchers.hasExactId('event.xiaomi_cn_1143886953_hub1_virtual_event_e_4_1')
    ),
  },
};
export { occupancySensorCardSpec };
