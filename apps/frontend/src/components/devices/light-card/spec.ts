import { CardComponent } from '@/components/devices/types';
import { LightCard, type LightCardProps } from '@/components/devices/light-card/LightCard';
import { EntityMatchers, CombineMatchers } from '@/components/devices/matching-system';

const lightCardSpec: CardComponent<LightCardProps> = {
  component: LightCard,
  meta: {
    id: 'third-party/smart-light',
    name: '智能灯控制',
    description: '提供智能灯的高级控制功能',
    author: 'BuildingOS',
    version: '1.0.0',
    defaultSize: { width: 4, height: 4 },
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
