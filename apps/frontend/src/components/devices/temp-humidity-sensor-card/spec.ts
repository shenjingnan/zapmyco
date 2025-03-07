import { CardComponent } from '@/types';
import { TempHumiditySensorCard, type TempHumiditySensorCardProps } from './TempHumiditySensorCard';
import { CombineMatchers, EntityMatchers } from '../matching-system';

const tempHumiditySensorCardSpec: CardComponent<TempHumiditySensorCardProps> = {
  component: TempHumiditySensorCard,
  meta: {
    id: 'third-party/temp-humidity-sensor',
    name: '高级智能温湿度传感器',
    description: '提供智能温湿度传感器的控制功能',
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
      EntityMatchers.hasExactId(
        'sensor.linp_cn_blt_3_1kd89jrngco00_es2_has_someone_duration_p_2_1080'
      )
    ),
  },
};
export { tempHumiditySensorCardSpec };
