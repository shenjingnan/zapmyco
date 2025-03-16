import { LogOut } from 'lucide-react';
import { ServiceCard, type HassEntity } from '@zapmyco/ui';

interface OneSwitchCardProps {
  entity: HassEntity;
}

const OneSwitchCard: React.FC<OneSwitchCardProps> = (props) => {
  const { entity } = props;

  return (
    <ServiceCard entity={entity}>
      <div className="flex size-full items-center justify-center">
        {/* <Power className="size-full" /> */}
        <LogOut className="size-full" />
      </div>
    </ServiceCard>
  );
};

export { type OneSwitchCardProps, OneSwitchCard };
