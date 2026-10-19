export type BrandLogoVariant = "horizontal" | "compact" | "symbol";
export type BrandLogoSize = "sm" | "md" | "lg";
export type BrandLogoTheme = "dark" | "light";

export interface BrandLogoProps {
  variant?: BrandLogoVariant;
  size?: BrandLogoSize;
  theme?: BrandLogoTheme;
  showSubtitle?: boolean;
  className?: string;
}

const SYMBOL_SIZE: Record<BrandLogoSize, number> = {
  sm: 28,
  md: 36,
  lg: 48,
};

const WORDMARK_SIZE: Record<BrandLogoSize, string> = {
  sm: "text-[0.95rem]",
  md: "text-base",
  lg: "text-xl",
};

const SUBTITLE_SIZE: Record<BrandLogoSize, string> = {
  sm: "text-[0.65rem]",
  md: "text-[0.7rem]",
  lg: "text-sm",
};

const GAP: Record<BrandLogoSize, string> = {
  sm: "gap-2",
  md: "gap-2.5",
  lg: "gap-3",
};

export function BrandLogo({
  variant = "horizontal",
  size = "md",
  theme = "dark",
  showSubtitle = true,
  className = "",
}: BrandLogoProps) {
  const px = SYMBOL_SIZE[size];
  const isDark = theme === "dark";
  const wordmarkClass = isDark ? "text-white" : "text-[#071B1D]";
  const subtitleClass = isDark ? "text-[#CBD5D7]" : "text-slate-500";

  if (variant === "symbol") {
    return (
      <img
        src="/brand/nyora-symbol.svg"
        alt="NYORA"
        width={px}
        height={px}
        className={`block shrink-0 ${className}`}
        draggable={false}
      />
    );
  }

  return (
    <div className={`flex min-w-0 items-center ${GAP[size]} ${className}`}>
      <img
        src="/brand/nyora-symbol.svg"
        alt=""
        aria-hidden
        width={px}
        height={px}
        className="block shrink-0"
        draggable={false}
      />
      <div className="min-w-0 leading-none">
        <div
          className={`truncate font-semibold tracking-[0.15em] ${wordmarkClass} ${WORDMARK_SIZE[size]}`}
        >
          NYORA
        </div>
        {variant === "horizontal" && showSubtitle && (
          <div
            className={`mt-1 truncate font-normal tracking-[0.06em] ${subtitleClass} ${SUBTITLE_SIZE[size]}`}
          >
            Gestión Integral
          </div>
        )}
      </div>
    </div>
  );
}
