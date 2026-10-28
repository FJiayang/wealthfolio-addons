import { ErrorBoundary } from "@wealthfolio/ui";
import { registerTranslations, type AddonEnableFunction } from "@wealthfolio/addon-sdk";
import { AntFundImportPage } from "./import-page";
import "./styles.css";
import { en, zh, zhHant } from "./messages";

const enable: AddonEnableFunction = (ctx) => {
  registerTranslations({ en, zh, "zh-Hant": zhHant });
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
