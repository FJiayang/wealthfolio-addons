# 本地插件导入交互验证

依赖同级 `wealthfolio` 仓库已安装的 Playwright、Chrome 与 Rust 工具链，不额外安装测试框架。先阅读宿主的 `e2e/README.md`；以下命令由宿主启动器准备隔离数据库并启动 Web 服务，不使用日常数据库。

在插件仓库构建两个安装包：

```sh
pnpm --filter unified-statement-import-addon bundle
pnpm --filter ant-fund-pdf-import-addon bundle
```

在宿主仓库运行：

```sh
pnpm test:e2e --config ../wealthfolio-addons/e2e/playwright.config.mjs
```

覆盖格式选择、CSV/PDF 原文件预览、映射阻断、账单疑点核对、筛选后批量跳过／恢复、账单保存、基金交接宿主，以及 LTR/RTL、浅色/深色截图。结果保存在本目录的 `test-results/`。
