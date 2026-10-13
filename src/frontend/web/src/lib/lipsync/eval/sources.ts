/** Plan sources the evaluation command can score, by id. */

import { alignedEvalSource, alignedFullEvalSource } from "./aligned-source";
import type { EvalPlanSource } from "./arrival";
import { estimatedEvalSource } from "./estimated-source";

export const EVAL_PLAN_SOURCES: EvalPlanSource[] = [
  estimatedEvalSource,
  alignedEvalSource,
  alignedFullEvalSource,
];
