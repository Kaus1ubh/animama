import { parseTarget } from "./common.mjs";
import { buildPostgres } from "./native.mjs";

buildPostgres(parseTarget());
