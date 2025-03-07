import { CardComponent } from '@/types';
import { SecurityCard, type SecurityCardProps } from './SecurityCard';
import { CombineMatchers, EntityMatchers } from '../matching-system';

const securityCardSpec: CardComponent<SecurityCardProps> = {
  component: SecurityCard,
  meta: {
    id: 'third-party/smart-security',
    name: '高级智能安防控制',
    description: '提供智能安防的控制功能',
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

    matcher: CombineMatchers.any(EntityMatchers.hasExactId('scene.new_scene')),
  },
};
export { securityCardSpec };
