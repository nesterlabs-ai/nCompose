import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const dropdownMenuVariants = cva(
  "z-50 min-w-[8rem] overflow-hidden rounded-md border p-1 shadow-md",
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

const dropdownMenuItemVariants = cva(
  "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
  {
    variants: {
      variant: {
        default: "",
        destructive: "",
      },
      state: {
        default: "",
        focused: "",
        disabled: "pointer-events-none opacity-50",
      },
    },
    defaultVariants: {
      variant: "default",
      state: "default",
    },
  }
);

export interface DropdownMenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  variant?: "default" | "destructive";
  disabled?: boolean;
  separator?: boolean;
}

export interface DropdownMenuProps extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof dropdownMenuVariants> {
  open?: boolean;
  trigger?: React.ReactNode;
  items?: DropdownMenuItem[];
  onSelect?: (label: string) => void;
  label?: string;
}

const DropdownMenu = React.forwardRef<HTMLDivElement, DropdownMenuProps>(
  ({ className, variant, size, state, open = true, trigger, items = [], onSelect, label, ...props }, ref) => {
    return (
      <div ref={ref} className="relative inline-block" {...props}>
        {trigger && (
          <div className="cursor-pointer">{trigger}</div>
        )}
        {open && (
          <div className={cn(dropdownMenuVariants({ variant, size, state }), className)}>
            {label && (
              <div className="px-2 py-1.5 text-xs font-semibold opacity-60">
                {label}
              </div>
            )}
            {items.map((item, index) => (
              <React.Fragment key={index}>
                {item.separator ? (
                  <div className="mx-1 my-1 h-px bg-gray-200" />
                ) : (
                  <div
                    className={cn(
                      dropdownMenuItemVariants({
                        variant: item.variant || "default",
                        state: item.disabled ? "disabled" : "default",
                      })
                    )}
                    onClick={() => !item.disabled && onSelect?.(item.label)}
                  >
                    {item.icon && (
                      <span className="mr-2 flex h-4 w-4 items-center justify-center">
                        {item.icon}
                      </span>
                    )}
                    <span className="flex-1">{item.label}</span>
                    {item.shortcut && (
                      <span className="ml-auto text-xs opacity-50">{item.shortcut}</span>
                    )}
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    );
  }
);
DropdownMenu.displayName = "DropdownMenu";

export { DropdownMenu, dropdownMenuVariants, dropdownMenuItemVariants };
