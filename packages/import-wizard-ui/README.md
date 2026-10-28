# 导入向导 UI

两个本地导入插件共用的展示组件。底层控件及格式化能力来自宿主 `@wealthfolio/ui`，主题颜色、圆角等通过宿主 CSS 变量继承；本包不访问 SDK 或持有导入业务状态。

插件以 `workspace:*` 依赖本包，由 Vite 直接打包 TypeScript 源码；不要将本包加入 external 或宿主 hostDependencies。React、SDK 和 `@wealthfolio/ui` 仍由宿主提供。

插件样式先导入 Tailwind，再导入 `@wealthfolio/import-wizard-ui/styles.css`，以编译共享源码中的样式并映射宿主语义颜色。不修改全局主题变量。

```sh
pnpm --filter @wealthfolio/import-wizard-ui type-check
pnpm --filter @wealthfolio/import-wizard-ui test
```

Architecture impact：仅共享展示组件与样式，不共享解析器、账户映射、查重或提交状态；不增加网络、存储或宿主依赖桥接。
