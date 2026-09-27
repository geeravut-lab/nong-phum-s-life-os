import { forwardRef } from "react";
import { Input } from "@/components/ui/input";

/**
 * Date and time inputs that always read as 24-hour, day-first.
 *
 * A bare <input type="datetime-local"> is rendered by the browser in the
 * operating system's locale, so the same page showed 9:23 AM and mm/dd/yyyy on
 * one machine and 09:23 and dd/mm/yyyy on another. Chrome and Edge honour the
 * element's lang attribute, and en-GB is the closest widely-supported locale
 * that is day-first with a 24-hour clock - which is how Thai users read a time.
 * (Firefox follows the OS and ignores lang; nothing in the page can change
 * that, so this is the best available lever rather than a guarantee.)
 *
 * step={60} drops the seconds spinner: nothing in this app schedules to the
 * second, and the extra field is one more thing to tab past.
 *
 * Using these instead of a raw Input is what keeps it consistent - the
 * attributes were being added by hand and forgotten on most of the fields.
 */

type Props = React.ComponentProps<typeof Input>;

export const DateTimeInput = forwardRef<HTMLInputElement, Props>(
  function DateTimeInput(props, ref) {
    return <Input ref={ref} type="datetime-local" step={60} lang="en-GB" {...props} />;
  },
);

export const DateInput = forwardRef<HTMLInputElement, Props>(function DateInput(props, ref) {
  return <Input ref={ref} type="date" lang="en-GB" {...props} />;
});

export const TimeInput = forwardRef<HTMLInputElement, Props>(function TimeInput(props, ref) {
  return <Input ref={ref} type="time" step={60} lang="en-GB" {...props} />;
});
