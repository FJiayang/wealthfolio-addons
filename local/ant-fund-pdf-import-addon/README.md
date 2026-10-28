# 蚂蚁基金 PDF 导入

本地插件，要求 Wealthfolio fork v3.11.0.14+。

1. 安装 ZIP 后，从活动页“投资 → 添加活动”打开“蚂蚁基金 PDF 导入”（移动端从导入按钮选择），上传蚂蚁基金文字型交易明细 PDF；文件仅在本地内存解析。
2. 核对原始交易。可修正确认日期、买卖类型、代码、最终收付金额、份额和手续费，或明确排除记录。转换需补齐双方；分红需提供实际再投资金额。
3. 选择人民币、使用交易流水跟踪的投资账户，继续进入宿主向导。
4. 在宿主完成资产识别、活动审核、重复处理、确认和提交。插件不再搜索绑定基金或直接提交活动。
5. 如需返回原始交易修正，确认放弃宿主编辑后返回；插件保留解析与修正内容，再次交接会重新审核。

金额视为最终收付金额：买入单价=(金额-手续费)/份额，卖出单价=(金额+手续费)/份额；费用不重复扣减。使用确认日期；分红映射为 DRIP，不猜测净值。不生成充值、提现或期初余额。

仅支持当前 12 列文字版式，不支持扫描件、OCR、加密 PDF 或其他机构。交易页提取失败时整份文件停止导入；无效日期保留供修正。金额和份额使用精确十进制字符串。

活动备注保持
`Ant Fund order:<订单号>`。重复处理完全沿用宿主规则，不保证与其他渠道不同备注或金额口径的记录去重。资产识别可能调用宿主已启用的行情源。插件只声明账户读取及
`activities.openImport` 权限，无直接网络权限。

未提交的数据只保存在内存。取消和移除文件需确认；移动端离开保护沿用宿主能力，不拦截浏览器前进/后退，不支持刷新恢复。

## 开发和验证

入口要求宿主支持 `investment-import` 清单位置；不再提供侧边栏入口。旧版宿主会忽略此入口。

本地开发依赖链接到同级目录 `wealthfolio/packages`
的 SDK/UI 及宿主 React；先在宿主执行：

```sh
pnpm --filter @wealthfolio/ui build
pnpm --filter @wealthfolio/addon-sdk build
```

在 addons 仓库执行：

```sh
pnpm install --frozen-lockfile
pnpm --filter ant-fund-pdf-import-addon type-check
pnpm --filter ant-fund-pdf-import-addon test
pnpm --filter ant-fund-pdf-import-addon bundle
pnpm --filter ant-fund-pdf-import-addon test:package
```

Architecture
impact：新增到宿主的内存草稿交接；PDF 解析及特殊交易修正由插件负责，资产识别、校验、重复处理、持久化和结果由宿主负责。不新增数据库、网络服务、后台任务或自动重试。

测试仅使用合成样例。第三方代码及字体许可见 THIRD-PARTY-NOTICES.md 和 ZIP 内许可文件。

## 0.1.2 界面收敛

插件名称、菜单及自身界面固定简体中文，不再注册翻译。交接后的宿主审核向导继续使用宿主语言；数值继续使用宿主格式化能力。

向导组合组件由 addons 仓库 `packages/import-wizard-ui` 提供，底层控件、DataGrid 和主题变量继续复用宿主 `@wealthfolio/ui`。共享源码打进插件 ZIP，不要求宿主注册新模块。

配套撤销宿主共享向导 UI 导出时，必须先升级到本版；旧版插件无法在移除导出的宿主上运行。内存草稿交接、权限及离开保护接口保持不变。

同时修正字体及 CMap 的包内资源路径为 `dist/assets/pdf/`，避免安装后上传文件时报缺少资源。仍通过宿主资产接口读取，不增加网络请求或修改 PDF 解析算法。
