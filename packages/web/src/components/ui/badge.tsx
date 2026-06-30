import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-normal transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[#111111] text-white hover:bg-[#111111]/80",
        secondary: "bg-secondary text-secondary-foreground border border-[#dedbd6] hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        episodic: "border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
        semantic: "border-transparent bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
        procedural: "border-transparent bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
        working: "border-transparent bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
