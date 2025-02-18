import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { Sun as SunIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center p-1 bg-gray-200 rounded-lg cursor-pointer",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-10 w-full grow overflow-hidden rounded-lg">
      <SliderPrimitive.Range className="absolute h-full bg-white" />
    </SliderPrimitive.Track>
    <SunIcon className="w-5 h-5 text-gray-500 absolute left-4" />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
