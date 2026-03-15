import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const paginationItemVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "",
      },
      size: {
        default: "h-9 w-9",
        sm: "h-8 w-8 text-xs",
        lg: "h-10 w-10",
      },
      state: {
        default: "",
        active: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      state: "default",
    },
  }
);

export interface PaginationProps extends React.HTMLAttributes<HTMLElement>,
  VariantProps<typeof paginationItemVariants> {
  totalPages?: number;
  currentPage?: number;
  onPageChange?: (page: number) => void;
}

const Pagination = React.forwardRef<HTMLElement, PaginationProps>(
  ({ className, variant, size, totalPages = 5, currentPage = 1, onPageChange, ...props }, ref) => {
    const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

    return (
      <nav ref={ref} role="navigation" aria-label="pagination" className={cn("flex items-center gap-1", className)} {...props}>
        {/* Previous */}
        <button
          type="button"
          className={cn(paginationItemVariants({ variant, size, state: "default" }))}
          onClick={() => onPageChange?.(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.5 9L4.5 6L7.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Page numbers */}
        {pages.map((page) => (
          <button
            key={page}
            type="button"
            aria-current={page === currentPage ? "page" : undefined}
            className={cn(
              paginationItemVariants({
                variant,
                size,
                state: page === currentPage ? "active" : "default",
              })
            )}
            onClick={() => onPageChange?.(page)}
          >
            {page}
          </button>
        ))}

        {/* Next */}
        <button
          type="button"
          className={cn(paginationItemVariants({ variant, size, state: "default" }))}
          onClick={() => onPageChange?.(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </nav>
    );
  }
);
Pagination.displayName = "Pagination";

export { Pagination, paginationItemVariants };
