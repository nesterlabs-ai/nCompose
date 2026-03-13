import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const radioVariants = cva(
  "shrink-0 rounded-full border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "",
      },
      size: {
        default: "h-4 w-4",
        sm: "h-3.5 w-3.5",
        lg: "h-5 w-5",
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

export interface RadioProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange">,
    VariantProps<typeof radioVariants> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: string;
  value?: string;
}

const Radio = React.forwardRef<HTMLButtonElement, RadioProps>(
  ({ className, variant, size, state, checked = false, onCheckedChange, label, value, ...props }, ref) => {
    return (
      <div className="flex items-center gap-2">
        <button
          ref={ref}
          type="button"
          role="radio"
          aria-checked={checked}
          data-state={checked ? "checked" : "unchecked"}
          data-value={value}
          className={cn(radioVariants({ variant, size, state }), className)}
          onClick={() => onCheckedChange?.(!checked)}
          {...props}
        >
          {checked && (
            <span className="block rounded-full bg-current" style={{ width: '40%', height: '40%' }} />
          )}
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
Radio.displayName = "Radio";

const RadioGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { orientation?: "horizontal" | "vertical" }
>(({ className, orientation = "vertical", ...props }, ref) => (
  <div
    ref={ref}
    role="radiogroup"
    className={cn(
      "flex",
      orientation === "vertical" ? "flex-col gap-2" : "flex-row gap-4",
      className
    )}
    {...props}
  />
));
RadioGroup.displayName = "RadioGroup";

export { Radio, RadioGroup, radioVariants };
