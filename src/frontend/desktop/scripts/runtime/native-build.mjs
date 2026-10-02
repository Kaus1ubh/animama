import { assertLfCheckout, parseTarget } from "./common.mjs";
import { buildPostgres } from "./native.mjs";

assertLfCheckout();
buildPostgres(parseTarget());
