// The public site: / (the landing) and /claudio (his character page). Rendered outside the terminal shell and
// outside the coming-soon gate — they are the public face whether the app is open or not (see App.tsx, and
// server/access.ts PUBLIC_PAGES for the server side).
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";

const Landing = lazy(() => import("@/pages/Landing"));
const ClaudioPage = lazy(() => import("@/pages/ClaudioPage"));

export default function SitePages() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0b1018" }} />}>
      <Switch>
        <Route path="/claudio" component={ClaudioPage} />
        <Route path="/claudio/" component={ClaudioPage} />
        <Route component={Landing} />
      </Switch>
    </Suspense>
  );
}
