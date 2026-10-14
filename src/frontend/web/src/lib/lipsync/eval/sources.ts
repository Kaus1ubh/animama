/** Plan sources the evaluation command can score, by id. */

import { alignedEvalSource, alignedFullEvalSource } from "./aligned-source";
import type { EvalPlanSource } from "./arrival";

export const EVAL_PLAN_SOURCES: EvalPlanSource[] = [
  alignedEvalSource,
  alignedFullEvalSource,
];
