# 蚂蚁基金 PDF 导入 / Ant Fund PDF Import

Local fork addon, not an official Wealthfolio release. Requires Wealthfolio 3.11.0+.

## 使用

1. 通过“从文件安装”安装构建生成的 ZIP，在侧栏打开“蚂蚁基金 PDF”。
2. 选择使用交易流水跟踪的人民币投资账户，上传蚂蚁基金导出的文字型交易明细 PDF。
3. 在“核对基金”表格打开搜索对话框，通过宿主已配置的行情源逐一核对代码、名称和 A/C 等份额类别并绑定。尚未创建、且没有交易所 MIC 的场外基金会显示“先创建资产”提示并禁用绑定；请先在宿主创建资产，再搜索绑定。离开页面会丢弃当前会话，请先完成资产准备后再上传。
4. 进入“预览确认”，按状态筛选和分页核对流水。在编辑对话框修改确认日期、买卖类型、基金代码、最终收付金额、份额和手续费，切换标签查看 PDF 原始字段与页码；保存后必须重新校验。基金转换需补齐双方，分红需补齐实际再投资金额；不导入的记录必须明确排除。
5. 校验并检查重复，核对宿主提示后确认导入。重复记录默认跳过；只有明确勾选才强制导入。导入不会自动重试，失败时显示逐条错误及导入批次。

确认金额视为最终收付金额；买入单价=(金额-手续费)/份额，卖出单价=(金额+手续费)/份额。使用确认日记账，不补造充值、提现或期初余额，账户现金可能需要另行维护。分红映射为 DRIP，不猜测净值。

PDF、身份信息和解析会话仅保留在内存，不上传或持久化。基金搜索和宿主导入可能使用用户已启用的行情源；插件没有直接网络权限。备注固定为 `Ant Fund order:<订单号>`；同文件重导依赖宿主去重，不保证与备注或金额口径不同的其他渠道去重。

仅支持当前蚂蚁基金 12 列版式，不支持 OCR、扫描件、加密 PDF 或其他机构格式。离开页面会丢弃未保存的修改。

交易页未提取到表格时整份文件停止导入，只跳过封面和已确认的末页签署日期。单条确认日期异常会保留为待补齐记录，可修改或排除。校验预览、重复提示和失败结果均显示对应的原始记录编号，转换分腿同时显示买卖类型。

## English

Select an existing CNY securities account with transaction tracking, upload an unencrypted text statement, and bind every fund using the host's search. Confirm codes, names and share classes. Review or explicitly exclude incomplete records, validate, then confirm the import. Dividends with units but no amount need their actual reinvested value; conversions need both legs. Fees are included in the final confirmation total, not deducted twice. No cash funding records are invented.

Statements stay in memory. The addon makes no direct network requests; the host may query its configured market-data providers. Duplicate overrides are opt-in. An uncertain import response requires another validation before retrying. Leaving the page discards the session.

New OTC funds without an exchange MIC must be created in Wealthfolio before binding; the addon does not fabricate an exchange or switch quote modes. Prepare those assets before uploading. An unrecognized transaction page stops the entire import; only the cover and recognized final signature page are skipped. Invalid confirmation dates stay editable. Preview, duplicate and result references point back to the original record, with the activity type identifying conversion legs.

## Development / CI

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter ant-fund-pdf-import-addon type-check
pnpm --filter ant-fund-pdf-import-addon test
pnpm --filter ant-fund-pdf-import-addon bundle
pnpm --filter ant-fund-pdf-import-addon test:package
```

The Validate workflow runs these checks on Node 24 and uploads `ant-fund-pdf-import-addon-0.1.0.zip` as an Actions artifact. No store listing or automatic publishing is configured. `pnpm check` also checks this addon's types and unit tests.

Architecture impact: no host, SDK, database, provider configuration or persistence changes. PDF parsing runs in the sandbox's main thread, with local CMap/font resources and no Worker or fetch. Host APIs retain ownership of validation, deduplication, activity persistence and recalculation.

Tests use only synthetic fixtures. `scripts/generate-fixture.py` regenerates the committed synthetic PDF with reportlab (development only). A local customer PDF may be checked separately; never commit or log its contents.

Third-party code and font licenses: see THIRD-PARTY-NOTICES.md and bundled licenses.
