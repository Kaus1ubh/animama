import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";

export const LogoMark = () => {
  return (
    <img
      src="/brand/animama-mark.png"
      alt=""
      width={32}
      height={32}
      className="size-8 shrink-0 rounded-lg bg-[#faf8f5] object-contain"
    />
  );
};

export const Logo = () => {
  return (
    <Link
      to="/"
      aria-label="Animama"
      className="text-sidebar-foreground dark:text-sidebar-foreground relative z-20 flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-sm font-normal"
    >
      <LogoMark />
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        aria-hidden="true"
        className="bg-sidebar-foreground block h-8 w-[90px] shrink-0"
        style={{
          maskImage: "url(/brand/animama-wordmark.png)",
          maskSize: "contain",
          maskPosition: "center",
          maskRepeat: "no-repeat",
        }}
      />
    </Link>
  );
};

export const LogoIcon = () => {
  return (
    <Link
      to="/"
      aria-label="Animama"
      className="text-sidebar-foreground dark:text-sidebar-foreground relative z-20 flex items-center space-x-2 py-1 text-sm font-normal"
    >
      <LogoMark />
    </Link>
  );
};
