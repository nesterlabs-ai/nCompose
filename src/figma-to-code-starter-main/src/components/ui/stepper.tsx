import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const stepperStepVariants = cva(
  "flex items-center justify-center rounded-full text-sm font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "",
      },
      size: {
        default: "h-8 w-8",
        sm: "h-6 w-6 text-xs",
        lg: "h-10 w-10",
      },
      state: {
        default: "",
        active: "",
        completed: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      state: "default",
    },
  }
);

export interface StepperProps extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof stepperStepVariants> {
  steps?: Array<{ label: string; description?: string }>;
  currentStep?: number;
  orientation?: "horizontal" | "vertical";
}

const Stepper = React.forwardRef<HTMLDivElement, StepperProps>(
  ({ className, variant, size, steps = [], currentStep = 0, orientation = "horizontal", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex",
          orientation === "horizontal" ? "flex-row items-center" : "flex-col",
          className
        )}
        {...props}
      >
        {steps.map((step, index) => {
          const stepState = index < currentStep ? "completed" : index === currentStep ? "active" : "default";

          return (
            <React.Fragment key={index}>
              <div className={cn("flex items-center gap-2", orientation === "vertical" && "flex-row")}>
                <div
                  className={cn(stepperStepVariants({ variant, size, state: stepState }))}
                  aria-current={stepState === "active" ? "step" : undefined}
                >
                  {stepState === "completed" ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M11.5 3.5L5.25 10.5L2.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    index + 1
                  )}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{step.label}</span>
                  {step.description && (
                    <span className="text-xs opacity-60">{step.description}</span>
                  )}
                </div>
              </div>
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    orientation === "horizontal" ? "h-px flex-1 mx-2" : "w-px h-6 ml-4",
                    "bg-gray-300"
                  )}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  }
);
Stepper.displayName = "Stepper";

export { Stepper, stepperStepVariants };
