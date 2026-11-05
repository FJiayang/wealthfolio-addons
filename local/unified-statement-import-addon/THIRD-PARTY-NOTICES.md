# 第三方代码与许可

导入步骤条、导航和上传区派生自主项目 Wealthfolio 的 `apps/frontend/src/pages/activity/import/components/`，保留其界面及交互，仅调整插件接口和中文文本。这部分遵循 GNU AGPL v3；本插件整体按 AGPL-3.0-only 发布，完整许可见 LICENSE。

原插件代码的 MIT 许可和版权声明保留于 licenses/original-plugin-MIT.txt。宿主公开的 @wealthfolio/ui 与 SDK 继续通过宿主加载，不修改其源码。

PDF 引擎使用 pdfjs-dist 5.4.296，原许可及字体资源许可随 dist/assets/pdf 打包。表格读取使用 SheetJS CE，原许可保留于 licenses/sheetjs-LICENSE.txt。动画使用宿主已安装的 Motion，原 MIT 许可随安装包保留。

渠道字段与记账语义参考 ezbookkeeping（MIT）、china_bean_importers（MIT）和 double-entry-generator（Apache-2.0），实现保留在本插件的 TypeScript 解析器中。
