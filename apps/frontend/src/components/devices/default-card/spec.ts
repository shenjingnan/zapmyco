import { CardComponent } from '../types';
import { DefaultCard, type DefaultCardProps } from './DefaultCard';
import { CardMatchResult } from '../constants';

const defaultCardSpec: CardComponent<DefaultCardProps> = {
  component: DefaultCard,
  meta: {
    id: 'default-card',
    name: '默认设备卡片',
    description: '用于显示无特定卡片的设备',
    defaultSize: { width: 2, height: 2 },
    matcher: () => CardMatchResult.DEFAULT_CARD,
  },
};

export { defaultCardSpec };
