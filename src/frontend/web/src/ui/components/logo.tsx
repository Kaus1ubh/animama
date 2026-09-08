import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";

export const LogoMark = () => {
  return (
    <div className="bg-sidebar-foreground dark:bg-sidebar-foreground h-6 w-6 flex-shrink-0 rounded-tl-lg rounded-tr-sm rounded-br-lg rounded-bl-sm" />
  );
};

export const Logo = () => {
  return (
    <Link
      to="/"
      className="text-sidebar-foreground hover:bg-sidebar-accent/60 dark:text-sidebar-foreground relative z-20 flex h-11 flex-2 items-center gap-2 rounded-md px-2.5 text-sm font-normal"
    >
      <LogoMark />
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-sidebar-foreground dark:text-sidebar-foreground text-base font-medium whitespace-pre"
      >
        Anima
      </motion.span>
    </Link>
  );
};

export const LogoIcon = () => {
  return (
    <Link
      to="/"
      className="text-sidebar-foreground dark:text-sidebar-foreground relative z-20 flex items-center space-x-2 py-1 text-sm font-normal"
    >
      <LogoMark />
    </Link>
  );
};
