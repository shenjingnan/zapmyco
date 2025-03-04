import { CardComponent } from '@/types';
import { AirPurifierCard, type AirPurifierCardProps } from './AirPurifierCard';
import { HassEntity } from 'home-assistant-js-websocket';
import { CardMatchResult } from '../constants';
import { CombineMatchers, EntityMatchers } from '../matching-system';

const airPurifierCardSpec: CardComponent<AirPurifierCardProps> = {
  component: AirPurifierCard,
  meta: {
    id: 'third-party/smart-air-purifier',
    name: '高级智能空气净化器控制',
    description: '提供智能空气净化器的高级控制功能',
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
      EntityMatchers.hasExactId('notify.xiaomi_cn_1143886953_hub1_emit_virtual_event_a_4_1')
    ),
  },
};
export { airPurifierCardSpec };
