import type { AddonEnableFunction } from "@wealthfolio/addon-sdk";
import { AntFundImportPage } from "./import-page";
import "./styles.css";

const enable: AddonEnableFunction = (ctx) => {
  ctx.router.add({
    id: "ant-fund-pdf-import",
    path: "/addons/ant-fund-pdf-import-addon",
    component: () => <AntFundImportPage ctx={ctx} />,
  });
};
export default enable;
