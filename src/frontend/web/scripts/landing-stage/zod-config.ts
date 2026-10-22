import { config } from "zod";

// Validate without compiling: the site's CSP allows no `eval`, and Zod would
// otherwise probe for it (and log a violation) on first use. Imported first
// by `stage.ts`, since some app modules validate while they load.
config({ jitless: true });
