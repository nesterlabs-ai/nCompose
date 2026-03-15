import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const breadcrumbItemVariants = cva(
  "inline-flex items-center text-sm transition-colors",
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

export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement>,
  VariantProps<typeof breadcrumbItemVariants> {
  items?: Array<{ label: string; href?: string }>;
  separator?: string;
}

const Breadcrumb = React.forwardRef<HTMLElement, BreadcrumbProps>(
  ({ className, variant, items = [], separator, ...props }, ref) => {
    return (
      <nav ref={ref} aria-label="breadcrumb" className={cn("flex items-center", className)} {...props}>
        <ol className="flex items-center gap-1.5">
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            return (
              <React.Fragment key={index}>
                <li>
                  {isLast ? (
                    <span
                      className={cn(breadcrumbItemVariants({ variant, state: "active" }))}
                      aria-current="page"
                    >
                      {item.label}
                    </span>
                  ) : (
                    <a
                      href={item.href || "#"}
                      className={cn(breadcrumbItemVariants({ variant, state: "default" }))}
                    >
                      {item.label}
                    </a>
                  )}
                </li>
                {!isLast && (
                  <li role="presentation" className="opacity-50">
                    {separator || (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </li>
                )}
              </React.Fragment>
            );
          })}
        </ol>
      </nav>
    );
  }
);
Breadcrumb.displayName = "Breadcrumb";

export { Breadcrumb, breadcrumbItemVariants };
