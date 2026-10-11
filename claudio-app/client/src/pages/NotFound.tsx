// 404 — "Lost the signal": plain message, Claudio's avatar and the ways back.
import { Link, useLocation } from "wouter";
import { Search } from "lucide-react";
import { ClaudioMark } from "@/components/kit";
import { useUI } from "@/lib/store";
import { linkButton } from "@/features/portfolio/pageKit";

export default function NotFound() {
  const [location] = useLocation();
  const setPalette = useUI((s) => s.setPalette);
  return (
    <div className="flex min-h-full items-center justify-center px-5 py-10 md:py-16">
      <div className="w-full max-w-xl">
        <div className="flex flex-col items-start">
          <div className="flex items-center gap-3">
            <ClaudioMark variant="avatar" size={44} />
            <span className="mono-label">
              <span className="section-num mr-2">404</span>Error
            </span>
          </div>
          <h1 className="display mt-5 text-[56px] text-text md:text-[96px]">
            Lost the <span className="text-brand">signal</span>
          </h1>
          <p className="lede mt-4 max-w-md">
            Even I can't find anything at{" "}
            <span className="num break-all rounded-[2px] bg-panel-2 px-1.5 py-0.5 text-text-2">{location}</span>. The coin may be gone, or the link is
            off by a character or two.
          </p>

          <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            <Link href="/trenches" className={linkButton("brand")}>
              Back to the Trenches
            </Link>
            <Link href="/home" className={linkButton("soft")}>
              Home
            </Link>
            <Link href="/launch" className={linkButton("soft")}>
              Launch a coin
            </Link>
            <button
              type="button"
              onClick={() => setPalette(true)}
              className="btn btn-ghost h-11 md:h-10"
            >
              <Search className="h-4 w-4" />
              Search or paste a CA
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
