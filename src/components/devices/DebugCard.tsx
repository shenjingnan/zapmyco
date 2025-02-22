import { Card } from '@/components/ui/card';
import { withDraggable, WithDraggableProps } from '@/hocs/withDraggable';
import { HassEntity } from 'home-assistant-js-websocket';

interface DebugCardProps extends WithDraggableProps {
  entity: HassEntity;
}
const DebugCard = (props: Readonly<DebugCardProps>) => {
  const { entity, dragProps } = props;

  return (
    <Card {...dragProps} className={`h-full w-full p-4`}>
      <div className="h-full">
        <p className="line-clamp-2">{entity.attributes.friendly_name}</p>
      </div>
    </Card>
  );
};

export default DebugCard;
