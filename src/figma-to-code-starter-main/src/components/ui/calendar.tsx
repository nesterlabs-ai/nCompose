import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const calendarVariants = cva(
  "p-3 rounded-md border",
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

const calendarDayVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default: "",
      },
      size: {
        default: "h-8 w-8",
        sm: "h-7 w-7 text-xs",
        lg: "h-9 w-9",
      },
      state: {
        default: "",
        selected: "",
        today: "",
        disabled: "opacity-50 pointer-events-none",
        "range-start": "",
        "range-middle": "",
        "range-end": "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      state: "default",
    },
  }
);

export interface CalendarProps extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof calendarVariants> {
  month?: number;
  year?: number;
  selectedDate?: number;
  todayDate?: number;
  onDateSelect?: (date: number) => void;
  weekStartsOn?: 0 | 1;
}

const DAYS_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function getDaysInMonth(month: number, year: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(month: number, year: number) {
  return new Date(year, month, 1).getDay();
}

const Calendar = React.forwardRef<HTMLDivElement, CalendarProps>(
  ({ className, variant, size, state, month = new Date().getMonth(), year = new Date().getFullYear(), selectedDate, todayDate, onDateSelect, ...props }, ref) => {
    const daysInMonth = getDaysInMonth(month, year);
    const firstDay = getFirstDayOfMonth(month, year);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const blanks = Array.from({ length: firstDay }, (_, i) => i);

    return (
      <div ref={ref} className={cn(calendarVariants({ variant, size, state }), className)} {...props}>
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <button type="button" className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:opacity-70">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7.5 9L4.5 6L7.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span className="text-sm font-medium">
            {MONTHS[month]} {year}
          </span>
          <button type="button" className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:opacity-70">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAYS_SHORT.map((day) => (
            <div key={day} className="flex items-center justify-center h-8 w-8 text-xs font-medium opacity-50">
              {day}
            </div>
          ))}
        </div>

        {/* Days grid */}
        <div className="grid grid-cols-7 gap-1">
          {blanks.map((i) => (
            <div key={`blank-${i}`} className="h-8 w-8" />
          ))}
          {days.map((day) => {
            let dayState: string = "default";
            if (day === selectedDate) dayState = "selected";
            else if (day === todayDate) dayState = "today";

            return (
              <button
                key={day}
                type="button"
                className={cn(calendarDayVariants({ variant, size: size || "default", state: dayState as any }))}
                onClick={() => onDateSelect?.(day)}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
);
Calendar.displayName = "Calendar";

export { Calendar, calendarVariants, calendarDayVariants };
