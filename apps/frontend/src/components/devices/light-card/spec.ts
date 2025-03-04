import { CardComponent } from '../types';
import { LightCard, type LightCardProps } from './LightCard';
import { CardMatchResult, EntityMatchers, CombineMatchers } from '../matching-system';

const lightCardSpec: CardComponent<LightCardProps> = {
  component: LightCard,
  meta: {
    id: 'light-card',
    name: '智能灯控制',
    description: '提供智能灯的高级控制功能',
    author: 'BuildingOS',
    version: '1.0.0',
    defaultSize: { width: 2, height: 2 },
    matcher: CombineMatchers.any(
      EntityMatchers.hasCardType('light-card'),
      EntityMatchers.hasIdPrefix('light'),
      EntityMatchers.hasDeviceClass('light'),
      EntityMatchers.hasFeature(4),
      EntityMatchers.hasManufacturer('philips')
    ),
  },
};

export { lightCardSpec };
