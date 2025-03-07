import { CardComponent } from '@/types';
import { AutomationCard, type AutomationCardProps } from './AutomationCard';
import { CombineMatchers, EntityMatchers } from '../matching-system';

const automationCardSpec: CardComponent<AutomationCardProps> = {
  component: AutomationCard,
  meta: {
    id: 'third-party/smart-automation',
    name: '高级智能自动化控制',
    description: '提供智能自动化的高级控制功能',
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
      EntityMatchers.hasExactId('event.linp_cn_blt_3_1kd89jrngco00_es2_device_be_reset_e_2_1028')
    ),
  },
};
export { automationCardSpec };
