import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const tooltipVariants = cva(
  "z-50 overflow-hidden rounded-md px-3 py-1.5 text-xs shadow-md",
  {
    variants: {
      variant: {
        default: "",
      },
      size: {
        default: "",
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

export interface TooltipProps extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof tooltipVariants> {
  content?: string;
  visible?: boolean;
  position?: "top" | "bottom" | "left" | "right";
}

const Tooltip = React.forwardRef<HTMLDivElement, TooltipProps>(
  ({ className, variant, size, state, content, visible = true, position = "top", children, ...props }, ref) => {
    return (
      <div ref={ref} className="relative inline-flex" {...props}>
        {children}
        {visible && content && (
          <div
            className={cn(
              tooltipVariants({ variant, size, state }),
              position === "top" && "absolute bottom-full left-1/2 -translate-x-1/2 mb-2",
              position === "bottom" && "absolute top-full left-1/2 -translate-x-1/2 mt-2",
              position === "left" && "absolute right-full top-1/2 -translate-y-1/2 mr-2",
              position === "right" && "absolute left-full top-1/2 -translate-y-1/2 ml-2",
              className
            )}
          >
            {content}
          </div>
        )}
      </div>
    );
  }
);
Tooltip.displayName = "Tooltip";

export { Tooltip, tooltipVariants };
