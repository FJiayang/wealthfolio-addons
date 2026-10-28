import { ErrorBoundary } from "@wealthfolio/ui";
import type { AddonEnableFunction } from "@wealthfolio/addon-sdk";
import { AntFundImportPage } from "./import-page";
import "./styles.css";

const enable: AddonEnableFunction = (ctx) => {
  ctx.router.add({
    id: "ant-fund-pdf-import",
    path: "/addons/ant-fund-pdf-import-addon",
    component: () => (
      <ErrorBoundary variant="page">
        <AntFundImportPage ctx={ctx} />
      </ErrorBoundary>
    ),
  });
};
export default enable;
