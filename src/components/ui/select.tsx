import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A native `<select>`, styled to match Input.
 *
 * Deliberately not a custom listbox: this is admin-only, the option lists are
 * short, and the native control gets keyboard handling, mobile pickers and
 * form-submission behaviour for free. It also submits inside a Server Action's
 * FormData without any client wiring.
 */
function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30',
        className
      )}
      {...props}
    />
  );
}

export { Select };
