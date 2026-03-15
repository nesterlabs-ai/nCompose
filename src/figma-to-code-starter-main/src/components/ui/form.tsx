import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const formVariants = cva(
  "flex flex-col",
  {
    variants: {
      variant: {
        default: "",
      },
      size: {
        default: "gap-4",
        sm: "gap-3",
        lg: "gap-6",
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

const formFieldVariants = cva(
  "flex flex-col",
  {
    variants: {
      variant: {
        default: "",
      },
      size: {
        default: "gap-1.5",
        sm: "gap-1",
        lg: "gap-2",
      },
      state: {
        default: "",
        error: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      state: "default",
    },
  }
);

export interface FormFieldProps {
  label?: string;
  error?: string;
  helperText?: string;
  required?: boolean;
}

export interface FormProps extends React.FormHTMLAttributes<HTMLFormElement>,
  VariantProps<typeof formVariants> {
  title?: string;
  description?: string;
}

const Form = React.forwardRef<HTMLFormElement, FormProps>(
  ({ className, variant, size, state, title, description, children, ...props }, ref) => {
    return (
      <form ref={ref} className={cn(formVariants({ variant, size, state }), className)} {...props}>
        {(title || description) && (
          <div className="flex flex-col gap-1">
            {title && <h3 className="text-lg font-semibold">{title}</h3>}
            {description && <p className="text-sm opacity-60">{description}</p>}
          </div>
        )}
        {children}
      </form>
    );
  }
);
Form.displayName = "Form";

const FormField = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & FormFieldProps & VariantProps<typeof formFieldVariants>>(
  ({ className, variant, size, state, label, error, helperText, required, children, ...props }, ref) => {
    const fieldState = error ? "error" : (state || "default");

    return (
      <div ref={ref} className={cn(formFieldVariants({ variant, size, state: fieldState as any }), className)} {...props}>
        {label && (
          <label className="text-sm font-medium leading-none">
            {label}
            {required && <span className="ml-0.5 text-red-500">*</span>}
          </label>
        )}
        {children}
        {error && (
          <p className="text-xs text-red-500">{error}</p>
        )}
        {!error && helperText && (
          <p className="text-xs opacity-50">{helperText}</p>
        )}
      </div>
    );
  }
);
FormField.displayName = "FormField";

export { Form, FormField, formVariants, formFieldVariants };
