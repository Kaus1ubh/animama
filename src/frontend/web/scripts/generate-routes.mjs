import { Generator, getConfig } from "@tanstack/router-generator";
import { routerConfig } from "../router.config.mjs";

const root = process.cwd();
const config = getConfig(routerConfig, root);
const generator = new Generator({ config, root });

await generator.run();
