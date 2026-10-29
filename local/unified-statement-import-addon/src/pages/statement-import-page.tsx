import {
  ImportWizardLayout,
  FileDropzone,
  WizardStepIndicator,
  StepNavigation,
  CancelConfirmationDialog,
  ImportResultSummary,
  ImportStatusCards,
  ImportChoice,
  ImportFilePreview,
  ImportMappingGroup,
  ImportReviewTable,
  ImportTypeBadge,
} from "@wealthfolio/import-wizard-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Account, AddonContext } from "@wealthfolio/addon-sdk";
import {
  AlertFeedback,
  Button,
  Badge,
  Checkbox,
  Icons,
  Page,
  PageContent,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useAmountFormatting,
  useNumberFormatting,
  useDateFormatting,
} from "@wealthfolio/ui";
import { getStatementParser, parseStatement, statementParsers } from "../parsers";
import type { EntryKind, StatementDocument } from "../parsers/types";
import { resolveAccount } from "../import/account-matching";
import {
  buildPreview,
  MAPPING_KEY,
  restoreMappings,
  type Decisions,
  type ExistingActivity,
  type Mappings,
  type PreviewRow,
  type PreviewStatus,
  type RowDecision,
} from "../import/ledger";
import { createSubmitter } from "../import/session";
import { decodeStatement } from "../parsers/csv";
type ImportStep = "upload" | "mapping" | "preview" | "confirm" | "result";

const labels: Record<PreviewStatus, string> = {
  ready: "待导入",
  duplicate: "重复",
  excluded: "排除",
  review: "待确认",
  error: "错误",
};
const statusAppearance = {
  ready: { tone: "success", variant: "success-subtle", icon: Icons.CheckCircle },
  duplicate: { tone: "info", variant: "info-subtle", icon: Icons.Copy },
  excluded: { tone: "muted", variant: "outline", icon: Icons.MinusCircle },
  review: { tone: "warning", variant: "warning-subtle", icon: Icons.AlertCircle },
  error: { tone: "error", variant: "destructive-subtle", icon: Icons.XCircle },
} as const;
const kinds: Record<EntryKind, string> = { expense: "支出", income: "收入", refund: "支出退款" };
const accountTypes: Record<Account["accountType"], string> = {
  CASH: "现金",
  CREDIT_CARD: "信用卡",
  SECURITIES: "证券",
  CRYPTOCURRENCY: "加密货币",
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
  const { formatAmount } = useAmountFormatting();
  const { formatDecimal } = useNumberFormatting();
  const { formatDateTime } = useDateFormatting();
  const n = (value: number) => formatDecimal(value, { maximumFractionDigits: 0 });
  const [format, setFormat] = useState("");
  const [rawText, setRawText] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [selectedMappingRows, setSelectedMappingRows] = useState<number[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submission, setSubmission] = useState<Awaited<
    ReturnType<ReturnType<typeof createSubmitter>>
  > | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activities, setActivities] = useState<ExistingActivity[]>([]);
  const [statement, setStatement] = useState<StatementDocument | null>(null);
  const rows = useMemo(() => statement?.rows ?? [], [statement]);
  const parser = statement ? getStatementParser(statement.parserId) : undefined;
  const [mappings, setMappings] = useState<Mappings>({});
  const [mappingChoices, setMappingChoices] = useState<Mappings>({});
  const effectiveMappings = useMemo(
    () => ({ ...mappings, ...mappingChoices }),
    [mappings, mappingChoices],
  );
  const [decisions, setDecisions] = useState<Decisions>({});
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
    ])
      .then(([allAccounts, allActivities, saved]) => {
        if (!active) return;
        setAccounts(allAccounts);
        setActivities(allActivities);
        try {
          setMappings(restoreMappings(saved, allAccounts));
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
    };
  }, [ctx]);

  const accountOptions = accounts.map((account) => ({
    value: account.id,
    label: `${account.name} · ${accountTypes[account.accountType]} · ${account.currency}`,
  }));
  const evaluated = useMemo(() => {
    try {
      return {
        preview: buildPreview(rows, accounts, activities, effectiveMappings, decisions),
        error: "",
      };
    } catch (cause) {
      return {
        preview: [] as PreviewRow[],
        error: cause instanceof Error ? cause.message : "来源信息无法读取。",
      };
    }
  }, [rows, accounts, activities, effectiveMappings, decisions]);
  const preview = evaluated.preview;
  const counts = Object.fromEntries(
    Object.keys(labels).map((status) => [
      status,
      preview.filter((entry) => entry.status === status).length,
    ]),
  );
  const paymentMethods = [
    ...new Set(rows.filter((row) => !row.excluded).map((row) => row.source.paymentMethod)),
  ];
  const accountResolutions = new Map(
    paymentMethods.map((method) => [method, resolveAccount(method, accounts, effectiveMappings)]),
  );
  const activeMethods = paymentMethods.filter((method) =>
    preview.some(
      (entry) =>
        entry.row.source.paymentMethod === method &&
        entry.status !== "excluded" &&
        entry.status !== "duplicate",
    ),
  );
  const unresolvedMethods = activeMethods.filter(
    (method) => !accountResolutions.get(method)?.accountId,
  );
  const blockedCount = (counts.review ?? 0) + (counts.error ?? 0);
  const unresolvedKinds = preview.filter(
    (entry) => entry.status !== "excluded" && entry.status !== "duplicate" && !entry.kind,
  );

  function changeMapping(method: string, accountId: string) {
    setMappingChoices((current) => ({ ...current, [method]: accountId }));
    setDecisions((current) =>
      Object.fromEntries(
        Object.entries(current).map(([line, decision]) => [
          line,
          rows.some(
            (row) => row.source.lineNumber === Number(line) && row.source.paymentMethod === method,
          )
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
          (selectedMethods.includes(row.source.paymentMethod) ||
            selectedMappingRows.includes(row.source.lineNumber)) &&
          !row.excluded
        )
          next[row.source.lineNumber] = {
            ...next[row.source.lineNumber],
            excluded,
            confirmed: false,
          };
      return next;
    });
    setSelectedMethods([]);
    setSelectedMappingRows([]);
  }

  function changeDecision(line: number, patch: RowDecision) {
    if (step === "result") setStep("preview");
    setDecisions((current) => ({
      ...current,
      [line]: { ...current[line], confirmed: false, ...patch },
    }));
    setMessage("");
  }

  async function upload(file: File) {
    setFile(file);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = parseStatement(bytes, file.name);
      if (parsed.parserId !== format || !file.name.toLowerCase().endsWith(".csv"))
        throw new Error("文件与所选流水格式不符，请选择支付宝流水 CSV。");
      setRawText(decodeStatement(bytes));
      setStatement(parsed);
      setMappingChoices({});
      setDecisions({});
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
    if (unresolvedMethods.length || unresolvedKinds.length) return;
    setBusy(true);
    setError("");
    try {
      const nextMappings = { ...effectiveMappings };
      for (const [method, resolution] of accountResolutions) {
        if (resolution.accountId) nextMappings[method] = resolution.accountId;
        else delete nextMappings[method];
      }
      await ctx.api.storage.set(MAPPING_KEY, JSON.stringify(nextMappings));
      setMappings(nextMappings);
      setMappingChoices(
        Object.fromEntries(
          [...accountResolutions]
            .filter(([, resolution]) => !resolution.accountId)
            .map(([method]) => [method, ""]),
        ),
      );
      setStep("preview");
      setMessage("");
    } catch {
      setError("账户映射保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (submitting.current || blockedCount || !counts.ready) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await submitter(rows, effectiveMappings, decisions, preview);
      setSubmission(result);
      setMessage(result.message);
      const [currentAccounts, currentActivities] = await Promise.all([
        ctx.api.accounts.getAll(),
        ctx.api.activities.getAll(),
      ]);
      setAccounts(currentAccounts);
      setActivities(currentActivities);
      setStep(result.outcome === "changed" || result.outcome === "empty" ? "preview" : "result");
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

  async function resetMappings() {
    setBusy(true);
    try {
      await ctx.api.storage.delete(MAPPING_KEY);
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
    setSelectedMappingRows([]);
    setRawText("");
    setSelectedMethods([]);
    setTypeFilter("");
    setAccountFilter("");
    setStatusFilter("");
    setFile(null);
    setSubmission(null);
    setStatement(null);
    setMappingChoices({});
    setDecisions({});
    setStep("upload");
    setError("");
    setMessage("");
  }

  useEffect(() => {
    void ctx.router.setLeaveGuard(rows.length > 0 && step !== "result");
  }, [ctx, rows.length, step]);

  const locked = useCallback(
    (entry: PreviewRow) =>
      busy || entry.status === "excluded" || entry.status === "duplicate" || !!entry.row.error,
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
        .map((entry) => ({ ...entry, line: entry.row.source.lineNumber })),
    [preview, typeFilter, accountFilter, statusFilter],
  );
  const columns = useMemo(
    () => [
      { id: "line", accessorKey: "line", header: "#", size: 70, meta: { readOnly: true } },
      {
        id: "kind",
        accessorKey: "kind",
        header: "记账性质",
        size: 150,
        meta: {
          readOnly: locked,
          cell: {
            variant: "select" as const,
            options: Object.entries(kinds).map(([value, label]) => ({ value, label })),
            valueRenderer: (value: string) => (
              <ImportTypeBadge
                type={
                  value === "expense" ? "WITHDRAWAL" : value === "income" ? "DEPOSIT" : "CREDIT"
                }
              >
                {kinds[value as EntryKind]}
              </ImportTypeBadge>
            ),
          },
        },
      },
      {
        id: "amount",
        accessorKey: "amount",
        header: "确认金额",
        size: 150,
        meta: {
          readOnly: locked,
          cell: {
            variant: "number" as const,
            valueType: "string" as const,
            min: 0,
            valueRenderer: (value: string | number | null) =>
              formatAmount(value ?? "", "CNY", false),
          },
        },
      },
      {
        id: "accountId",
        accessorKey: "accountId",
        header: "目标账户",
        size: 240,
        meta: { readOnly: locked, cell: { variant: "select" as const, options: accountOptions } },
      },
      {
        id: "processing",
        header: (): string => "处理状态",
        size: 320,
        meta: { readOnly: true, label: "处理状态" },
        cell: ({ row }: { row: { original: PreviewRow } }) => {
          const entry = row.original;
          const appearance = statusAppearance[entry.status];
          const Icon = appearance.icon;
          return (
            <div className="flex h-full min-w-0 items-center gap-2" title={entry.reason}>
              <Badge
                className="shrink-0"
                variant={appearance.variant}
                data-processing-status={entry.status}
              >
                <Icon className="me-1 size-3" />
                {labels[entry.status]}
              </Badge>
              <span className="truncate">{entry.reason}</span>
            </div>
          );
        },
      },
      ...(
        [
          "date",
          "merchant",
          "description",
          "category",
          "direction",
          "paymentMethod",
          "status",
          "recordId",
          "amount",
        ] as const
      ).map((key, index) => ({
        id: "source-" + key,
        header: (): string | undefined =>
          [
            "交易时间",
            "交易对方",
            "商品说明",
            "来源分类",
            "收/支",
            "付款方式",
            "交易状态",
            "订单号",
            "原金额",
          ][index],
        accessorFn: (entry: PreviewRow) => entry.row.source[key],
        cell: ({ row }: { row: { original: PreviewRow } }) => {
          const source = row.original.row.source;
          const value = source[key];
          return (
            <span
              className="block truncate leading-8"
              title={key === "date" ? source.originalTime : String(value)}
            >
              {key === "date" && value
                ? formatDateTime(value, { dateStyle: "short", timeStyle: "short" })
                : key === "amount"
                  ? formatAmount(value, source.currency, false)
                  : value}
            </span>
          );
        },
        size: key === "description" || key === "recordId" ? 220 : 160,
        meta: {
          readOnly: true,
          label: [
            "交易时间",
            "交易对方",
            "商品说明",
            "来源分类",
            "收/支",
            "付款方式",
            "交易状态",
            "订单号",
            "原金额",
          ][index],
        },
      })),
    ],
    [locked, accountOptions, formatAmount, formatDateTime],
  );
  const steps = [
    { id: "upload", label: "上传" },
    { id: "mapping", label: "映射" },
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
    else if (step === "preview") setStep("mapping");
    else setStep("upload");
  }
  function next() {
    if (step === "upload") setStep("mapping");
    else if (step === "mapping") void saveMappings();
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
                        (step === "mapping"
                          ? !unresolvedMethods.length && !unresolvedKinds.length
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
              {message && step !== "result" && (
                <AlertFeedback variant="warning" title={"核对提示"}>
                  {message}
                </AlertFeedback>
              )}
              {step === "upload" && (
                <div className="space-y-4">
                  <ImportChoice
                    label="流水格式"
                    value={format}
                    disabled={busy || !!file}
                    options={statementParsers.map((candidate) => ({
                      value: candidate.id,
                      label: `${candidate.displayName} CSV`,
                    }))}
                    onChange={setFormat}
                  />
                  {format && (
                    <>
                      <FileDropzone
                        file={file}
                        onFileChange={(nextFile) => {
                          if (file) setConfirmOpen(true);
                          else if (nextFile) void upload(nextFile);
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
                      {statement && (
                        <ImportFilePreview
                          headers={[
                            "交易时间",
                            "交易对方",
                            "商品说明",
                            "收/支",
                            "金额",
                            "付款方式",
                            "交易状态",
                            "订单号",
                          ]}
                          rows={rows.map(({ source }) => [
                            source.originalTime,
                            source.merchant,
                            source.description,
                            source.direction,
                            source.amount,
                            source.paymentMethod,
                            source.status,
                            source.recordId,
                          ])}
                          original={
                            <pre className="text-xs break-all whitespace-pre-wrap">{rawText}</pre>
                          }
                        />
                      )}
                    </>
                  )}
                  <p className="text-muted-foreground text-sm">
                    {"原文件只在本地读取，预览确认后才会保存账目。"}
                  </p>
                </div>
              )}
              {step === "mapping" && (
                <div className="space-y-4">
                  {parser && (
                    <AlertFeedback
                      variant="warning"
                      title={`${parser.displayName} · ${"映射实际资金账户"}`}
                    >
                      {parser.mappingHint(n(rows.length))}
                    </AlertFeedback>
                  )}
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
                        label: "业务映射",
                        value: `${n(preview.filter((entry) => entry.status !== "excluded" && entry.status !== "duplicate").length - unresolvedKinds.length)} / ${n(preview.filter((entry) => entry.status !== "excluded" && entry.status !== "duplicate").length)}`,
                        tone: unresolvedKinds.length ? "warning" : "success",
                        icon: <Icons.CheckCircle className="size-4" />,
                      },
                    ]}
                  />
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
                      title={`需要补齐 · ${n(unresolvedKinds.length)} 笔记账性质`}
                    >
                      {unresolvedKinds.map((entry) => (
                        <div
                          key={entry.row.source.lineNumber}
                          className="flex flex-wrap items-center gap-3"
                        >
                          <Checkbox
                            aria-label={`选择来源 ${entry.row.source.lineNumber}`}
                            checked={selectedMappingRows.includes(entry.row.source.lineNumber)}
                            onCheckedChange={(checked) =>
                              setSelectedMappingRows((current) =>
                                checked
                                  ? [...current, entry.row.source.lineNumber]
                                  : current.filter((line) => line !== entry.row.source.lineNumber),
                              )
                            }
                          />
                          <span>
                            #{n(entry.row.source.lineNumber)} · {entry.row.source.description} ·{" "}
                            {entry.row.source.direction}
                          </span>
                          <Choice
                            label={`第 ${n(entry.row.source.lineNumber)} 行性质`}
                            value={entry.kind ?? ""}
                            options={Object.entries(kinds).map(([value, label]) => ({
                              value,
                              label,
                            }))}
                            onChange={(kind) =>
                              changeDecision(entry.row.source.lineNumber, {
                                kind: kind ? (kind as EntryKind) : undefined,
                              })
                            }
                          />
                        </div>
                      ))}
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
                                : "自动识别";
                          return (
                            <div key={method} className="grid items-start gap-3 sm:grid-cols-2">
                              <span>
                                <Checkbox
                                  aria-label={`选择付款方式 ${method}`}
                                  checked={selectedMethods.includes(method)}
                                  onCheckedChange={(checked) =>
                                    setSelectedMethods((current) =>
                                      checked
                                        ? [...current, method]
                                        : current.filter((value) => value !== method),
                                    )
                                  }
                                />{" "}
                                {method || "未提供付款方式（请指定收款账户）"}{" "}
                                <span className="text-muted-foreground">
                                  {n(
                                    rows.filter((row) => row.source.paymentMethod === method)
                                      .length,
                                  )}{" "}
                                  笔
                                </span>{" "}
                                <Badge variant="outline">{origin}</Badge>
                              </span>
                              <div className="space-y-2">
                                <Choice
                                  label={`账户映射：${method}`}
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
                              <details open={pending} className="min-w-0 sm:col-span-2">
                                <summary className="cursor-pointer text-sm font-medium">
                                  关联流水明细
                                </summary>
                                <div className="mt-3 max-h-80 overflow-auto rounded-lg border">
                                  <Table
                                    aria-label={`流水明细：${method || "未提供付款方式"}`}
                                    containerClassName="overflow-visible"
                                    className="min-w-max"
                                  >
                                    <TableHeader className="bg-card sticky top-0 z-10">
                                      <TableRow>
                                        {["来源行", "交易时间", "记账性质", "交易对方", "商品说明", "金额", "处理状态"].map((heading) => (
                                          <TableHead
                                            key={heading}
                                            className={heading === "金额" ? "text-end" : "text-start"}
                                          >
                                            {heading}
                                          </TableHead>
                                        ))}
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {preview
                                        .filter((entry) => entry.row.source.paymentMethod === method)
                                        .map((entry) => {
                                        const source = entry.row.source;
                                        const appearance = statusAppearance[entry.status];
                                        const StatusIcon = appearance.icon;
                                        return (
                                          <TableRow key={source.lineNumber}>
                                            <TableCell>{n(source.lineNumber)}</TableCell>
                                            <TableCell className="whitespace-nowrap">
                                              {source.date
                                                ? formatDateTime(source.date, { dateStyle: "short", timeStyle: "short" })
                                                : source.originalTime}
                                            </TableCell>
                                            <TableCell>
                                              {entry.kind ? (
                                                <ImportTypeBadge
                                                  type={entry.kind === "expense" ? "WITHDRAWAL" : entry.kind === "income" ? "DEPOSIT" : "CREDIT"}
                                                >
                                                  {kinds[entry.kind]}
                                                </ImportTypeBadge>
                                              ) : source.direction}
                                            </TableCell>
                                            <TableCell className="max-w-64 whitespace-normal break-words">
                                              {source.merchant}
                                            </TableCell>
                                            <TableCell className="max-w-80 whitespace-normal break-words">
                                              {source.description}
                                            </TableCell>
                                            <TableCell className="text-end whitespace-nowrap tabular-nums">
                                              {entry.row.error ? entry.amount : formatAmount(entry.amount, source.currency, false)} {source.currency}
                                            </TableCell>
                                            <TableCell>
                                              <Badge variant={appearance.variant}>
                                                <StatusIcon className="me-1 size-3" />
                                                {labels[entry.status]}
                                              </Badge>
                                              <span className="text-muted-foreground ms-2 text-xs">
                                                {entry.reason}
                                              </span>
                                            </TableCell>
                                          </TableRow>
                                        );
                                      })}
                                    </TableBody>
                                  </Table>
                                </div>
                              </details>
                            </div>
                          );
                        })}
                    </ImportMappingGroup>
                  ))}
                  <details className="rounded-lg border p-3">
                    <summary>固定字段映射</summary>
                    <p className="mt-2 text-sm">
                      交易时间 → 日期；收/支 → 记账性质；金额 → 金额；收/付款方式 → 账户；交易订单号
                      → 来源标识。来源分类保留在备注中。
                    </p>
                  </details>
                  <Button variant="outline" disabled={busy} onClick={() => void resetMappings()}>
                    {"重置映射"}
                  </Button>
                </div>
              )}
              {(step === "preview" || step === "confirm") && (
                <div className="space-y-4">
                  <ImportStatusCards items={statistics} />
                  <AlertFeedback
                    variant={blockedCount ? "warning" : "success"}
                    title={blockedCount ? "需要核对" : `所有 ${n(counts.ready)} 笔记录已就绪`}
                  >
                    {blockedCount
                      ? "不计收支、组合支付及未知状态需核实性质、实际扣款金额和账户，再选择记录并标记已核对。转账、还款、理财请跳过。所有错误及待核对记录必须处理后才能继续。"
                      : "您的数据已准备好导入，仍可审核并调整。已跳过及重复记录不会提交。"}
                  </AlertFeedback>
                  {step === "preview" && (
                    <ImportReviewTable
                      key={file?.name}
                      data={gridRows}
                      columns={columns}
                      getRowId={(entry) => String(entry.line)}
                      busy={busy}
                      canSelect={(entry) => !entry.row.excluded && entry.status !== "duplicate"}
                      onSkip={(entries) =>
                        entries.forEach((entry) => changeDecision(entry.line, { excluded: true }))
                      }
                      onRestore={(entries) =>
                        entries.forEach((entry) => changeDecision(entry.line, { excluded: false }))
                      }
                      canReview={(entry) =>
                        entry.status === "review" &&
                        Boolean(entry.row.reviewReason) &&
                        buildPreview(rows, accounts, activities, effectiveMappings, {
                          ...decisions,
                          [entry.line]: { ...decisions[entry.line], confirmed: true },
                        }).find((candidate) => candidate.row.source.lineNumber === entry.line)
                          ?.status === "ready"
                      }
                      onReview={(entries) =>
                        entries.forEach((entry) => changeDecision(entry.line, { confirmed: true }))
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
                            (candidate) => candidate.row.source.lineNumber === entry.line,
                          );
                          if (
                            before &&
                            !locked(before) &&
                            (entry.amount !== before.amount ||
                              entry.kind !== before.kind ||
                              entry.accountId !== before.accountId)
                          )
                            changeDecision(entry.line, {
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
                  {step === "confirm" && (
                    <div className="flex flex-wrap gap-3">
                      {Object.entries(kinds).map(([kind, label]) => (
                        <span key={kind}>
                          {label}：
                          {n(
                            preview.filter(
                              (entry) => entry.status === "ready" && entry.kind === kind,
                            ).length,
                          )}{" "}
                          笔
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {step === "result" && submission && (
                <ImportResultSummary
                  title={
                    submission.outcome === "success"
                      ? "导入完成"
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
                    { label: "本次确认新增", value: n(submission.created) },
                    {
                      label: submission.outcome === "uncertain" ? "待确认" : "未提交",
                      value: n(submission.unconfirmed ?? rows.length - submission.created),
                    },
                  ]}
                >
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
              <p className="text-muted-foreground mt-3 text-xs">
                {"重复检测覆盖可读取的非归档账户。若相关账户已归档，请先在主程序取消归档再导入。"}
              </p>
            </ImportWizardLayout>
          </div>
        </PageContent>
        <CancelConfirmationDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          onConfirm={cancel}
          title={"放弃本次导入？"}
          description={"将清除已上传账单和未提交的修改。"}
          continueLabel={"继续编辑"}
          cancelLabel={"取消本次导入"}
        />
      </Page>
    </div>
  );
}
