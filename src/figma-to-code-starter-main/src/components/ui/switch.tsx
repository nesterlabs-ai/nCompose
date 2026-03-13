import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const switchVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "",
      },
      size: {
        default: "h-5 w-9",
        sm: "h-4 w-7",
        lg: "h-6 w-11",
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

const thumbSizeMap = {
  default: "h-4 w-4",
  sm: "h-3 w-3",
  lg: "h-5 w-5",
} as const;

const thumbTranslateMap = {
  default: "translate-x-4",
  sm: "translate-x-3",
  lg: "translate-x-5",
} as const;

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange">,
    VariantProps<typeof switchVariants> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: string;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, variant, size, state, checked = false, onCheckedChange, label, ...props }, ref) => {
    const sizeKey = size || "default";
    const thumbSize = thumbSizeMap[sizeKey as keyof typeof thumbSizeMap] || thumbSizeMap.default;
    const thumbTranslate = thumbTranslateMap[sizeKey as keyof typeof thumbTranslateMap] || thumbTranslateMap.default;

    return (
      <div className="flex items-center gap-2">
        <button
          ref={ref}
          type="button"
          role="switch"
          aria-checked={checked}
          data-state={checked ? "checked" : "unchecked"}
          className={cn(switchVariants({ variant, size, state }), className)}
          onClick={() => onCheckedChange?.(!checked)}
          {...props}
        >
          <span
            className={cn(
              "pointer-events-none block rounded-full bg-white shadow-lg ring-0 transition-transform",
              thumbSize,
              checked ? thumbTranslate : "translate-x-0"
            )}
          />
        </button>
        {label && (
          <label className="text-sm font-medium leading-none">
            {label}
          </label>
        )}
      </div>
    );
  }
);
Switch.displayName = "Switch";

export { Switch, switchVariants };
