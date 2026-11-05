import { config } from "zod/v4/core";

/**
 * Zod builds faster object parsers with `new Function`, after probing whether
 * that is allowed. The app's Content Security Policy forbids evaluating
 * strings, and the browser reports even the caught probe as a violation, so
 * Zod runs without generated code. Each schema reads this setting when it is
 * created, so both entry modules import this module before anything else.
 */
config({ jitless: true });
