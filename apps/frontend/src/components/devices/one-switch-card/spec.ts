import { CardComponent } from '@/types';
import { OneSwitchCard, type OneSwitchCardProps } from './OneSwitchCard';
import { CombineMatchers, EntityMatchers } from '../matching-system';

const oneSwitchCardSpec: CardComponent<OneSwitchCardProps> = {
  component: OneSwitchCard,
  meta: {
    id: 'third-party/smart-one-switch',
    name: '高级智能单开关控制',
    description: '提供智能单开关的控制功能',
    author: 'Third Party Company',
    version: '1.0.0',
    defaultSize: {
      width: 1,
      height: 1,
    },

    sizes: {
      compact: { width: 1, height: 1 },
      large: { width: 3, height: 2 },
    },

    matcher: CombineMatchers.any(
      EntityMatchers.hasExactId('sensor.xiaomi_cn_1143886953_hub1_wifi_ssid_p_2_3')
    ),
  },
};
export { oneSwitchCardSpec };
