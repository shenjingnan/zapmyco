import { SunDim, Sun as SunIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider-ios';
import { Badge } from '@/components/ui/badge';
import { HassEntity } from 'home-assistant-js-websocket';
import { useHomeAssistant } from '@/use-home-assistant';
import { useState } from 'react';

const useColorTemp = (entity: HassEntity) => {
  const [minColorTempKelvin, maxColorTempKelvin, colorTempKelvin] = [
    entity.attributes.min_color_temp_kelvin,
    entity.attributes.max_color_temp_kelvin,
    entity.attributes.color_temp_kelvin,
  ];
  const [colorTemp] = useState(minColorTempKelvin);
  const isSupported = entity.attributes.supported_color_modes.includes('color_temp');

  if (!isSupported) {
    return {
      isSupported,
    };
  }

  return { colorTemp, isSupported, minColorTempKelvin, maxColorTempKelvin, colorTempKelvin };
};

interface LightCardProps {
  entity: HassEntity;
}

const LightCard = (props: Readonly<LightCardProps>) => {
  const { entity } = props;
  const {
    toggleLight: _toggleLight,
    changeLightColorTemp: _changeLightColorTemp,
    changeLightBrightness: _changeLightBrightness,
  } = useHomeAssistant();
  console.log('nemo entity', entity);
  const { isSupported: isColorTempSupported } = useColorTemp(entity);

  const toggleLight = () => {
    _toggleLight(entity.entity_id);
  };

  const handleBrightnessChange = (value: number[]) => {
    _changeLightBrightness(entity.entity_id, value[0]);
  };

  const handleColorTempChange = (value: number[]) => {
    _changeLightColorTemp(entity.entity_id, value[0]);
  };

  return (
    <Card className={`h-full w-full max-w-sm p-4 ${entity.state === 'on' ? 'bg-amber-50' : ''}`}>
      <div className="h-full overflow-hidden">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <Badge variant="secondary" className="mb-2">
              主卧室
            </Badge>
            <h3 className="text-lg font-semibold">{entity.attributes.friendly_name}</h3>
          </div>
          <div className="flex items-center space-x-2">
            <button
              className={`flex size-10 items-center justify-center rounded-full ${
                entity.state === 'on' ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-500'
              }`}
              onClick={toggleLight}
            >
              <SunIcon />
            </button>
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-gray-600">亮度</span>
            <span className="text-sm font-medium">80%</span>
          </div>
          <Slider
            defaultValue={[entity.attributes.brightness]}
            max={255}
            min={1}
            step={1}
            className="w-full"
            onValueChange={handleBrightnessChange}
          />
        </div>

        {isColorTempSupported && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-gray-600">色温</span>
              <span className="text-sm font-medium">{entity.attributes.color_temp_kelvin}K</span>
            </div>
            <div className="relative">
              <Slider
                defaultValue={[entity.attributes.color_temp]}
                max={entity.attributes.max_color_temp_kelvin}
                min={entity.attributes.min_color_temp_kelvin}
                step={1}
                className="w-full"
                onValueChange={handleColorTempChange}
              />
              <div className="mt-1 flex justify-between">
                <SunDim className="h-4 w-4 text-amber-400" />
                <SunDim className="h-4 w-4 text-blue-400" />
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};

export default LightCard;
