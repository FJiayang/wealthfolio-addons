import {
  ImportWizardLayout,
  CancelConfirmationDialog,
  ImportResultSummary,
  ImportStatusCards,
  ImportChoice,
  ImportMappingGroup,
  ImportReviewTable,
} from "@wealthfolio/import-wizard-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Account, AddonContext } from "@wealthfolio/addon-sdk";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  AlertFeedback,
  Button,
  Badge,
  Checkbox,
  Icons,
  Page,
  PageContent,
  PageHeader,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  useNumberFormatting,
} from "@wealthfolio/ui";
import { getStatementParser, parseStatement, statementParsers } from "../parsers";
import type { EntryKind, StatementDocument } from "../parsers/types";
import { mappingKey, resolveAccount } from "../import/account-matching";
import {
  buildPreview,
  MAPPING_KEY,
  MAPPING_V2_KEY,
  rowKey,
  sourceKey,
  restoreMappings,
  type Decisions,
  type ExistingActivity,
  type Mappings,
  type PreviewRow,
  type PreviewStatus,
  type RowDecision,
} from "../import/ledger";
import { createSubmitter } from "../import/session";
import { labels, kinds, statusAppearance } from "./statement-presentation";
import { StatementMappingDetails } from "./statement-mapping-details";
import { StatementFilePreview } from "./statement-file-preview";
import { StatementFeeConfirmation } from "./statement-fee-confirmation";
import { StatementReconciliation } from "./statement-reconciliation";
import { useStatementReviewColumns } from "./use-statement-review-columns";
import { RulesEditor } from "./rules-editor";
import { TransferPanel } from "./transfer-panel";
import { RULES_KEY, applyRules, restoreRules, type ImportRule } from "../import/rules";
import { FileDropzone } from "../components/file-dropzone";
import { WizardStepIndicator } from "../components/step-indicator";
import { StepNavigation } from "../components/step-navigation";
import { StatementAssociations } from "./statement-associations";
import { cancelSavedAssociation } from "../import/associations";
import { investmentTreatment } from "../import/investments";
import { StatementInvestmentReview, StatementInvestmentFunding, StatementSavedInvestments } from "./statement-investments";
import { StatementFinalPreview } from "./statement-final-preview";
type ImportStep = "upload" | "mapping" | "assets" | "preview" | "confirm" | "result";

const accountTypes: Record<Account["accountType"], string> = {
  CASH: "现金",
  CREDIT_CARD: "信用卡",
  SECURITIES: "证券",
  CRYPTOCURRENCY: "加密货币",
};
// Activity chips follow the host import confirm-step.tsx.
const activityTypeDisplay = {
  BUY: { label: "基金申购", icon: Icons.TrendingUp, color: "text-green-600 dark:text-green-400" },
  SELL: { label: "基金赎回", icon: Icons.TrendingDown, color: "text-red-500 dark:text-red-400" },
  DIVIDEND: { label: "分红再投资", icon: Icons.DollarSign, color: "text-emerald-600 dark:text-emerald-400" },
  DEPOSIT: { label: "收入", icon: Icons.ArrowDownLeft, color: "text-blue-600 dark:text-blue-400" },
  WITHDRAWAL: { label: "支出", icon: Icons.ArrowUpRight, color: "text-orange-600 dark:text-orange-400" },
  CREDIT: { label: "支出退款", icon: Icons.RefreshCw, color: "text-emerald-600 dark:text-emerald-400" },
  TRANSFER_IN: { label: "转入", icon: Icons.ArrowDownLeft, color: "text-blue-600 dark:text-blue-400" },
  TRANSFER_OUT: { label: "转出", icon: Icons.ArrowUpRight, color: "text-orange-600 dark:text-orange-400" },
  FEE: { label: "手续费", icon: Icons.Receipt, color: "text-slate-600 dark:text-slate-400" },
};

function Choice({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange(value: string): void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value || "__none__"}
      onValueChange={(next) => onChange(next === "__none__" ? "" : (next ?? ""))}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={label}
        title={options.find((option) => option.value === value)?.label}
        className="h-8 w-full min-w-0 py-1 text-xs"
      >
        <SelectValue>
          {options.find((option) => option.value === value)?.label ?? "请选择"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">{"请选择"}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function StatementImportPage({ ctx }: { ctx: AddonContext }) {
  const { formatDecimal } = useNumberFormatting();
  const n = (value: number) => formatDecimal(value, { maximumFractionDigits: 0 });
  const [format, setFormat] = useState("");
  const [variantId, setVariantId] = useState("");
  const [, setRawText] = useState("");
  const [documents, setDocuments] = useState<StatementDocument[]>([]);
  const [rules, setRules] = useState<ImportRule[]>([]);
  const [selectedSheets, setSelectedSheets] = useState<Record<string, string[]>>({});
  const [sourceAccount, setSourceAccount] = useState("");
  const [password, setPassword] = useState("");
  const [currency, setCurrency] = useState("");
  const fileBytes = useRef(new Map<string, Uint8Array>());
  const fileOptions = useRef(new Map<string, { password?: string; currency?: string }>());
  const uploadSequence = useRef(0);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [selectedMappingRows, setSelectedMappingRows] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const [submission, setSubmission] = useState<Awaited<
    ReturnType<ReturnType<typeof createSubmitter>>
  > | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activities, setActivities] = useState<ExistingActivity[]>([]);
  const [statement, setStatement] = useState<StatementDocument | null>(null);
  const rows = useMemo(
    () =>
      documents.flatMap((doc) =>
        doc.rows.filter(
          (row) =>
            !selectedSheets[doc.fileId!] ||
            selectedSheets[doc.fileId!].includes(row.source.sheetName!),
        ),
      ),
    [documents, selectedSheets],
  );
  const parser = statement ? getStatementParser(statement.parserId) : undefined;
  const [mappings, setMappings] = useState<Mappings>({});
  const [mappingChoices, setMappingChoices] = useState<Mappings>({});
  const effectiveMappings = useMemo(
    () => ({ ...mappings, ...mappingChoices }),
    [mappings, mappingChoices],
  );
  const [decisions, setDecisions] = useState<Decisions>({});
  const [recognizeInvestments, setRecognizeInvestments] = useState(false);
  const importOptions = useMemo(() => ({ recognizeInvestments }), [recognizeInvestments]);
  const hasInvestments = recognizeInvestments && rows.some((row) => row.source.investment);
  const [step, setStep] = useState<ImportStep>("upload");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  const submitter = useMemo(() => createSubmitter(ctx.api), [ctx]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      ctx.api.accounts.getAll(),
      ctx.api.activities.getAll(),
      ctx.api.storage.get(MAPPING_KEY),
      ctx.api.storage.get(MAPPING_V2_KEY),
      ctx.api.storage.get(RULES_KEY),
    ])
      .then(([allAccounts, allActivities, saved, savedV2, savedRules]) => {
        if (!active) return;
        setAccounts(allAccounts);
        setActivities(allActivities);
        try {
          setMappings({
            ...restoreMappings(saved, allAccounts),
            ...restoreMappings(savedV2, allAccounts),
          });
          setRules(restoreRules(savedRules));
        } catch {
          setError("已保存的账户映射无法读取，请重置映射后重新选择。");
        }
        setLoaded(true);
      })
      .catch(() => {
        if (active) setError("读取账户或账目失败，请检查插件权限并重新打开页面。");
      });
    return () => {
      active = false;
      fileOptions.current.clear();
      fileBytes.current.clear();
    };
  }, [ctx]);

  const accountOptions = accounts.map((account) => ({
    value: account.id,
    label: `${account.name} · ${accountTypes[account.accountType]} · ${account.currency}`,
  }));
  const evaluated = useMemo(() => {
    try {
      return {
        preview: buildPreview(rows, accounts, activities, effectiveMappings, decisions, rules, importOptions),
        error: "",
      };
    } catch (cause) {
      return {
        preview: [] as PreviewRow[],
        error: cause instanceof Error ? cause.message : "来源信息无法读取。",
      };
    }
  }, [rows, accounts, activities, effectiveMappings, decisions, rules, importOptions]);
  const preview = evaluated.preview;
  const counts = Object.fromEntries(
    Object.keys(labels).map((status) => [
      status,
      preview.filter((entry) => entry.status === status).length,
    ]),
  );
  const paymentMethods = [
    ...new Set(rows.filter((row) => !row.excluded).map((row) => mappingKey(row.source))),
  ];
  const methodSource = (method: string) =>
    rows.find((row) => mappingKey(row.source) === method)!.source;
  const methodLabel = (method: string) => {
    const source = methodSource(method);
    return source.system === "alipay"
      ? source.paymentMethod
      : `${source.paymentMethod || "未提供付款方式"} · ${getStatementParser(source.system).displayName} · ${source.sourceAccount || source.accountHint || "来源账户未提供"}`;
  };
  const accountResolutions = new Map(
    paymentMethods.map((method) => {
      const source = methodSource(method);
      const ruleAccounts = new Set(
        rows
          .filter((row) => mappingKey(row.source) === method && !row.error)
          .map((row) => applyRules(row.source, rules).accountId)
          .filter(Boolean),
      );
      return [
        method,
        resolveAccount(
          source.paymentMethod,
          accounts,
          effectiveMappings,
          source,
          ruleAccounts.size === 1 ? [...ruleAccounts][0] : undefined,
        ),
      ];
    }),
  );
  const activeMethods = paymentMethods.filter((method) =>
    preview.some(
      (entry) =>
        mappingKey(entry.row.source) === method &&
        entry.status !== "excluded" &&
        entry.status !== "duplicate",
    ),
  );
  const unresolvedMethods = activeMethods.filter((method) =>
    preview.some(
      (entry) =>
        mappingKey(entry.row.source) === method &&
        entry.status !== "excluded" &&
        entry.status !== "duplicate" &&
        !entry.accountId,
    ),
  );
  const blockedCount = (counts.review ?? 0) + (counts.error ?? 0);
  const pendingFunds = preview.some((entry) => entry.row.source.investment && ["review", "error"].includes(entry.status));
  const incompleteInvestmentMappings = preview.flatMap((entry) => {
    if (["excluded", "duplicate"].includes(entry.status)) return [];
    const missing: string[] = [];
    if (entry.row.source.investment) {
      const account = accounts.find((item) => item.id === entry.accountId);
      if (!account || account.accountType !== "SECURITIES" || account.trackingMode !== "TRANSACTIONS" || account.currency !== "CNY")
        missing.push("基金持有账户");
    } else if (entry.row.investmentCandidate) {
      const decision = decisions[rowKey(entry.row)] ?? {};
      const treatment = investmentTreatment(entry.row, decision);
      if (!treatment) missing.push("处理方式");
      if (!accounts.some((account) => account.id === entry.accountId)) missing.push("资金账户");
      if (treatment === "transfer") {
        if (!["transferIn", "transferOut"].includes(entry.kind ?? "")) missing.push("资金方向");
        const account = accounts.find((item) => item.id === decision.investmentAccountId);
        if (!account || account.accountType !== "SECURITIES" || account.trackingMode !== "TRANSACTIONS" ||
          account.currency !== entry.row.source.currency || account.id === entry.accountId) missing.push("投资账户");
      }
    }
    return missing.length ? [{ entry, missing }] : [];
  });
  const investmentIssueCounts = new Map<string, number>();
  for (const { missing } of incompleteInvestmentMappings)
    for (const issue of missing) investmentIssueCounts.set(issue, (investmentIssueCounts.get(issue) ?? 0) + 1);
  const activityCounts = new Map<string, number>();
  for (const entry of preview.filter((entry) => entry.status === "ready"))
    for (const create of entry.creates ?? (entry.create ? [entry.create] : []))
      activityCounts.set(create.activityType, (activityCounts.get(create.activityType) ?? 0) + 1);
  const unresolvedKinds = preview.filter(
    (entry) => entry.status !== "excluded" && entry.status !== "duplicate" && !entry.kind && !entry.row.investmentCandidate,
  );
  const kindGroups = new Map<string, PreviewRow[]>();
  for (const entry of unresolvedKinds) {
    const key = JSON.stringify([entry.row.source.system, entry.row.source.direction]);
    const group = kindGroups.get(key) ?? [];
    group.push(entry);
    kindGroups.set(key, group);
  }
  const reviewGroups = new Map<string, PreviewRow[]>();
  for (const entry of preview) {
    if (
      entry.status === "excluded" ||
      entry.status === "duplicate" ||
      !entry.row.reviewReason ||
      decisions[rowKey(entry.row)]?.confirmed
    )
      continue;
    const key = JSON.stringify([
      entry.row.source.system,
      entry.row.source.status,
      entry.row.reviewReason,
    ]);
    const group = reviewGroups.get(key) ?? [];
    group.push(entry);
    reviewGroups.set(key, group);
  }
  const reviewCount = [...reviewGroups.values()].reduce(
    (count, entries) => count + entries.length,
    0,
  );
  const identityGroups = new Map<string, PreviewRow[]>();
  for (const entry of preview) if (entry.identityConflict) {
    const key = JSON.stringify([entry.identityConflict.signature, entry.row.source.fileName]);
    identityGroups.set(key, [...(identityGroups.get(key) ?? []), entry]);
  }

  function changeMapping(method: string, accountId: string) {
    setMappingChoices((current) => ({ ...current, [method]: accountId }));
    setDecisions((current) =>
      Object.fromEntries(
        Object.entries(current).map(([line, decision]) => [
          line,
          rows.some((row) => rowKey(row) === line && mappingKey(row.source) === method)
            ? { ...decision, confirmed: false }
            : decision,
        ]),
      ),
    );
  }

  function skipMethods(excluded: boolean) {
    setDecisions((current) => {
      const next = { ...current };
      for (const row of rows)
        if (
          (selectedMethods.includes(mappingKey(row.source)) ||
            selectedMappingRows.includes(rowKey(row))) &&
          !row.excluded
        )
          next[rowKey(row)] = {
            ...next[rowKey(row)],
            excluded,
            confirmed: false,
          };
      return next;
    });
    setSelectedMethods([]);
    setSelectedMappingRows([]);
  }

  function changeDecision(line: string, patch: RowDecision) {
    if (step === "result") setStep("preview");
    const affectsConfirmation = ["amount", "kind", "accountId", "investmentAccountId", "investmentTreatment", "excluded"]
      .some((field) => Object.hasOwn(patch, field));
    setDecisions((current) => ({
      ...current,
      [line]: {
        ...current[line],
        ...(affectsConfirmation ? { confirmed: false } : {}),
        ...(patch.amount !== undefined || Object.hasOwn(patch, "kind") || patch.accountId !== undefined || Object.hasOwn(patch, "investmentTreatment")
          ? { feeConfirmed: false }
          : {}),
        ...patch,
      },
    }));
    setMessage("");
  }

  function changeGroupKind(entries: PreviewRow[], kind: string) {
    setDecisions((current) => {
      const next = { ...current };
      for (const entry of entries) {
        const line = rowKey(entry.row);
        next[line] = {
          ...current[line],
          kind: kind ? (kind as EntryKind) : undefined,
          confirmed: false,
        };
      }
      return next;
    });
    setMessage("");
  }

  const renderDetails = (entries: PreviewRow[], label: string, open = true) => (
    <StatementMappingDetails
      entries={entries}
      label={label}
      open={open}
      accounts={accountOptions}
    />
  );
  const renderIdentityConflicts = () => identityGroups.size > 0 && (
    <ImportMappingGroup pending title={`跨账单流水待核对 · ${n([...identityGroups.values()].reduce((sum, entries) => sum + entries.length, 0))} 笔`}>
      <p className="text-muted-foreground text-sm">不同账单中有无法区分的相同流水。请核实历史记录后选择；视为新流水会创建新的账目。</p>
      {[...identityGroups].map(([key, entries]) => {
        const conflict = entries[0].identityConflict!;
        return <div key={key} className="space-y-3 rounded-lg border p-4">
          <p>{entries[0].row.source.fileName} · 本组 {n(entries.length)} 笔 · 已有 {n(conflict.historicalCount)} 笔 · 其他待导入 {n(conflict.incomingCount)} 笔</p>
          <p className="text-muted-foreground break-words text-sm">相关来源：{conflict.files.join("、") || "未提供文件名"}</p>
          {renderDetails(entries, `跨账单：${entries[0].row.source.fileName}`, false)}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => entries.forEach((entry) => changeDecision(rowKey(entry.row), { identityNewFor: entry.identityConflict!.signature }))}>本组视为新流水</Button>
            <Button variant="outline" disabled={busy} onClick={() => entries.forEach((entry) => changeDecision(rowKey(entry.row), { excluded: true }))}>本组本次跳过</Button>
          </div>
          <div className="space-y-2">{entries.map((entry) => <div key={rowKey(entry.row)} className="flex flex-wrap items-center gap-2 text-sm">
            <span>{entry.row.source.fileName} · 第 {n(entry.row.source.lineNumber)} 行</span>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => changeDecision(rowKey(entry.row), { identityNewFor: entry.identityConflict!.signature })}>视为新流水</Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => changeDecision(rowKey(entry.row), { excluded: true })}>本次跳过</Button>
          </div>)}</div>
        </div>;
      })}
    </ImportMappingGroup>
  );

  async function upload(file: File) {
    setFile(file);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (format === "ant-fund" && !recognizeInvestments) throw new Error("请先开启识别投资交易流水");
      const parsed = await parseStatement(bytes, file.name, {
        channel: format || undefined,
        variantId: variantId || undefined,
        sourceAccount,
        password: password || undefined,
        currency: currency || undefined,
        assets: ctx.assets,
        fileId: String(++uploadSequence.current),
      });
      fileBytes.current.set(parsed.fileId!, bytes);
      fileOptions.current.set(parsed.fileId!, { password: password || undefined, currency: currency || undefined });
      if (parsed.parserId !== format) throw new Error("文件与所选流水渠道不符，请核对账单格式。");
      setRawText("");
      setDocuments((current) => [...current, parsed]);
      setSourceAccount("");
      setPassword("");
      setCurrency("");
      setStatement(parsed);
      setMappingChoices((current) => current);
      setDecisions((current) => current);
      setSelectedMethods([]);
      setSelectedMappingRows([]);
      setStep("upload");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "账单读取失败。");
    } finally {
      setBusy(false);
    }
  }

  async function saveMappings() {
    if (unresolvedMethods.length || unresolvedKinds.length || incompleteInvestmentMappings.length) return;
    setBusy(true);
    setError("");
    try {
      const nextMappings = { ...effectiveMappings };
      for (const [method, resolution] of accountResolutions) {
        const source = methodSource(method);
        if (
          !Object.hasOwn(mappingChoices, method) &&
          !Object.hasOwn(mappings, method) &&
          !(source.system === "alipay" && Object.hasOwn(mappings, source.paymentMethod)) &&
          rows.some(
            (row) =>
              mappingKey(row.source) === method &&
              !row.error &&
              applyRules(row.source, rules).accountId,
          )
        )
          continue;
        if (resolution.accountId) nextMappings[method] = resolution.accountId;
        else delete nextMappings[method];
      }
      if (statement?.parserId === "alipay") {
        for (const method of paymentMethods)
          delete nextMappings[methodSource(method).paymentMethod];
      }
      await ctx.api.storage.set(MAPPING_V2_KEY, JSON.stringify(nextMappings));
      const legacy = Object.fromEntries(
        Object.entries(nextMappings).filter(([key]) => !key.startsWith("[")),
      );
      if (!Object.keys(legacy).length) await ctx.api.storage.delete(MAPPING_KEY);
      setMappings(nextMappings);
      setMappingChoices(
        Object.fromEntries(
          [...accountResolutions]
            .filter(([, resolution]) => !resolution.accountId)
            .map(([method]) => [method, ""]),
        ),
      );
      setStep(hasInvestments ? "assets" : "preview");
      setMessage("");
    } catch {
      setError("账户映射保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function viewSpending(notify = false, investment = false) {
    setNavigationError("");
    try {
      await ctx.router.setLeaveGuard(false);
      if (notify) ctx.api.toast.success("导入成功，分类由系统后台处理");
      await ctx.api.navigation.navigate(investment ? "/activities?tab=investments" : "/activities?tab=spending");
    } catch {
      setNavigationError(investment ? "无法打开投资页，请点击“查看投资”重试。已保存的账目不会再次提交。" : "无法打开收支页，请点击“查看收支”重试。已保存的账目不会再次提交。");
    }
  }

  async function submit() {
    if (submitting.current || blockedCount || !counts.ready) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await submitter(rows, effectiveMappings, decisions, preview, rules, importOptions);
      setSubmission(result);
      setMessage(result.message);
      const [currentAccounts, currentActivities] = await Promise.all([
        ctx.api.accounts.getAll(),
        ctx.api.activities.getAll(),
      ]);
      setAccounts(currentAccounts);
      setActivities(currentActivities);
      setStep(result.outcome === "changed" || result.outcome === "empty" ? "preview" : "result");
      if (
        result.outcome === "success" &&
        !preview.some((entry) => entry.association) &&
        !preview.some((entry) => entry.kind === "investment") &&
        !preview.some((entry) => entry.kind === "transferIn" || entry.kind === "transferOut")
      )
        await viewSpending(true);
    } catch {
      setError("提交或结果核对失败。请点击“刷新核对”重新读取账目后再提交；请勿直接重复导入。");
      setLoaded(false);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const [allAccounts, allActivities] = await Promise.all([
        ctx.api.accounts.getAll(),
        ctx.api.activities.getAll(),
      ]);
      setAccounts(allAccounts);
      setActivities(allActivities);
      setLoaded(true);
      setMessage("已重新读取账户与账目，请核对预览。");
    } catch {
      setError("刷新失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function cancelAssociation(paymentId: string) {
    setBusy(true);
    setError("");
    try {
      const current = await ctx.api.activities.getAll();
      const updates = cancelSavedAssociation(current, paymentId);
      const result = await ctx.api.activities.saveMany({ updates });
      if (result.errors.length || result.updated.length !== updates.length)
        throw new Error("取消关联未完整保存，请刷新核对。");
      setActivities(await ctx.api.activities.getAll());
      setMessage("已取消关联，未被人工修改的三方金额已恢复；双方独立记账，下次不会再次自动关联。");
    } catch (cause) {
      setError(cause instanceof Error ? `${cause.message} 请刷新核对后再操作。` : "取消关联结果不明确，请刷新核对后再操作。");
      setLoaded(false);
    } finally { setBusy(false); }
  }

  async function resetMappings() {
    setBusy(true);
    try {
      await ctx.api.storage.delete(MAPPING_KEY);
      await ctx.api.storage.delete(MAPPING_V2_KEY);
      setMappings({});
      setDecisions((current) =>
        Object.fromEntries(
          Object.entries(current).map(([line, decision]) => [
            line,
            { ...decision, confirmed: false },
          ]),
        ),
      );
      setMappingChoices(Object.fromEntries(paymentMethods.map((method) => [method, ""])));
      setError("");
      setMessage("已重置保存的账户映射。");
    } catch {
      setError("重置映射失败。");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setDocuments([]);
    setSelectedSheets({});
    fileBytes.current.clear();
    fileOptions.current.clear();
    uploadSequence.current = 0;
    setSourceAccount("");
    setPassword("");
    setCurrency("");
    setSelectedMappingRows([]);
    setRawText("");
    setSelectedMethods([]);
    setTypeFilter("");
    setAccountFilter("");
    setStatusFilter("");
    setFile(null);
    setSubmission(null);
    setNavigationError("");
    setStatement(null);
    setMappingChoices({});
    setDecisions({});
    setRecognizeInvestments(false);
    setStep("upload");
    setError("");
    setMessage("");
  }

  useEffect(() => {
    void ctx.router.setLeaveGuard(rows.length > 0 && step !== "result");
  }, [ctx, rows.length, step]);

  const locked = useCallback(
    (entry: PreviewRow) =>
      busy || !!entry.association || !!entry.row.source.investment || entry.status === "excluded" || entry.status === "duplicate" || !!entry.row.error,
    [busy],
  );
  const gridRows = useMemo(
    () =>
      preview
        .filter(
          (entry) =>
            (!typeFilter || entry.kind === typeFilter) &&
            (!accountFilter || entry.accountId === accountFilter) &&
            (!statusFilter || entry.status === statusFilter),
        )
        .map((entry) => ({ ...entry, line: entry.row.source.lineNumber, id: rowKey(entry.row) })),
    [preview, typeFilter, accountFilter, statusFilter],
  );
  const reviewSources = useMemo(() => {
    const byId = new Map(rows.map((row) => [rowKey(row), row]));
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = sourceKey(row.source);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return { byId, counts };
  }, [rows]);
  const columns = useStatementReviewColumns({ locked, accountOptions });
  const steps = [
    { id: "upload", label: "上传" },
    { id: "mapping", label: "映射" },
    ...(hasInvestments ? [{ id: "assets", label: "识别资产" }] : []),
    { id: "preview", label: "审核交易" },
    { id: "confirm", label: "导入" },
  ];
  const statistics = (Object.keys(labels) as PreviewStatus[]).map((status) => {
    const { tone, icon: Icon } = statusAppearance[status];
    return {
      label: labels[status],
      value: n(counts[status] ?? 0),
      tone,
      icon: <Icon className="size-4" />,
    };
  });
  function back() {
    if (step === "confirm") setStep("preview");
    else if (step === "preview") setStep(hasInvestments ? "assets" : "mapping");
    else if (step === "assets") setStep("mapping");
    else setStep("upload");
  }
  function next() {
    if (step === "upload") setStep("mapping");
    else if (step === "mapping") void saveMappings();
    else if (step === "assets") setStep("preview");
    else if (step === "preview" && !blockedCount) setStep("confirm");
    else if (step === "confirm") void submit();
  }

  return (
    <div className="statement-import h-dvh min-h-0">
      <Page className="flex h-full min-h-0 flex-col">
        <PageHeader
          heading={"账单导入"}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
                {"刷新核对"}
              </Button>
              <Button variant="ghost" disabled={busy || !file} onClick={() => setConfirmOpen(true)}>
                {"结束 / 取消本次导入"}
              </Button>
            </div>
          }
        />
        <PageContent
          withPadding={false}
          className="min-h-0 flex-1 md:min-h-0 [&>div]:h-full [&>div]:min-h-0"
        >
          <div className="h-full min-h-0 px-2 pt-2 pb-6 sm:px-4 sm:pt-4 md:px-6 md:pt-6">
            <ImportWizardLayout
              isResult={step === "result"}
              steps={<WizardStepIndicator label={"导入进度"} steps={steps} currentStep={step} />}
              navigation={
                step !== "result" ? (
                  <StepNavigation
                    onBack={back}
                    onNext={next}
                    canGoBack={!busy && step !== "upload"}
                    canGoNext={
                      !busy &&
                      loaded &&
                      (step !== "upload" || rows.length > 0) &&
                      !evaluated.error &&
                      (step === "upload" ||
                        (step === "assets" ? !pendingFunds : step === "mapping"
                          ? !unresolvedMethods.length && !unresolvedKinds.length && !incompleteInvestmentMappings.length
                          : !!counts.ready && !blockedCount))
                    }
                    nextLabel={
                      step === "confirm"
                        ? `导入 ${n(counts.ready)} 笔`
                        : step === "mapping"
                          ? "保存映射并预览"
                          : step === "upload"
                            ? "补齐映射"
                            : "提交确认"
                    }
                    nextLoadingLabel={"正在核对并保存…"}
                    backLabel={step === "preview" ? "返回账户映射" : "上一步"}
                    isNextLoading={busy}
                  />
                ) : undefined
              }
            >
              {(error || evaluated.error) && (
                <AlertFeedback variant="error" title={"错误"} role="alert">
                  {error || evaluated.error}
                </AlertFeedback>
              )}
              {navigationError && (
                <AlertFeedback variant="warning" title="页面跳转失败" role="alert">
                  {navigationError}
                </AlertFeedback>
              )}
              {message && step !== "result" && (
                <AlertFeedback variant="warning" title={"核对提示"}>
                  {message}
                </AlertFeedback>
              )}
              {recognizeInvestments && <StatementSavedInvestments ctx={ctx} activities={activities} busy={busy} onRefresh={refresh} />}
              {step === "upload" && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Switch id="recognize-investments" aria-label="识别投资交易流水" checked={recognizeInvestments} disabled={busy || documents.length > 0}
                      onCheckedChange={(checked) => setRecognizeInvestments(checked === true)} />
                    <label htmlFor="recognize-investments">识别投资交易流水</label>
                  </div>
                  <p className="text-muted-foreground text-sm">开启后识别疑似投资资金和基金明细；请在映射页确认流水性质、方向及账户。添加文件后本次不能切换。</p>
                  <Input
                    aria-label="来源账户标识"
                    placeholder="银行账单缺少账号时，填写稳定的来源账户标识；不要使用文件名"
                    value={sourceAccount}
                    onChange={(event) => setSourceAccount(event.target.value)}
                    disabled={busy}
                  />
                  <ImportChoice
                    label="流水格式"
                    value={format}
                    disabled={busy}
                    options={statementParsers.filter((candidate) => recognizeInvestments || candidate.id !== "ant-fund").map((candidate) => ({
                      value: candidate.id,
                      label: `${candidate.displayName} ${candidate.formats.map((format) => format.toUpperCase()).join(" / ")}`,
                    }))}
                    onChange={(value) => {
                      setFormat(value);
                      setVariantId("");
                      setPassword("");
                      setCurrency("");
                      setFile(null);
                    }}
                  />
                  {format && (
                    <>
                      {!["alipay", "wechat", "jd", "mt", "feidee"].includes(format) && <Choice
                        label="账单币种（仅文件缺少币种时选择）"
                        value={currency}
                        options={["CAD", "USD", "CNY", "HKD", "JPY", "EUR", "GBP", "AUD", "SGD", "CHF"].map((code) => ({ value: code, label: code }))}
                        onChange={setCurrency}
                        disabled={busy}
                      />}
                      {getStatementParser(format).formats.includes("pdf") && <Input
                        type="password" aria-label="PDF 密码（仅当前会话）" placeholder="PDF 密码（可选，仅当前会话使用）"
                        autoComplete="off" value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)}
                      />}
                      {(getStatementParser(format).variants?.length ?? 0) > 1 && (
                        <Choice
                          label="导出变体（留空自动识别）"
                          value={variantId}
                          options={getStatementParser(format).variants!.map((variant) => ({
                            value: variant.id,
                            label: variant.label,
                          }))}
                          onChange={setVariantId}
                          disabled={busy}
                        />
                      )}
                      <FileDropzone
                        file={null}
                        onFileChange={(nextFile) => {
                          if (nextFile) void upload(nextFile);
                        }}
                        isLoading={busy || !loaded}
                        accept={[
                          ...new Set(statementParsers.flatMap((candidate) => candidate.formats)),
                        ]
                          .map((format) => `.${format}`)
                          .join(",")}
                        error={error}
                        labels={{
                          choose: "选择账单文件",
                          remove: "移除文件",
                          processing: "正在读取账单…",
                          drop: "或拖拽文件",
                          hint: statementParsers.map((candidate) => candidate.fileHint).join(" · "),
                        }}
                      />
                      {file && error && <Button variant="outline" disabled={busy} onClick={() => void upload(file)}>重新读取当前文件</Button>}
                      {documents.map((doc) => (
                        <div key={doc.fileId} className="space-y-3 rounded-lg border p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Button variant="outline" onClick={() => setStatement(doc)}>
                              {doc.fileName} · {getStatementParser(doc.parserId).displayName}
                            </Button>
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() => {
                                setRemoveId(doc.fileId!);
                                setConfirmOpen(true);
                              }}
                            >
                              移除文件
                            </Button>
                          </div>
                          {doc.sheets?.filter((sheet) => sheet !== "PDF").map((sheet) => (
                            <label key={sheet} className="me-4 inline-flex items-center gap-2">
                              <Checkbox
                                aria-label={`工作表：${doc.fileName}：${sheet}`}
                                checked={
                                  !selectedSheets[doc.fileId!] ||
                                  selectedSheets[doc.fileId!].includes(sheet)
                                }
                                onCheckedChange={(checked) => {
                                  setSelectedSheets((current) => {
                                    const previous = current[doc.fileId!] ?? doc.sheets!;
                                    return {
                                      ...current,
                                      [doc.fileId!]: checked
                                        ? [...previous, sheet]
                                        : previous.filter((name) => name !== sheet),
                                    };
                                  });
                                }}
                              />
                              {sheet}
                            </label>
                          ))}
                          {doc.warnings?.map((warning) => (
                            <AlertFeedback key={warning} variant="warning" title="源文件核对">
                              {warning}
                            </AlertFeedback>
                          ))}
                          {doc.rows.some((row) => row.identityReason?.includes("来源账户")) && (
                            <div className="space-y-2">
                              <p>
                                填写上方稳定来源账户标识后重新解析此文件；目标账户选择不影响来源身份。
                              </p>
                              <Button
                                disabled={busy || !sourceAccount.trim()}
                                onClick={async () => {
                                  setBusy(true);
                                  try {
                                    const updated = await parseStatement(
                                      fileBytes.current.get(doc.fileId!)!,
                                      doc.fileName!,
                                      { channel: doc.parserId, fileId: doc.fileId, sourceAccount, assets: ctx.assets, ...fileOptions.current.get(doc.fileId!) },
                                    );
                                    setDocuments((current) =>
                                      current.map((item) =>
                                        item.fileId === doc.fileId ? updated : item,
                                      ),
                                    );
                                    setStatement(updated);
                                  } catch (error) {
                                    setError(
                                      error instanceof Error ? error.message : "重新解析失败",
                                    );
                                  } finally {
                                    setBusy(false);
                                  }
                                }}
                              >
                                补全来源账户并重新解析
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                      {statement && <StatementFilePreview key={statement.fileId} document={statement}
                        pdf={statement.sheets?.includes("PDF") ? { bytes: fileBytes.current.get(statement.fileId!)!, options: { assets: ctx.assets, ...fileOptions.current.get(statement.fileId!) } } : undefined}
                      />}
                    </>
                  )}
                  <p className="text-muted-foreground text-sm">
                    {"原文件只在本地读取，预览确认后才会保存账目。"}
                  </p>
                </div>
              )}
              {step === "mapping" && (
                <div className="space-y-4">
                  {renderIdentityConflicts()}
                  <RulesEditor
                    rules={rules}
                    rows={rows}
                    accounts={accountOptions}
                    disabled={busy}
                    onSave={async (next) => {
                      await ctx.api.storage.set(RULES_KEY, JSON.stringify(next));
                      setRules(next);
                      setDecisions((current) =>
                        Object.fromEntries(
                          Object.entries(current).map(([key, decision]) => [
                            key,
                            { ...decision, confirmed: false },
                          ]),
                        ),
                      );
                    }}
                  />
                  {parser && (
                    <AlertFeedback
                      variant="warning"
                      title={`${parser.displayName} · ${"映射实际资金账户"}`}
                    >
                      {parser.mappingHint(n(rows.length))}
                    </AlertFeedback>
                  )}
                  {hasInvestments && <AlertFeedback variant="warning" title="基金持有账户">基金交易请选择人民币、按交易流水跟踪的证券账户。</AlertFeedback>}
                  {incompleteInvestmentMappings.length > 0 && <AlertFeedback variant="warning" title="请补齐投资流水配置">仍有 {n(incompleteInvestmentMappings.length)} 笔流水待配置：{[...investmentIssueCounts].map(([issue, count]) => `${issue} ${n(count)} 笔`).join("；")}。</AlertFeedback>}
                  {!accounts.length && (
                    <AlertFeedback variant="warning" title={"待确认"}>
                      {"没有可选择的账户，请先在主程序创建账户。"}
                    </AlertFeedback>
                  )}
                  <ImportStatusCards
                    items={[
                      {
                        label: "账户映射",
                        value: `${n(activeMethods.length - unresolvedMethods.length)} / ${n(activeMethods.length)}`,
                        tone: unresolvedMethods.length ? "error" : "success",
                        icon: <Icons.CheckCircle className="size-4" />,
                      },
                      {
                        label: "记账性质映射",
                        value: `${n(preview.filter((entry) => entry.status !== "excluded" && entry.status !== "duplicate").length - unresolvedKinds.length)} / ${n(preview.filter((entry) => entry.status !== "excluded" && entry.status !== "duplicate").length)}`,
                        tone: unresolvedKinds.length ? "warning" : "success",
                        icon: <Icons.CheckCircle className="size-4" />,
                      },
                      {
                        label: "仍需人工核对",
                        value: n(reviewCount),
                        tone: reviewGroups.size ? "warning" : "success",
                        icon: <Icons.AlertCircle className="size-4" />,
                      },
                    ]}
                  />
                  {reviewGroups.size > 0 && (
                    <AlertFeedback variant="warning" title="映射完成后仍需核对交易">
                      以下异常交易状态需要核实是否已完成。补齐映射后，可在下一步审核表格中双击单元格修改，再选择记录并点击顶部“标记已核对”。
                    </AlertFeedback>
                  )}
                  {unresolvedMethods.length > 0 && (
                    <AlertFeedback variant="warning" title="请补齐账户映射">
                      仍有 {n(unresolvedMethods.length)} 项未映射，请选择账户或跳过对应记录。
                    </AlertFeedback>
                  )}
                  {(selectedMethods.length > 0 || selectedMappingRows.length > 0) && (
                    <div
                      role="toolbar"
                      aria-label="映射批量操作"
                      className="bg-muted flex gap-2 rounded-lg border p-3"
                    >
                      <Button variant="outline" onClick={() => skipMethods(true)}>
                        跳过
                      </Button>
                      <Button variant="outline" onClick={() => skipMethods(false)}>
                        取消跳过
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setSelectedMethods([]);
                          setSelectedMappingRows([]);
                        }}
                      >
                        清除选择
                      </Button>
                    </div>
                  )}
                  {unresolvedKinds.length > 0 && (
                    <ImportMappingGroup
                      pending
                      title={`需要补齐 · ${n(kindGroups.size)} 类记账性质 / ${n(unresolvedKinds.length)} 笔流水`}
                    >
                      {[...kindGroups].map(([key, entries]) => {
                        const source = entries[0].row.source;
                        const label = `${getStatementParser(source.system).displayName} · ${source.direction || "未提供收支"}`;
                        const lines = entries.map((entry) => rowKey(entry.row));
                        return (
                          <div key={key} className="grid items-start gap-3 sm:grid-cols-2">
                            <span>
                              <Checkbox
                                aria-label={`选择性质分组 ${label}`}
                                checked={lines.every((line) => selectedMappingRows.includes(line))}
                                onCheckedChange={(checked) =>
                                  setSelectedMappingRows((current) =>
                                    checked
                                      ? [...new Set([...current, ...lines])]
                                      : current.filter((line) => !lines.includes(line)),
                                  )
                                }
                              />{" "}
                              {label} · {n(entries.length)} 笔
                            </span>
                            <Choice
                              label={`性质映射：${label}`}
                              value=""
                              disabled={busy}
                              options={Object.entries(kinds).filter(([value]) => value !== "investment").map(([value, label]) => ({
                                value,
                                label,
                              }))}
                              onChange={(kind) => changeGroupKind(entries, kind)}
                            />
                            {renderDetails(entries, `性质：${label}`)}
                          </div>
                        );
                      })}
                    </ImportMappingGroup>
                  )}
                  {reviewGroups.size > 0 && (
                    <ImportMappingGroup
                      pending
                      title={`异常状态待核对 · ${n(reviewGroups.size)} 类 / ${n(reviewCount)} 笔流水`}
                    >
                      {[...reviewGroups].map(([key, entries]) => {
                        const source = entries[0].row.source;
                        const label = `${getStatementParser(source.system).displayName} · ${source.status || "未提供交易状态"}`;
                        return (
                          <div key={key} className="space-y-2">
                            <p>
                              {label} · {n(entries.length)} 笔 · {entries[0].row.reviewReason}
                            </p>
                            {renderDetails(entries, `异常状态：${label}`)}
                          </div>
                        );
                      })}
                    </ImportMappingGroup>
                  )}
                  {(unresolvedMethods.length ? [true, false] : [false]).map((pending) => (
                    <ImportMappingGroup
                      key={String(pending)}
                      pending={pending}
                      title={
                        pending ? `需要补齐 · ${n(unresolvedMethods.length)}` : "已映射 / 已跳过"
                      }
                    >
                      {paymentMethods
                        .filter((method) => unresolvedMethods.includes(method) === pending)
                        .map((method) => {
                          const resolution = accountResolutions.get(method)!;
                          const candidateIds = resolution.candidates.map(
                            (candidate) => candidate.accountId,
                          );
                          const options = [
                            ...candidateIds,
                            ...accountOptions
                              .map((option) => option.value)
                              .filter((id) => !candidateIds.includes(id)),
                          ].map((id) => accountOptions.find((option) => option.value === id)!);
                          const origin = !resolution.accountId
                            ? activeMethods.includes(method)
                              ? "待选择"
                              : "已跳过 / 重复"
                            : Object.hasOwn(mappingChoices, method)
                              ? "人工选择"
                              : resolution.origin === "saved"
                                ? "已保存"
                                : resolution.origin === "rule"
                                  ? "规则匹配"
                                  : "自动识别";
                          return (
                            <div key={method} className="grid items-start gap-3 sm:grid-cols-2">
                              <span>
                                <Checkbox
                                  aria-label={`选择付款方式 ${methodLabel(method)}`}
                                  checked={selectedMethods.includes(method)}
                                  onCheckedChange={(checked) =>
                                    setSelectedMethods((current) =>
                                      checked
                                        ? [...current, method]
                                        : current.filter((value) => value !== method),
                                    )
                                  }
                                />{" "}
                                {methodLabel(method)}{" "}
                                <span className="text-muted-foreground">
                                  {n(
                                    rows.filter((row) => mappingKey(row.source) === method).length,
                                  )}{" "}
                                  笔
                                </span>{" "}
                                <Badge variant="outline">{origin}</Badge>
                              </span>
                              <div className="space-y-2">
                                <Choice
                                  label={`账户映射：${methodLabel(method)}`}
                                  value={resolution.accountId}
                                  options={options}
                                  disabled={busy}
                                  onChange={(id) => changeMapping(method, id)}
                                />
                                {resolution.candidates.length > 0 && (
                                  <ul
                                    aria-label={"推荐账户"}
                                    className="text-muted-foreground space-y-1 text-xs"
                                  >
                                    {resolution.candidates.map((candidate) => (
                                      <li key={candidate.accountId}>
                                        {
                                          accountOptions.find(
                                            (option) => option.value === candidate.accountId,
                                          )!.label
                                        }
                                        {" · "}
                                        {candidate.confidence === "high"
                                          ? "高置信"
                                          : candidate.confidence === "medium"
                                            ? "中置信"
                                            : "低置信"}
                                        {" · "}
                                        {candidate.reasons.map((reason) => reason).join(" · ")}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              {renderDetails(
                                preview.filter((entry) => mappingKey(entry.row.source) === method),
                                methodLabel(method) || "未提供付款方式",
                                pending,
                              )}
                            </div>
                          );
                        })}
                    </ImportMappingGroup>
                  ))}
                  {recognizeInvestments && <StatementInvestmentFunding ctx={ctx} preview={preview} decisions={decisions}
                    accounts={accounts} activities={activities} busy={busy} onChange={changeDecision} mode="mapping" />}
                  <Accordion className="rounded-lg border">
                    <AccordionItem value="fields" className="border-0">
                      <AccordionTrigger className="px-3 py-3 hover:no-underline">固定字段映射</AccordionTrigger>
                      <AccordionContent className="px-3 pb-3"><p className="text-sm">{parser?.fieldMappingHint}</p></AccordionContent>
                    </AccordionItem>
                  </Accordion>
                  <Button variant="outline" disabled={busy} onClick={() => void resetMappings()}>
                    {"重置映射"}
                  </Button>
                </div>
              )}
              {step === "assets" && <StatementInvestmentReview ctx={ctx} preview={preview} decisions={decisions}
                accounts={accounts} activities={activities} busy={busy} onChange={changeDecision} onWorkingChange={setBusy} />}
              {(step === "preview" || step === "confirm") && (
                <div className="space-y-4">
                  {renderIdentityConflicts()}
                  {recognizeInvestments && <StatementInvestmentFunding ctx={ctx} preview={preview} decisions={decisions}
                    accounts={accounts} activities={activities} busy={busy} onChange={changeDecision} mode="review" />}
                  {preview
                    .filter(
                      (entry) =>
                        entry.row.source.fee &&
                        entry.row.source.fee !== "0.00" &&
                        entry.status !== "duplicate",
                    )
                    .map((entry) => (
                      <StatementFeeConfirmation
                        key={rowKey(entry.row)}
                        entry={entry}
                        decision={decisions[rowKey(entry.row)] ?? {}}
                        accounts={accountOptions}
                        busy={busy}
                        onChange={changeDecision}
                      />
                    ))}
                  <ImportStatusCards items={statistics} />
                  <AlertFeedback
                    variant={blockedCount ? "warning" : "success"}
                    title={
                      blockedCount
                        ? `还有 ${n(blockedCount)} 笔记录需要处理`
                        : `所有 ${n(counts.ready)} 笔记录已就绪`
                    }
                  >
                    {blockedCount
                      ? "黄色单元格需要核实，红色单元格需要修正。双击“记账性质”“确认金额”或“目标账户”即可编辑，也可选中单元格后按 F2 或 Enter。核实后勾选行首复选框，在顶部点击“标记已核对”。现金转账须确认方向和账户；基金明细在资产识别步骤修正。格式错误不能通过核对放行。"
                      : "您的数据已准备好导入，仍可审核并调整。已跳过及重复记录不会提交。"}
                  </AlertFeedback>
                  {step === "preview" && (
                    <ImportReviewTable
                      key={file?.name}
                      pageSize={50}
                      data={gridRows}
                      columns={columns}
                      getRowId={(entry) =>
                        `${entry.row.source.fileName} · ${entry.row.source.sheetName ?? "CSV"} · 第 ${n(entry.line)} 行 · 文件 ${n(Number(JSON.parse(entry.id)[0]))}`
                      }
                      busy={busy}
                      getCellState={(rowIndex, columnId) => {
                        const entry = gridRows[rowIndex];
                        if (!entry || !["kind", "amount", "accountId"].includes(columnId))
                          return null;
                        if (entry.status === "error")
                          return { type: "error", messages: [entry.reason] };
                        if (entry.status === "review")
                          return {
                            type: "warning",
                            messages: [
                              entry.reason,
                              "双击编辑，或选中后按 F2 / Enter；核实后选择行并标记已核对",
                            ],
                          };
                        return null;
                      }}
                      canSelect={(entry) => !entry.row.excluded && entry.status !== "duplicate"}
                      onSkip={(entries) =>
                        entries.forEach((entry) => changeDecision(entry.id, { excluded: true }))
                      }
                      onRestore={(entries) =>
                        entries.forEach((entry) => changeDecision(entry.id, { excluded: false }))
                      }
                      canReview={(entry) =>
                        entry.status === "review" &&
                        Boolean(
                          entry.row.reviewReason ||
                          entry.kind === "transferIn" ||
                          entry.kind === "transferOut",
                        ) &&
                        buildPreview(
                          // A unique source has no batch interactions. Avoid rebuilding
                          // the whole statement once per selected row in large imports.
                          (reviewSources.counts.get(sourceKey(entry.row.source)) ?? 0) === 1
                            ? [reviewSources.byId.get(entry.id)!] : rows,
                          accounts,
                          activities,
                          effectiveMappings,
                          {
                            ...decisions,
                            [entry.id]: { ...decisions[entry.id], confirmed: true },
                          },
                          rules,
                          importOptions,
                        ).find((candidate) => rowKey(candidate.row) === entry.id)?.status ===
                          "ready"
                      }
                      onReview={(entries) =>
                        entries.forEach((entry) => changeDecision(entry.id, { confirmed: true }))
                      }
                      filters={
                        <>
                          <ImportChoice
                            label="筛选类型"
                            value={typeFilter}
                            options={Object.entries(kinds).map(([value, label]) => ({
                              value,
                              label,
                            }))}
                            onChange={setTypeFilter}
                          />
                          <ImportChoice
                            label="筛选账户"
                            value={accountFilter}
                            options={accountOptions}
                            onChange={setAccountFilter}
                          />
                          <ImportChoice
                            label="筛选状态"
                            value={statusFilter}
                            options={Object.entries(labels).map(([value, label]) => ({
                              value,
                              label,
                            }))}
                            onChange={setStatusFilter}
                          />
                        </>
                      }
                      onDataChange={(next) => {
                        for (const entry of next) {
                          const before = preview.find(
                            (candidate) => rowKey(candidate.row) === entry.id,
                          );
                          if (
                            before &&
                            !locked(before) &&
                            (entry.amount !== before.amount ||
                              entry.kind !== before.kind ||
                              entry.accountId !== before.accountId)
                          )
                            changeDecision(entry.id, {
                              amount: entry.amount,
                              kind: entry.kind,
                              accountId: entry.accountId,
                            });
                        }
                      }}
                    />
                  )}
                  {blockedCount > 0 && (
                    <AlertFeedback variant="warning" title="需要处理">
                      还有 {n(blockedCount)} 笔错误或待核对记录，请修改、核对或跳过。
                    </AlertFeedback>
                  )}
                  {step === "confirm" && activityCounts.size > 0 && (
                    <div className="space-y-3" aria-label="按活动类型统计">
                      <h4 className="text-muted-foreground text-xs font-medium tracking-wider">按活动类型</h4>
                      <div className="flex flex-wrap gap-2">
                        {[...activityCounts].sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                          const config = activityTypeDisplay[type as keyof typeof activityTypeDisplay];
                          const Icon = config.icon;
                          return <div key={type} className="bg-muted/50 flex items-center gap-2 rounded-full px-3 py-1.5">
                            <Icon className={`size-4 ${config.color}`} />
                            <span className="text-sm">{config.label}</span>
                            <span className="bg-background text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">{n(count)}</span>
                          </div>;
                        })}
                      </div>
                    </div>
                  )}
                  {step === "confirm" && <StatementFinalPreview preview={preview} accounts={accounts} activities={activities} />}
                </div>
              )}
              {step === "result" && submission && (
                <ImportResultSummary
                  title={
                    submission.outcome === "success"
                      ? preview.some((entry) => entry.kind === "transferIn" || entry.kind === "transferOut") ? "活动已保存，转账请核对配对状态" : "导入完成"
                      : submission.outcome === "partial"
                        ? "部分完成"
                        : "结果待核对"
                  }
                  outcome={
                    submission.outcome === "success"
                      ? "success"
                      : submission.outcome === "partial"
                        ? "partial"
                        : "uncertain"
                  }
                  description={submission.message}
                  statistics={[
                    { label: "本次确认新增活动", value: n(submission.created) },
                    { label: "本次来源行数", value: n(rows.length) },
                    {
                      label: submission.outcome === "uncertain" ? "待确认活动" : "仍待处理来源行",
                      value: n(
                        submission.unconfirmed ??
                          preview.filter((entry) =>
                            ["ready", "review", "error"].includes(entry.status),
                          ).length,
                      ),
                    },
                  ]}
                >
                  <Button disabled={busy} onClick={() => void viewSpending(false, hasInvestments)}>
                    {hasInvestments ? "查看投资" : "查看收支"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setStep("preview");
                      setMessage("");
                    }}
                  >
                    {"返回预览"}
                  </Button>
                  <Button onClick={cancel}>{"开始新导入"}</Button>
                </ImportResultSummary>
              )}
              <div className="mt-6 space-y-3">
              <StatementReconciliation documents={documents} preview={preview} />
              <StatementAssociations preview={preview} activities={activities} disabled={busy || !loaded}
                onCancelPreview={(entry, peerKey) => setDecisions((current) => ({ ...current,
                  [rowKey(entry.row)]: { ...current[rowKey(entry.row)], cancelledAssociations: [...new Set([...(current[rowKey(entry.row)]?.cancelledAssociations ?? []), peerKey])] },
                }))}
                onCancelSaved={(id) => void cancelAssociation(id)}
              />
              <TransferPanel
                ctx={ctx}
                activities={activities}
                accounts={accountOptions}
                disabled={busy}
                onRefresh={refresh}
              />
              </div>
            </ImportWizardLayout>
          </div>
        </PageContent>
        <CancelConfirmationDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            setConfirmOpen(open);
            if (!open) setRemoveId(null);
          }}
          onConfirm={() => {
            if (removeId) {
              setDocuments((current) => current.filter((doc) => doc.fileId !== removeId));
              if (statement?.fileId === removeId) setStatement(null);
              fileBytes.current.delete(removeId);
              fileOptions.current.delete(removeId);
              setPassword("");
              setRemoveId(null);
              setConfirmOpen(false);
            } else cancel();
          }}
          title={removeId ? "移除此文件？" : "放弃本次导入？"}
          description={"将清除已上传账单和未提交的修改。"}
          continueLabel={"继续编辑"}
          cancelLabel={"取消本次导入"}
        />
      </Page>
    </div>
  );
}
