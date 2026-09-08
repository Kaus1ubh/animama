import { motion, type Variants } from "motion/react";

import { cn } from "../lib/utils";

export type MessageLoaderAnimation = "scale" | "fade";

/** Renders the shared three-dot assistant waiting indicator. */
function LoadingThreeDotsPulse({
  animation = "scale",
  className,
}: {
  animation?: MessageLoaderAnimation;
  className?: string;
}) {
  const dotVariants: Variants =
    animation === "fade"
      ? {
          pulse: {
            opacity: [0.35, 1, 0.35],
            transition: {
              duration: 1.2,
              repeat: Infinity,
              ease: "easeInOut",
            },
          },
        }
      : {
          pulse: {
            scale: [1, 1.5, 1],
            transition: {
              duration: 1.2,
              repeat: Infinity,
              ease: "easeInOut",
            },
          },
        };

  return (
    <motion.div
      animate="pulse"
      transition={{ staggerChildren: -0.2, staggerDirection: -1 }}
      className={cn("flex items-center justify-center gap-2", className)}
    >
      <motion.div
        className="bg-muted-foreground/45 h-1.5 w-1.5 rounded-full will-change-transform"
        variants={dotVariants}
      />
      <motion.div
        className="bg-muted-foreground/45 h-1.5 w-1.5 rounded-full will-change-transform"
        variants={dotVariants}
      />
      <motion.div
        className="bg-muted-foreground/45 h-1.5 w-1.5 rounded-full will-change-transform"
        variants={dotVariants}
      />
    </motion.div>
  );
}

export default LoadingThreeDotsPulse;
