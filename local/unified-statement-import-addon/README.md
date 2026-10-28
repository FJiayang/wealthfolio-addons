# 账单导入

本地插件，适用于 Wealthfolio
3.11.0 及以上。首版支持支付宝交易明细 CSV，不属于官方插件目录。全部解析和账目处理在本机完成，无网络权限。

## 开发和安装

在 `wealthfolio-addons` 根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm --filter unified-statement-import-addon test
pnpm --filter unified-statement-import-addon type-check
pnpm --filter unified-statement-import-addon bundle
pnpm --filter unified-statement-import-addon test:package
```

在 Wealthfolio 插件设置中选择“从文件安装”，安装
`local/unified-statement-import-addon/dist/unified-statement-import-addon-0.1.0.zip`，授权读取账户、读取活动和批量保存。侧边栏打开“账单导入”。开发服务：`pnpm --filter unified-statement-import-addon dev:server`。

## 使用

1. 上传支付宝交易明细 CSV（UTF-8 或 GB18030）；自动定位表头，忽略说明区汇总数字。
2. 将付款方式映射到已有 CNY 现金或信用卡账户。映射由宿主插件存储保存，不保存原文件。无效或已归档账户须重新选择，支持重置。
3. 核对预览。交易关闭自动排除；不计收支、组合支付及未知状态需确认性质、实际金额和账户。理财、转账和还款本版不处理，请排除。未确认行不会提交，支持仅提交已就绪部分。
4. 确认后保存。再次上传相同订单自动标为重复，现有账目不会覆盖。结果不明确时先“刷新核对”，再决定是否提交剩余记录。

余额宝付款需要按实际资金账户核对；如果系统没有适合的现金账户，请保留待确认，不应为了导入映射到无关银行卡。花呗等负债消费可由用户确认后映射到已建信用卡类型账户，本版不管理分期或还款。普通收入不能记入信用卡账户。

## 来源与扩展

新增记录的 `metadata.unifiedStatementImport` 使用
`{version: 1, sources: [...], booking: {...}}`。来源包含
`system`、`recordId`、商家订单号、账户提示、文件名、物理行号、原始时间及上海时区转换后的时间、原金额、币种、支付方式、状态、收支方向、分类、商户、商品和备注。`booking`
保存确认后的性质、金额和目标账户，原来源不随人工改金额变化。

按 `system + recordId`
查重，覆盖所有可读取账户；同一订单的经济内容或商户明细变化会报冲突。不同文件名、行号或目标账户选择不会绕过重复检测。缺少订单号不可提交。备注附订单号，避免核心将同日同额不同订单误判为重复。

新增格式只需实现 `StatementParser` 并在 `src/parsers/index.ts`
注册，输出相同来源结构。`sources`
数组预留未来银行、微信及信用卡账单关联；本版不自动关联不同来源。来源存于系统账目，无单独插件流水数据库或浏览器 localStorage。

## 限制

- 插件的预览不是核心导入向导的 `checkImport`；提交仍经过核心 `saveMany`
  校验。不产生 CSV 导入运行历史。
- 分类仅作为来源信息保存，不自动创建或赋予系统分类。
- 不修改既有活动，不创建内部转账、借款计划或分期，不处理组合支付拆分。
- 源身份不受数据库唯一约束保护。仅支持同一插件串行导入，不支持多窗口并发提交；其他入口导入的无插件来源数据无法可靠查重。
- SDK 活动查询不返回归档账户的账目。相关账户须先取消归档，才能检测其中的来源重复；隐藏但未归档账户仍参与检测。
- 源信息属于账目 metadata，包含账单明细，随主程序原有备份与同步边界处理。插件本地存储只保存账户映射。
- 不兼容或损坏的插件来源 metadata 会阻止提交；不静默忽略后重复入账。

## 验证

`test` 使用虚构商户和订单，不包含用户原始账单。可只读检查真实 DEMO：

```sh
STATEMENT_DEMO_PATH='/绝对路径/支付宝交易明细(20250101-20251231)_DEMO.csv' pnpm --filter unified-statement-import-addon test
```

该验收检查 52 条明细（支出 26、收入 4、不计收支 22，交易关闭 2）。默认提交测试使用模拟宿主；安装后的真实保存仅在隔离测试环境中验证，不应用真实账户试导入。

另有可选的真实后端测试：`STATEMENT_TEST_ORIGIN=http://127.0.0.1:端口 pnpm --filter unified-statement-import-addon exec vitest run src/import/host.test.ts`。必须使用全新隔离的数据目录，仅有一个名为“账单隔离测试账户”的 CNY 现金账户且无活动；测试会写入三笔虚构活动并验证再次提交不新增。测试不自动清空数据库，也不得指向日常使用环境。
