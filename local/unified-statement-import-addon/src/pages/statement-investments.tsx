import { useMemo, useState } from "react";
import type { Account, AddonContext, AssetResolutionInput } from "@wealthfolio/addon-sdk";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, AlertFeedback, Badge, Button, Checkbox, Icons, useAmountFormatting, useDateFormatting } from "@wealthfolio/ui";
import { ImportChoice, ImportReviewTable } from "@wealthfolio/import-wizard-ui";
import type { DraftLeg } from "../ant-fund/import-model";
import { cancelInvestmentLink, fundRequest, investmentCandidates, investmentNodes, investmentSignature, isInvestmentCash, legKey, linkSavedInvestment } from "../import/investments";
import { rowKey, type Decisions, type ExistingActivity, type PreviewRow, type RowDecision } from "../import/ledger";
import { statementReference } from "./statement-presentation";
import { StatementMappingDetails } from "./statement-mapping-details";

interface Props {
  ctx: AddonContext;
  preview: PreviewRow[];
  decisions: Decisions;
  accounts: Account[];
  activities: ExistingActivity[];
  busy: boolean;
  onChange(key: string, patch: RowDecision): void;
}
interface FundGridRow extends DraftLeg { id: string; entry: PreviewRow; index: number; assetSymbol: string }

// Uses the host import grid's symbol cell and editing behavior.
export function StatementInvestmentReview({ ctx, preview, decisions, busy, onChange, onWorkingChange }: Props & { onWorkingChange(value: boolean): void }) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const entries = preview.filter((entry) => entry.row.source.investment && entry.status !== "excluded" && entry.status !== "duplicate");
  const data: FundGridRow[] = entries.flatMap((entry) => {
    const decision = decisions[rowKey(entry.row)] ?? {};
    return (decision.fundLegs ?? entry.row.source.investment!.legs).map((leg, index) => ({
      ...leg, id: `${rowKey(entry.row)}:${index}`, entry, index,
      assetSymbol: decision.fundAssets?.[legKey(leg)]?.symbol ?? leg.code,
    }));
  });
  const columns = useMemo(() => [
    { id: "activityType", accessorKey: "activityType", header: "投资性质", size: 140,
      meta: { cell: { variant: "select" as const, options: [{ value: "BUY", label: "申购" }, { value: "SELL", label: "赎回" }, { value: "DIVIDEND", label: "分红再投资" }] } } },
    ...(["date", "code", "name"] as const).map((key, i) => ({
      id: key, accessorKey: key, header: ["确认日期", "基金代码", "基金名称"][i], size: key === "name" ? 240 : 150,
      meta: { cell: { variant: "short-text" as const } },
    })),
    ...(["amount", "quantity", "fee", "tax", "unitPrice"] as const).map((key, i) => ({
      id: key, accessorKey: key, header: ["最终收付金额", "份额", "手续费", "税费", "净值（空值自动计算）"][i], size: 160,
      meta: { cell: { variant: "number" as const, valueType: "string" as const, min: 0 } },
    })),
    { id: "assetSymbol", accessorKey: "assetSymbol", header: "识别资产", size: 200,
      meta: { cell: { variant: "symbol" as const,
        onSearch: (query: string) => ctx.api.market.searchTicker(query),
        onSelect: (index: number, symbol: string, result?: import("@wealthfolio/ui").SymbolSearchResult) => {
          if (!result) return;
          const current = data[index], key = rowKey(current.entry.row);
          onChange(key, { fundChecked: undefined, fundAssets: { ...decisions[key]?.fundAssets,
            [legKey(current)]: { id: result.existingAssetId, symbol, name: result.longName || result.shortName,
              exchangeMic: result.exchangeMic, quoteCcy: result.currency || "CNY", quoteMode: result.quoteMode || "MARKET",
              instrumentType: "EQUITY", providerId: result.dataSource, providerSymbol: symbol } } });
        },
      } } },
    { id: "source", header: "来源订单", accessorFn: (row: FundGridRow) => row.entry.row.source.recordId, size: 240, meta: { readOnly: true } },
    { id: "status", header: "处理状态", accessorFn: (row: FundGridRow) => row.entry.reason, size: 320, meta: { readOnly: true } },
  ], [ctx, data, decisions, onChange]);

  async function checkAssets() {
    setChecking(true); onWorkingChange(true); setError("");
    try {
      const inputs = entries.flatMap((entry) => {
        const key = rowKey(entry.row), decision = decisions[key] ?? {};
        const legs = decision.fundLegs ?? entry.row.source.investment!.legs;
        return fundRequest(entry.row, legs, entry.accountId).map((activity, index) => {
          const asset = decision.fundAssets?.[legKey(legs[index])];
          return { ...activity, assetId: asset?.id, symbol: asset?.symbol ?? activity.symbol,
            exchangeMic: asset?.exchangeMic, quoteCcy: asset?.quoteCcy,
            quoteMode: asset?.quoteMode, providerId: asset?.providerId, providerSymbol: asset?.providerSymbol };
        });
      });
      const checked = await ctx.api.activities.checkImport(inputs);
      if (checked.length !== inputs.length) throw new Error("资产校验返回明细不完整，请重试");
      let offset = 0;
      for (const entry of entries) {
        const key = rowKey(entry.row), decision = decisions[key] ?? {};
        const legs = decision.fundLegs ?? entry.row.source.investment!.legs;
        const results = checked.slice(offset, offset + legs.length); offset += legs.length;
        const fundError = results.flatMap((result) => Object.values(result.errors ?? {}).flat()).join("；");
        const assets: Record<string, AssetResolutionInput> = Object.fromEntries(results.map((result, index) => [
          legKey(legs[index]), { id: result.assetId, symbol: result.symbol, name: result.symbolName,
            exchangeMic: result.exchangeMic, quoteCcy: result.quoteCcy ?? "CNY", quoteMode: result.quoteMode === "MANUAL" ? "MANUAL" : "MARKET",
            instrumentType: result.instrumentType ?? "EQUITY", providerId: result.providerId, providerSymbol: result.providerSymbol },
        ]));
        onChange(key, { fundAssets: assets, fundError,
          fundChecked: !fundError && results.every((result) => result.isValid) ? investmentSignature(legs, entry.accountId, assets) : undefined });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "基金资产校验失败，请核对后重试"); }
    finally { setChecking(false); onWorkingChange(false); }
  }
  return <div className="space-y-4">
    <AlertFeedback variant={entries.length > 0 && entries.every((entry) => entry.status === "ready") ? "success" : "warning"}
      title={entries.length > 0 && entries.every((entry) => entry.status === "ready") ? "基金资产已就绪" : "识别并核对基金资产"}>
      双击单元格修改日期、代码、最终收付金额、份额和费用；净值留空时按最终金额和费用计算。基金资产使用宿主已有行情源识别，找不到时可明确选择手动资产。
    </AlertFeedback>
    {error && <AlertFeedback variant="error" title="资产校验失败">{error}</AlertFeedback>}
    <Button variant="outline" disabled={busy || checking || !entries.length} onClick={() => {
      for (const entry of entries) {
        const key = rowKey(entry.row), legs = decisions[key]?.fundLegs ?? entry.row.source.investment!.legs;
        const assets = Object.fromEntries(legs.map((leg) => [legKey(leg), {
          symbol: leg.code, name: leg.name || leg.code, quoteMode: "MANUAL" as const, quoteCcy: "CNY", instrumentType: "EQUITY",
        }]));
        onChange(key, { fundAssets: assets, fundChecked: undefined });
      }
    }}>标为手动资产</Button>
    {entries.filter((entry) => /转换|调仓/.test(entry.row.source.investment!.purpose) ||
      !(decisions[rowKey(entry.row)]?.fundLegs ?? entry.row.source.investment!.legs).length).map((entry) => {
      const key = rowKey(entry.row), legs = decisions[key]?.fundLegs ?? entry.row.source.investment!.legs;
      return <div key={key} className="flex flex-wrap items-center gap-3">
        <span>{entry.row.source.recordId} · {entry.row.source.investment!.purpose}</span>
        <Badge variant={entry.status === "ready" ? "success-subtle" : "warning-subtle"}>{entry.reason}</Badge>
        <Button variant="outline" disabled={busy || checking} onClick={() => onChange(key, {
          fundLegs: [...legs, { code: "", name: "", date: legs[0]?.date ?? "", amount: "", quantity: "", fee: "0", activityType: legs[0]?.activityType === "BUY" ? "SELL" : "BUY" }],
          fundAssets: {}, fundChecked: undefined,
        })}>{legs.length ? "补充转换另一侧" : "补全投资明细"}</Button>
        {legs.length > 1 && <Button variant="outline" disabled={busy || checking} onClick={() =>
          onChange(key, { fundLegs: legs.slice(0, -1), fundAssets: {}, fundChecked: undefined })}>移除最后一侧</Button>}
      </div>;
    })}
    <ImportReviewTable data={data} columns={columns} getRowId={(row) => row.id} busy={busy || checking}
      canSelect={() => true} onSkip={(selected) => selected.forEach((row) => onChange(rowKey(row.entry.row), { excluded: true }))}
      onRestore={(selected) => selected.forEach((row) => onChange(rowKey(row.entry.row), { excluded: false }))}
      onDataChange={(next) => {
        for (const entry of entries) {
          const key = rowKey(entry.row), before = decisions[key]?.fundLegs ?? entry.row.source.investment!.legs;
          const legs = next.filter((row) => rowKey(row.entry.row) === key).map(({ id: _id, entry: _entry, index: _index, assetSymbol: _symbol, ...leg }) => leg);
          if (JSON.stringify(legs) !== JSON.stringify(before)) onChange(key, { fundLegs: legs, fundAssets: {}, fundChecked: undefined });
        }
      }} />
    <Button disabled={busy || checking || !entries.length} onClick={() => void checkAssets()}>{checking ? "正在识别资产…" : "识别并校验基金资产"}</Button>
  </div>;
}

export function StatementInvestmentFunding({ preview, decisions, accounts, activities, busy, onChange }: Props) {
  const { formatAmount } = useAmountFormatting();
  const { formatDateTime, formatDate } = useDateFormatting();
  const investmentAccounts = accounts.filter((account) => account.accountType === "SECURITIES" && account.trackingMode === "TRANSACTIONS");
  const nodes = investmentNodes(activities, preview);
  const fundingGroups = new Map<string, PreviewRow[]>();
  for (const entry of preview.filter((entry) => isInvestmentCash(entry.row) && !["excluded", "duplicate"].includes(entry.status))) {
    const source = entry.row.source;
    const key = JSON.stringify([source.merchant.normalize("NFKC").trim() || rowKey(entry.row), source.currency]);
    const group = fundingGroups.get(key) ?? [];
    group.push(entry);
    fundingGroups.set(key, group);
  }
  return <div className="space-y-4">
    {[...fundingGroups].map(([key, entries]) => {
      const source = entries[0].row.source;
      const company = source.merchant || source.description;
      const selectedAccount = decisions[rowKey(entries[0].row)]?.investmentAccountId ?? "";
      const accountId = entries.every((entry) => (decisions[rowKey(entry.row)]?.investmentAccountId ?? "") === selectedAccount) ? selectedAccount : "";
      const confirmed = entries.every((entry) => decisions[rowKey(entry.row)]?.confirmed);
      const changeGroup = (patch: RowDecision) => entries.forEach((entry) => onChange(rowKey(entry.row), patch));
      return <div key={key} className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{company}</p>
          <Badge variant="secondary">{entries.length} 笔 · {source.currency}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">确认后，每笔流水分别创建资金转账的两侧。基金交易文件稍后导入时再生成申购或赎回。</p>
        <ImportChoice label="资金对应的投资账户" value={accountId}
          options={investmentAccounts.filter((account) => account.currency === source.currency && entries.every((entry) => account.id !== entry.accountId)).map((account) => ({ value: account.id, label: account.name }))}
          disabled={busy} onChange={(id) => changeGroup({ investmentAccountId: id, confirmed: false, investmentPeerKey: undefined })} />
        <StatementMappingDetails entries={entries} label={`投资资金：${company} · ${source.currency}`} open={!confirmed}
          accounts={accounts.map((account) => ({ value: account.id, label: account.name }))} />
        <div className="flex items-center gap-2 text-sm"><Checkbox aria-label="已核对资金方向、最终金额及投资账户" checked={confirmed} disabled={busy}
          onCheckedChange={(checked) => changeGroup({ confirmed: checked === true })} />已核对资金方向、最终金额及投资账户</div>
      </div>;
    })}
    {preview.filter((entry) => entry.investmentLink && entry.status !== "excluded").map((entry) => {
      const key = rowKey(entry.row), node = nodes.find((node) => node.entry === entry);
      const candidates = node && !node.metadata.investment?.peerKey ? investmentCandidates(node, nodes, false) : [];
      return <div key={key} className="bg-muted/30 space-y-3 rounded-md border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant={entry.investmentLink?.peerKey ? "success-subtle" : "warning-subtle"}>
            {entry.investmentLink?.peerKey ? "已关联投资资金与买卖" : "待关联"}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {entry.row.source.datePrecision === "date" ? formatDate(entry.row.source.date) : formatDateTime(entry.row.source.date)}
          </span>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate font-medium">{entry.row.source.merchant || entry.row.source.description}</span>
          <span className="shrink-0 font-medium tabular-nums">{formatAmount(entry.amount, entry.row.source.currency)}</span>
        </div>
        <p className="text-muted-foreground break-words text-xs">
          {entry.row.source.compositeIdentity ? statementReference(entry.row.source) : `订单号：${entry.row.source.recordId}`}
        </p>
        {!entry.investmentLink?.peerKey && <p className="text-muted-foreground text-xs leading-relaxed">允许先导入当前文件，补充另一侧文件后再核对关联。</p>}
        {entry.investmentLink?.peerKey && entry.status === "ready" && <Button variant="outline" disabled={busy}
          onClick={() => onChange(key, { noInvestmentLink: true, investmentPeerKey: undefined })}>取消本次投资关联</Button>}
        {!!candidates.length && <ImportChoice label="人工确认关联交易" value={decisions[key]?.investmentPeerKey ?? ""}
          options={candidates.map((peer) => ({ value: peer.key,
            label: `${formatDateTime(peer.source.date)} · ${formatAmount(peer.metadata.booking.amount, peer.source.currency)} · ${peer.source.merchant} · ${statementReference(peer.source)}` }))}
          disabled={busy} onChange={(peer) => onChange(key, { investmentPeerKey: peer || undefined })} />}
        {!entry.investmentLink?.peerKey && <div className="flex items-center gap-2 text-sm"><Checkbox aria-label="此笔无需关联另一侧" checked={!!decisions[key]?.noInvestmentLink} disabled={busy}
          onCheckedChange={(checked) => onChange(key, { noInvestmentLink: checked === true })} />此笔无需关联另一侧</div>}
      </div>;
    })}
  </div>;
}

export function StatementSavedInvestments({ ctx, activities, busy, onRefresh }: {
  ctx: AddonContext; activities: ExistingActivity[]; busy: boolean; onRefresh(): Promise<void>;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const { formatAmount } = useAmountFormatting();
  const { formatDateTime } = useDateFormatting();
  let nodes: ReturnType<typeof investmentNodes>;
  try { nodes = investmentNodes(activities); }
  catch (cause) { return <AlertFeedback variant="error" title="投资来源无法读取">{cause instanceof Error ? cause.message : "请刷新核对"}</AlertFeedback>; }
  const funding = nodes.filter((node) => node.metadata.investment?.role === "funding");
  if (!funding.length) return null;
  async function save(key: string, cancel: boolean) {
    setWorking(true); setError("");
    try {
      const current = await ctx.api.activities.getAll();
      const updates = cancel ? cancelInvestmentLink(current, key) : linkSavedInvestment(current, key, choices[key]);
      const result = await ctx.api.activities.saveMany({ updates });
      if (result.errors.length || result.updated.length !== updates.length) throw new Error("投资关联未完整保存");
      await onRefresh();
    } catch (cause) {
      setError((cause instanceof Error ? cause.message : "关联结果未确认") + "；请刷新核对后再操作");
    } finally { setWorking(false); }
  }
  return <Accordion className="bg-muted/20 mb-4 rounded-lg border">
    <AccordionItem value="saved-investments" className="border-0">
    <AccordionTrigger className="hover:bg-muted/40 rounded-lg px-4 py-3 hover:no-underline">
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <Icons.ArrowLeftRight className="text-muted-foreground size-4 shrink-0" />
        <span className="text-sm">已保存投资资金与买卖关联</span>
        <Badge variant="secondary" className="font-normal">{funding.length} 笔资金流水</Badge>
      </span>
    </AccordionTrigger>
    <AccordionContent className="space-y-3 border-t px-4 pt-4">
    {error && <AlertFeedback variant="error" title="需要核对">{error}</AlertFeedback>}
    {funding.map((node) => <div key={node.key} className="bg-background space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant={node.metadata.investment?.peerKey ? "success-subtle" : "warning-subtle"}>
          {node.metadata.investment?.peerKey ? "已关联" : "待关联"}
        </Badge>
        <span className="text-muted-foreground text-xs">{formatDateTime(node.source.date)}</span>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium">{node.source.merchant}</span>
        <span className="shrink-0 font-medium tabular-nums">{formatAmount(node.metadata.booking.amount, node.source.currency)}</span>
      </div>
      {node.metadata.investment?.peerKey
        ? <Button variant="outline" disabled={busy || working} onClick={() => void save(node.key, true)}>取消已保存投资关联</Button>
        : <>
          <p className="text-muted-foreground text-sm">待关联；原有转账和投资交易均已保留。人工确认须核对日期、用途及账户。</p>
          <ImportChoice label="已保存投资交易候选" value={choices[node.key] ?? ""} disabled={busy || working}
            options={investmentCandidates(node, nodes, false).map((peer) => ({ value: peer.key,
              label: `${formatDateTime(peer.source.date)} · ${formatAmount(peer.metadata.booking.amount, peer.source.currency)} · ${peer.source.recordId}${peer.legacy ? " · 旧插件记录" : ""}` }))}
            onChange={(peer) => setChoices((current) => ({ ...current, [node.key]: peer }))} />
          <Button disabled={busy || working || !choices[node.key]} onClick={() => void save(node.key, false)}>确认关联已保存投资交易</Button>
        </>}
    </div>)}
    </AccordionContent>
    </AccordionItem>
  </Accordion>;
}
