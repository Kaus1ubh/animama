import type { CSSProperties, ImgHTMLAttributes } from "react";

type NativeImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "alt" | "src"
>;

export type AppImageProps = NativeImageProps & {
  alt: string;
  src: string;
  priority?: boolean;
  fill?: boolean;
  quality?: number;
  placeholder?: "blur" | "empty";
  blurDataURL?: string;
  unoptimized?: boolean;
};

const fillStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  height: "100%",
  width: "100%",
};

export function AppImage({
  alt,
  src,
  priority = false,
  fill = false,
  quality,
  placeholder,
  blurDataURL,
  unoptimized,
  loading,
  decoding,
  style,
  ...props
}: AppImageProps) {
  void quality;
  void placeholder;
  void blurDataURL;
  void unoptimized;

  return (
    <img
      alt={alt}
      src={src}
      loading={priority ? "eager" : (loading ?? "lazy")}
      decoding={priority ? "sync" : (decoding ?? "async")}
      style={fill ? { ...fillStyle, ...style } : style}
      {...props}
    />
  );
}
