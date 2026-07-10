import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// The one class-combiner: clsx for conditionals, twMerge so later Tailwind
// utilities win over earlier ones (shadcn convention).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
