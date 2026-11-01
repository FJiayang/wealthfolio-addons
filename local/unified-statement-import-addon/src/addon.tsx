import { ErrorBoundary } from "@wealthfolio/ui";
import type { AddonEnableFunction } from "@wealthfolio/addon-sdk";
import { StatementImportPage } from "./pages/statement-import-page";
import "./styles.css";

const enable: AddonEnableFunction = (context) => {
  context.router.add({
    id: "statement-import",
    path: "/addons/unified-statement-import-addon",
    component: () => (
      <ErrorBoundary variant="page">
        <StatementImportPage ctx={context} />
      </ErrorBoundary>
    ),
  });
};

export default enable;
