import { useQuery } from "@tanstack/react-query";
import type { RuntimeAccountActions } from "@animama/runtime-contracts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";

export function AccountUsage({
  actions,
  open,
  onOpenChange,
}: {
  actions: RuntimeAccountActions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const usage = useQuery({
    queryKey: ["account-usage"],
    queryFn: ({ signal }) => actions.loadUsage(signal),
    enabled: open,
    staleTime: 5_000,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Usage and limits</DialogTitle>
          <DialogDescription>
            Your account's current usage. Limits are enforced by the runtime.
          </DialogDescription>
        </DialogHeader>
        {usage.isPending ? (
          <p role="status">Loading usage…</p>
        ) : usage.isError ? (
          <div>
            <p role="alert">Usage could not be loaded.</p>
            <button
              type="button"
              onClick={() => {
                void usage.refetch();
              }}
            >
              Try again
            </button>
          </div>
        ) : (
          <dl className="space-y-3">
            {usage.data.units.map((unit) => (
              <div key={unit.id}>
                <dt className="font-medium">{unit.label}</dt>
                <dd>
                  {unit.used.toLocaleString()} of {unit.limit.toLocaleString()}
                  {unit.resetsAt ? (
                    <span className="text-muted-foreground block text-sm">
                      Resets {new Date(unit.resetsAt).toLocaleString()}
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
