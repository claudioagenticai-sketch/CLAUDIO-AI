// The `cloud_workspace` platform switch: opens the Cloud workspace (/cloud) to hosted-agent owners. Admins can
// always use it. The server audits every change (cloud.workspace_on / cloud.workspace_off).
import { useMutation } from "@tanstack/react-query";
import { Card, SwitchLite } from "@/features/wallet/ui";
import { PLATFORM_KEY } from "@/lib/platform";
import { queryClient } from "@/lib/queryClient";
import { adminApi, invalidateAdmin, useAdminQuery } from "./api";
import { ErrorNote, Loading, NotAvailable, fmtTime, short } from "./ui";

const LLM_TEXT: Record<string, string> = { ok: "Agents can think right now.", offline: "No model key is set, so agents answer “offline”.", budget: "Today's model budget is used up." };

export function CloudSwitchCard() {
  const q = useAdminQuery(["cloud"], adminApi.cloud);
  const save = useMutation({
    mutationFn: (enabled: boolean) => adminApi.putCloud(enabled),
    onSuccess: () => {
      void invalidateAdmin("cloud");
      void queryClient.invalidateQueries({ queryKey: PLATFORM_KEY });
      void queryClient.invalidateQueries({ queryKey: ["cloud"] });
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return q.error.unavailable ? <NotAvailable what="Cloud workspace" /> : <ErrorNote error={q.error} />;
  const d = q.data!;
  return (
    <Card title="Cloud workspace" right={<span className={d.enabled ? "chip chip-buy font-bold" : "chip font-bold"}>{d.enabled ? "Open" : "Off"}</span>}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-1.5 text-[12.5px] leading-relaxed text-text-2">
          <p>
            When this is on, owners of hosted agents can open their agent's workspace at <span className="num">/cloud</span>: chat, helpers, memory, files,
            skills and activity. When it's off, everyone else sees the coming-soon page. Admins can always use it.
          </p>
          <p className="text-text-3">
            {LLM_TEXT[d.llm] ?? d.llm} Each owner can send {d.dailyMessages} messages a day.
            {d.updatedAt ? ` Last changed ${fmtTime(d.updatedAt)}${d.updatedBy ? ` by ${short(d.updatedBy)}` : ""}.` : ""}
          </p>
        </div>
        <SwitchLite checked={d.enabled} disabled={save.isPending} onChange={(v) => save.mutate(v)} />
      </div>
      {save.error && <ErrorNote error={save.error} />}
    </Card>
  );
}
