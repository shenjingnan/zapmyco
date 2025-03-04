import { CardComponent } from '../types';
import { ThermostatCard, type ThermostatCardProps } from './ThermostatCard';
import { CardMatchResult, EntityMatchers, CombineMatchers } from '../matching-system';

const thermostatCardSpec: CardComponent<ThermostatCardProps> = {
  component: ThermostatCard,
  meta: {
    id: 'thermostat-card',
    name: '智能温控器',
    description: '温度控制和调节',
    defaultSize: { width: 2, height: 4 },
    matcher: CombineMatchers.any(
      EntityMatchers.hasCardType('thermostat-card'),
      EntityMatchers.hasIdPrefix('climate.'),
      CombineMatchers.all(
        EntityMatchers.hasAttribute(
          'current_temperature',
          undefined,
          CardMatchResult.FEATURE_MATCH
        ),
        EntityMatchers.hasAttribute('target_temp_high', undefined, CardMatchResult.FEATURE_MATCH),
        EntityMatchers.hasAttribute('target_temp_low', undefined, CardMatchResult.FEATURE_MATCH)
      ),
      EntityMatchers.custom(
        (entity) => entity.entity_id.includes('temp') && entity.entity_id.includes('control'),
        CardMatchResult.WEAK_MATCH
      )
    ),
  },
};

export { thermostatCardSpec };
