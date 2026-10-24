/** The page's resolved content, served by `programPlugin`. */
declare module "virtual:landing-program" {
  const program: import("./program").StageProgram;
  export default program;
}
