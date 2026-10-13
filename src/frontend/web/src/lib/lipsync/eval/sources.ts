/** Plan sources the evaluation command can score, by id. */

import type { EvalPlanSource } from "./arrival";
import { estimatedEvalSource } from "./estimated-source";

export const EVAL_PLAN_SOURCES: EvalPlanSource[] = [estimatedEvalSource];
