import { ErrorBoundary } from "@wealthfolio/ui";
import type { AddonEnableFunction } from "@wealthfolio/addon-sdk";
import { registerTranslations } from "@wealthfolio/addon-sdk";
import { translations } from "./i18n";
import { StatementImportPage } from "./pages/statement-import-page";
import "./styles.css";

const enable: AddonEnableFunction = (context) => {
  registerTranslations(translations);
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
