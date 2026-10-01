import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * The Aitally mark: a five-bar tally: four strokes crossed by a diagonal.
 *
 * Drawn on a 24×24 grid in `currentColor`, so it takes the colour of the
 * badge it sits in (`text-primary-foreground` on `bg-primary`).
 * `src/app/icon.svg` is the same mark with fixed colours, because a favicon
 * can't read CSS variables.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-5 w-5", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 5v14M10 5v14M14 5v14M18 5v14M3.5 16.5l17-9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
