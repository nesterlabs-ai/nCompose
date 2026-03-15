import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const sliderVariants = cva(
  "relative flex w-full touch-none select-none items-center",
  {
    variants: {
      variant: {
        default: "",
      },
      size: {
        default: "h-5",
        sm: "h-4",
        lg: "h-6",
      },
      state: {
        default: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      state: "default",
    },
  }
);

export interface SliderProps extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof sliderVariants> {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  onValueChange?: (value: number) => void;
  label?: string;
  disabled?: boolean;
}

const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  ({ className, variant, size, state, value = 50, min = 0, max = 100, label, disabled = false, ...props }, ref) => {
    const percentage = ((value - min) / (max - min)) * 100;

    return (
      <div className={cn("flex flex-col gap-2", disabled && "opacity-50")} ref={ref} {...props}>
        {label && (
          <label className="text-sm font-medium leading-none">{label}</label>
        )}
        <div className={cn(sliderVariants({ variant, size, state }), className)}>
          {/* Track */}
          <div className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-gray-200">
            {/* Filled range */}
            <div
              className="absolute h-full rounded-full bg-current"
              style={{ width: `${percentage}%` }}
            />
          </div>
          {/* Thumb */}
          <div
            className="absolute block h-4 w-4 rounded-full border bg-white shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{ left: `calc(${percentage}% - 8px)` }}
          />
        </div>
      </div>
    );
  }
);
Slider.displayName = "Slider";

export { Slider, sliderVariants };
