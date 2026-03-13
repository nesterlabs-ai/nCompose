import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const checkboxVariants = cva(
  "peer shrink-0 border rounded-sm flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
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

export interface CheckboxProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange">,
    VariantProps<typeof checkboxVariants> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: string;
}

const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, variant, size, state, checked = false, onCheckedChange, label, ...props }, ref) => {
    return (
      <div className="flex items-center gap-2">
        <button
          ref={ref}
          type="button"
          role="checkbox"
          aria-checked={checked}
          data-state={checked ? "checked" : "unchecked"}
          className={cn(checkboxVariants({ variant, size, state }), className)}
          onClick={() => onCheckedChange?.(!checked)}
          {...props}
        >
          {checked && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M8.5 2.5L3.75 7.5L1.5 5.25"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
        {label && (
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {label}
          </label>
        )}
      </div>
    );
  }
);
Checkbox.displayName = "Checkbox";

export { Checkbox, checkboxVariants };
