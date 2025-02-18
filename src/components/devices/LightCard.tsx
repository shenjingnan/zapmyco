import { SunDim, Sun as SunIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider-ios';
import { Badge } from '@/components/ui/badge';
import { HassEntity } from 'home-assistant-js-websocket';
import { useState } from 'react';

type Props = {
  entity: HassEntity;
};
const LightCard = (props: Readonly<Props>) => {
  const { entity } = props;
  const [switchState, setSwitchState] = useState(false);

  return (
    <Card className={`col-span-2 w-full max-w-sm p-4 ${switchState ? 'bg-amber-50' : ''}`}>
      {/* 顶部信息区 */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <Badge variant="secondary" className="mb-2">
            主卧室
          </Badge>
          <h3 className="text-lg font-semibold">{entity.attributes.friendly_name}</h3>
        </div>
        <div className="flex items-center space-x-2">
          {/* <Lamp className="w-5 h-5 text-yellow-500" /> */}
          <button
            className={`flex size-10 cursor-pointer items-center justify-center rounded-full ${
              switchState ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-500'
            }`}
            onClick={() => setSwitchState(!switchState)}
          >
            <SunIcon />
          </button>
        </div>
      </div>

      {/* 亮度控制 */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm text-gray-600">亮度</span>
          <span className="text-sm font-medium">80%</span>
        </div>
        <Slider defaultValue={[80]} max={100} step={1} className="w-full" />
      </div>

      {/* 色温控制 */}
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
    </Card>
  );
};

export default LightCard;
