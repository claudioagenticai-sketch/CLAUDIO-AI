// Thread tab on the token page: the coin's own room (TokenAgentInfo.room, else "t-<mint>"), read-only for humans.
import { ThreadPanel } from "@/features/agents/thread";
import { useTokenAgentInfo } from "@/features/agents/api";

export function TokenThreadTab({ tokenKey, address }: { tokenKey: string; address: string }) {
  const info = useTokenAgentInfo(tokenKey);
  const room = info.data?.room ?? `t-${address}`;
  return <ThreadPanel room={room} title="This coin's thread" bare className="lg:max-h-[640px]" />;
}
