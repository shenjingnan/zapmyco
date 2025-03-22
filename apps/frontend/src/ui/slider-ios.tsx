import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { Sun as SunIcon } from 'lucide-react';
import { cn } from '@/utils';

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      'relative flex w-full cursor-pointer touch-none select-none items-center rounded-lg bg-gray-200 p-1',
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-10 w-full grow overflow-hidden rounded-lg">
      <SliderPrimitive.Range className="absolute h-full bg-white" />
    </SliderPrimitive.Track>
    <SunIcon className="absolute left-4 h-5 w-5 text-gray-500" />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
