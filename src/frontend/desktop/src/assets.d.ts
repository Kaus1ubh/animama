/** Binary assets esbuild inlines as data URLs (see scripts/build.mjs). */
declare module "*.png" {
  const dataUrl: string;
  export default dataUrl;
}
declare module "*.woff2" {
  const dataUrl: string;
  export default dataUrl;
}
