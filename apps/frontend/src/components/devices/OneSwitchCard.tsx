import { Card } from '@/components/ui/card';
import { HassEntity } from 'home-assistant-js-websocket';
import { LogOut, Power, PowerOff } from 'lucide-react';
import { useState } from 'react';

interface OneSwitchCardProps {
  entity: HassEntity;
}

const OneSwitchCard = (props: Readonly<OneSwitchCardProps>) => {
  const { entity } = props;
  const [isOn, setIsOn] = useState(false);

  return (
    <Card className="h-full w-full max-w-sm p-4">
      <div className="flex size-full items-center justify-center">
        {/* <Power className="size-full" /> */}
        <LogOut className="size-full" />
      </div>
    </Card>
  );
};

export default OneSwitchCard;
