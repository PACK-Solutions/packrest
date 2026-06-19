import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Combine class names with conflict resolution (later utilities win over
// earlier ones in the same Tailwind family).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
