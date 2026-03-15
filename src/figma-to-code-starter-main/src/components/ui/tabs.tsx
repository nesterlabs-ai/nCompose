import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const tabsListVariants = cva(
  "inline-flex items-center justify-center rounded-lg p-1",
  {
    variants: {
      variant: {
        default: "",
      },
      size: {
        default: "h-9",
        sm: "h-8",
        lg: "h-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const tabsTriggerVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "",
      },
      state: {
        default: "",
        active: "",
      },
    },
    defaultVariants: {
      variant: "default",
      state: "default",
    },
  }
);

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof tabsListVariants> {
  tabs?: Array<{ label: string; value: string }>;
  activeTab?: string;
  onTabChange?: (value: string) => void;
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ className, variant, size, tabs = [], activeTab, onTabChange, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("flex flex-col", className)} {...props}>
        <div className={cn(tabsListVariants({ variant, size }))}>
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.value}
              data-state={activeTab === tab.value ? "active" : "inactive"}
              className={cn(
                tabsTriggerVariants({
                  variant,
                  state: activeTab === tab.value ? "active" : "default",
                })
              )}
              onClick={() => onTabChange?.(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {children}
      </div>
    );
  }
);
Tabs.displayName = "Tabs";

export { Tabs, tabsListVariants, tabsTriggerVariants };
