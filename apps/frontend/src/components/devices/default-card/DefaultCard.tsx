import { HassEntity } from 'home-assistant-js-websocket';
import { ServiceCard } from '@/components/devices/ServiceCard';

interface DefaultCardProps {
  entity: HassEntity;
}
const DefaultCard: React.FC<DefaultCardProps> = (props) => {
  const { entity } = props;

  return (
    <ServiceCard entity={entity}>
      <div className="h-full">
        <p className="line-clamp-2">{entity.entity_id}</p>
        <p className="line-clamp-2">{entity.attributes.friendly_name}</p>
      </div>
    </ServiceCard>
  );
};

export { type DefaultCardProps, DefaultCard };
