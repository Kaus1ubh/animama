import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { publicResourceUrl } from "@/lib/resource-urls";

export const LogoMark = ({ className }: { className?: string }) => {
  return (
    <img
      src={publicResourceUrl("brand/animama-mark.png")}
      alt=""
      width={32}
      height={32}
      className={cn("size-8 shrink-0 object-contain", className)}
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
      <span
        aria-hidden="true"
        className="bg-sidebar-foreground block h-8 w-[90px] shrink-0"
        style={{
          maskImage: `url(${publicResourceUrl("brand/animama-wordmark.png")})`,
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
