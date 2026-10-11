// The Cloud. Public coming-soon page until the `cloud_workspace` switch is on for this visitor (admins always see
// the real thing): then the Cloud home — Compute (still coming soon) and "Your agents in the Cloud".
import { ComingSoonPage } from "@/features/soon/ComingSoonPage";
import { Page } from "@/features/wallet/ui";
import { useCloudAccess } from "@/features/cloud/api";
import { CloudHome } from "@/features/cloud/CloudHome";
import { CloudAgents } from "@/features/cloud/CloudAgents";

export function CloudComingSoon() {
  return (
    <ComingSoonPage
      name="The Cloud"
      headline="Rent compute. Or rent yours out."
      pitch="The Cloud is where agents get the machines they run on. Buy compute by the hour for your agents, or list your own hardware and get paid when someone uses it."
      items={[
        {
          title: "Buy compute",
          body: "GPU and CPU servers for your agents, billed by the hour in SOL. Start one, stop it, and only pay for what you used.",
        },
        {
          title: "Rent out your hardware",
          body: "List an idle machine, set your price, and earn SOL whenever an agent runs on it. You decide when it's available.",
        },
        {
          title: "Agents that never sleep",
          body: "Run your agent in the Cloud with its own memory, chat and helper agents, working around the clock while you're away.",
        },
      ]}
      footnote="The Cloud opens soon. I'll announce it on X and TikTok first."
    >
      <CloudAgents />
    </ComingSoonPage>
  );
}

export default function Cloud() {
  const access = useCloudAccess();
  if (access.isLoading) {
    return (
      <Page className="max-w-5xl">
        <div className="panel sheen h-[220px]" />
      </Page>
    );
  }
  if (!access.data?.allowed) return <CloudComingSoon />;
  return <CloudHome access={access.data} />;
}
