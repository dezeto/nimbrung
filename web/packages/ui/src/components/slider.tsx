import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "@web/ui/lib/utils";

type Props = SliderPrimitive.Root.Props<number> & { "aria-label": string };

/** A single-thumb slider; the label names the thumb's range input. */
function Slider({ className, "aria-label": label, ...props }: Props) {
  return (
    <SliderPrimitive.Root data-slot="slider" className={cn("data-disabled:opacity-50", className)} {...props}>
      <SliderPrimitive.Control className="relative flex h-6 w-full touch-none items-center select-none">
        <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden bg-muted">
          <SliderPrimitive.Indicator className="h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          getAriaLabel={() => label}
          className="block size-3.5 shrink-0 border border-primary bg-foreground ring-ring/50 transition-[box-shadow] select-none hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3"
        />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
