import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const selectVariants = cva(
  "flex items-center justify-between rounded-md border bg-transparent px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "",
      },
      size: {
        default: "h-9",
        sm: "h-8 text-xs",
        lg: "h-10 text-base",
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

export interface SelectProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange">,
    VariantProps<typeof selectVariants> {
  value?: string;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  onValueChange?: (value: string) => void;
  open?: boolean;
  label?: string;
}

const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  ({ className, variant, size, state, value, placeholder = "Select...", options = [], onValueChange, open = false, label, ...props }, ref) => {
    const selectedOption = options.find(o => o.value === value);

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-sm font-medium leading-none">
            {label}
          </label>
        )}
        <button
          ref={ref}
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(selectVariants({ variant, size, state }), className)}
          {...props}
        >
          <span className={selectedOption ? "" : "opacity-50"}>
            {selectedOption?.label ?? placeholder}
          </span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {open && options.length > 0 && (
          <div className="mt-1 rounded-md border bg-white shadow-md">
            {options.map((option) => (
              <div
                key={option.value}
                className={cn(
                  "px-3 py-2 text-sm cursor-pointer hover:bg-gray-100",
                  value === option.value && "font-medium"
                )}
                onClick={() => onValueChange?.(option.value)}
              >
                {option.label}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
);
Select.displayName = "Select";

export { Select, selectVariants };
