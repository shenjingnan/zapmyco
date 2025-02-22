import { SunDim, Sun as SunIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider-ios';
import { Badge } from '@/components/ui/badge';
import { HassEntity } from 'home-assistant-js-websocket';
import { useHomeAssistant } from '@/use-home-assistant';

interface LightCardProps {
  entity: HassEntity;
}

const LightCard = (props: Readonly<LightCardProps>) => {
  const { entity } = props;
  const { toggleLight: _toggleLight } = useHomeAssistant();

  const toggleLight = () => {
    _toggleLight(entity.entity_id);
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
          <Slider defaultValue={[80]} max={100} step={1} className="w-full" />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-gray-600">色温</span>
            <span className="text-sm font-medium">4500K</span>
          </div>
          <div className="relative">
            <Slider defaultValue={[50]} max={100} step={1} className="w-full" />
            <div className="mt-1 flex justify-between">
              <SunDim className="h-4 w-4 text-amber-400" />
              <SunDim className="h-4 w-4 text-blue-400" />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default LightCard;
