import { CardComponent } from '@/types';
import { EntityMatchers, CombineMatchers } from '@/components/devices/matching-system';
import { WeatherCard, type WeatherCardProps } from './WeatherCard';

const weatherCardSpec: CardComponent<WeatherCardProps> = {
  component: WeatherCard,
  meta: {
    id: 'third-party/weather',
    name: '高级智能天气',
    description: '提供智能天气的控制功能',
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

    matcher: CombineMatchers.any(EntityMatchers.hasExactId('person.nemo2')),
  },
};
export { weatherCardSpec };
