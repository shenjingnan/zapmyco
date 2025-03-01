import { Card } from '@/components/ui/card';
import { HassEntity } from 'home-assistant-js-websocket';

interface DebugCardProps {
  entity: HassEntity;
}
const DebugCard = (props: Readonly<DebugCardProps>) => {
  const { entity } = props;

  return (
    <Card className={`h-full w-full p-4`}>
      <div className="h-full">
        <p className="line-clamp-2">{entity.attributes.friendly_name}</p>
      </div>
    </Card>
  );
};

export default DebugCard;
