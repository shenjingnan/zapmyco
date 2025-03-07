import { CardComponent } from '@/types';
import { SceneCard, type SceneCardProps } from './SceneCard';
import { CombineMatchers, EntityMatchers } from '../matching-system';

const sceneCardSpec: CardComponent<SceneCardProps> = {
  component: SceneCard,
  meta: {
    id: 'third-party/smart-scene',
    name: '高级智能场景控制',
    description: '提供智能场景的控制功能',
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
      EntityMatchers.hasExactId('sensor.linp_cn_blt_3_1kd89jrngco00_es2_no_one_duration_p_2_1079')
    ),
  },
};
export { sceneCardSpec };
