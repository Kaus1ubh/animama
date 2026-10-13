import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useFormatters } from "@animama/product-ui/i18n";
import type { RuntimeAccountActions } from "@animama/runtime-contracts";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";

/** The admitted account's usage and limits, loaded while the dialog is open. */
export function AccountUsage({
  actions,
  open,
  onOpenChange,
}: {
  actions: RuntimeAccountActions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("sidebar");
  const { number, dateTime } = useFormatters();
  const sessionKey = useRuntimeCacheKey();
  const usage = useQuery({
    queryKey: queryKeys.accountUsage(sessionKey ?? "__anon__"),
    queryFn: ({ signal }) => actions.loadUsage(signal),
    enabled: open && Boolean(sessionKey),
    staleTime: 5_000,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("usage.title")}</DialogTitle>
          <DialogDescription>{t("usage.description")}</DialogDescription>
        </DialogHeader>
        {usage.isPending ? (
          <p role="status">{t("usage.loading")}</p>
        ) : usage.isError ? (
          <div>
            <p role="alert">{t("usage.loadFailed")}</p>
            <button
              type="button"
              onClick={() => {
                void usage.refetch();
              }}
            >
              {t("usage.retry")}
            </button>
          </div>
        ) : (
          <dl className="space-y-3">
            {usage.data.units.map((unit) => (
              <div key={unit.id}>
                <dt className="font-medium">{unit.label}</dt>
                <dd>
                  {t("usage.amount", {
                    used: number(unit.used),
                    limit: number(unit.limit),
                  })}
                  {unit.resetsAt ? (
                    <span className="text-muted-foreground block text-sm">
                      {t("usage.resets", {
                        time: dateTime(new Date(unit.resetsAt)),
                      })}
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}
