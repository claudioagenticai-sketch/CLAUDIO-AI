// /cloud/:slug — a hosted agent's Cloud workspace. Closed (coming-soon page) unless the `cloud_workspace` switch is
// on for this visitor or they're an admin; owner wallet sign-in required.
import { useParams } from "wouter";
import { Page } from "@/features/wallet/ui";
import { SignInCard } from "@/features/session/SignInButton";
import { useViewerWallet } from "@/features/agents/api";
import { useCloudAccess } from "@/features/cloud/api";
import { Workspace } from "@/features/cloud/Workspace";
import { CloudComingSoon } from "@/pages/Cloud";

export default function CloudWorkspace() {
  const { slug = "" } = useParams() as { slug?: string };
  const access = useCloudAccess();
  const viewer = useViewerWallet();
  if (access.isLoading || viewer.loading) {
    return (
      <Page className="max-w-6xl">
        <div className="panel sheen h-[300px]" />
      </Page>
    );
  }
  if (!access.data?.allowed) return <CloudComingSoon />;
  if (!viewer.wallet) {
    return (
      <Page className="max-w-3xl">
        <SignInCard title="Sign in to open this workspace" hint="Only the agent's owner wallet can open its workspace. Sign a short message to prove it's you — no fee, no transaction." />
      </Page>
    );
  }
  return <Workspace slug={slug} />;
}
