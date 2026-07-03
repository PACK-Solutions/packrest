import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Combine class names with conflict resolution (later utilities win over
// earlier ones in the same Tailwind family).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Human-readable file size in French units (o / Ko / Mo), base-1024. Single
// source of truth for the file-size labels shown in the response viewer, the
// upload picker and the upload progress bar.
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
