import { HassEntity } from 'home-assistant-js-websocket';
import { twMerge } from 'tailwind-merge';
import { Card } from '@/components/ui/card';
import clsx from 'clsx';

interface ServiceCardProps {
  entity: HassEntity;
  children: React.ReactNode;
  className?: string;
}

export const ServiceCard: React.FC<ServiceCardProps> = ({ entity, children, className }) => {
  return (
    <Card
      className={twMerge(
        clsx(
          'group relative h-full w-full max-w-sm bg-white p-4',
          {
            'cursor-not-allowed opacity-50': entity.state === 'unavailable',
          },
          className
        )
      )}
    >
      {children}

      {entity.state === 'unavailable' && (
        <div className="invisible absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-3 py-1 text-sm text-white transition-all duration-200 group-hover:visible">
          当前不可用
        </div>
      )}
    </Card>
  );
};
