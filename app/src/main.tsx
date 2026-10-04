import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { api, useLoad } from "./api";
import { Diff } from "./pages/Diff";
import { Directory } from "./pages/Directory";
import { File } from "./pages/File";
import { Ledger } from "./pages/Ledger";
import { Libraries } from "./pages/Libraries";
import { interceptLinks, match, useLocation } from "./router";
import { Header, type Me } from "./ui";
import { Urls } from "./urls";

let handle: string | null = null;

function App() {
  const url = useLocation();
  const me = useLoad("me", () => api<Me>("/api/v1/me"));
  const who = me.state === "ready" ? me.data : null;
  handle = who?.handle ?? null;
  const route = match(url);
  const actor = who?.actor ?? "";
  let page: React.ReactNode = null;
  if (!route) {
    // The Worker serves this page only at the app's own URLs, so this is a bug, not a 404.
    page = <h1>Not found</h1>;
  } else if (route.page === "libraries") {
    page = <Libraries />;
  } else {
    const urls = new Urls(route.owner, route.slug, "at" in route ? route.at : undefined);
    switch (route.page) {
      case "directory":
        page = <Directory urls={urls} dir={route.dir} />;
        break;
      case "file":
        page = (
          <File urls={urls} path={route.path} done={url.searchParams.get("done")} actor={actor} />
        );
        break;
      case "ledger":
        page = <Ledger urls={urls} filters={route.filters} done={route.done} actor={actor} />;
        break;
      case "diff":
        page = <Diff urls={urls} path={route.path} from={route.from} to={route.to} />;
        break;
    }
  }
  return (
    <>
      <Header me={who} />
      <main>{page}</main>
    </>
  );
}

interceptLinks(() => handle);
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
