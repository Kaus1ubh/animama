import {
  useModelAssets,
  useOperatorManagedModelAssets,
} from "@/query/hooks/useModelAssets";
import { modelDownloadsEnded } from "@/query/model-download-coordination";

/**
 * `modelDownloadsEnded` for views that do not already read the model-asset
 * list. Operator-provided models never ask, since they are not downloaded.
 */
export function useModelDownloadsEnded(): boolean {
  const operatorManaged = useOperatorManagedModelAssets();
  return modelDownloadsEnded(
    useModelAssets({ enabled: !operatorManaged }).data,
  );
}
