import { useEffect, useMemo, useRef, useState } from "react";
import type { Account, AddonContext } from "@wealthfolio/addon-sdk";
import { useAddonTranslation } from "@wealthfolio/addon-sdk";
import { CsvParseError } from "../parsers/csv";
import {
  AlertFeedback,
  ImportWizardLayout,
  FileDropzone,
  WizardStepIndicator,
  StepNavigation,
  CancelConfirmationDialog,
  ImportResultSummary,
  DataGrid,
  useDataGrid,
  useDirection,
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
  useAmountFormatting,
  useNumberFormatting,
  useDateFormatting,
} from "@wealthfolio/ui";
import { getStatementParser, parseStatement, statementParsers } from "../parsers";
import type { EntryKind, StatementDocument } from "../parsers/types";
import { resolveAccount } from "../import/account-matching";
import {
  buildPreview,
  eligibleAccounts,
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
type ImportStep = "upload" | "mapping" | "preview" | "confirm" | "result";

const labels: Record<PreviewStatus, string> = {
  ready: "待导入",
  duplicate: "重复",
  excluded: "排除",
  review: "待确认",
  error: "错误",
};
const statusAppearance = {
  ready: { variant: "success-subtle", icon: Icons.CheckCircle },
  duplicate: { variant: "info-subtle", icon: Icons.Copy },
  excluded: { variant: "outline", icon: Icons.MinusCircle },
  review: { variant: "warning-subtle", icon: Icons.AlertCircle },
  error: { variant: "destructive-subtle", icon: Icons.XCircle },
} as const;
const kinds: Record<EntryKind, string> = { expense: "支出", income: "收入", refund: "支出退款" };

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
  const { t } = useAddonTranslation();
  return (
    <Select
      value={value || "__none__"}
      onValueChange={(next) => onChange(next === "__none__" ? "" : (next ?? ""))}
      disabled={disabled}
    >
      <SelectTrigger aria-label={t(label)} className="h-8 w-full min-w-32 rounded-md text-xs">
        <SelectValue>
          {options.find((option) => option.value === value)?.label ?? t("请选择")}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">{t("请选择")}</SelectItem>
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
  const { t } = useAddonTranslation();
  const { formatAmount } = useAmountFormatting();
  const { formatDecimal } = useNumberFormatting();
  const { formatDateTime } = useDateFormatting();
  const n = (value: number) => formatDecimal(value, { maximumFractionDigits: 0 });
  const dir = useDirection();
  const [file, setFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submission, setSubmission] = useState<Awaited<
    ReturnType<ReturnType<typeof createSubmitter>>
  > | null>(null);
  const [errorLine, setErrorLine] = useState<number>();
  const [messageValues, setMessageValues] = useState<Record<string, number>>({});
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

  const available = eligibleAccounts(accounts);
  const accountOptions = available.map((account) => ({
    value: account.id,
    label: `${account.name} · ${t(account.accountType === "CREDIT_CARD" ? "信用卡" : "现金")}`,
  }));
  const evaluated = useMemo(() => {
    try {
      return {
        preview: buildPreview(rows, accounts, activities, effectiveMappings, decisions), error: "",
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
    setErrorLine(undefined);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const parsed = parseStatement(new Uint8Array(await file.arrayBuffer()), file.name);
      setStatement(parsed);
      setMappingChoices({});
      setDecisions({});
      setStep("mapping");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "账单读取失败。");
      setErrorLine(cause instanceof CsvParseError ? cause.lineNumber : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function saveMappings() {
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
      setMappingChoices(Object.fromEntries(
        [...accountResolutions]
          .filter(([, resolution]) => !resolution.accountId)
          .map(([method]) => [method, ""]),
      ));
      setStep("preview");
      setMessage("");
    } catch {
      setError("账户映射保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await submitter(rows, effectiveMappings, decisions, preview);
      setSubmission(result);
      setMessage(result.message);
      setMessageValues(result.messageValues ?? {});
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

  const locked = (entry: PreviewRow) =>
    busy || entry.row.excluded || entry.status === "duplicate" || !!entry.row.error;
  const gridRows = useMemo(
    () => preview.map((entry) => ({ ...entry, line: entry.row.source.lineNumber })),
    [preview],
  );
  const columns = useMemo(
    () => [
      { id: "line", accessorKey: "line", header: "#", size: 70, meta: { readOnly: true } },
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
        header: () =>
          t(
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
          ),
        accessorFn: (entry: PreviewRow) => entry.row.source[key],
        cell: ({ row }: { row: { original: PreviewRow } }) => {
          const source = row.original.row.source;
          const value = source[key];
          return (
            <span title={String(value)}>
              {key === "date" && value
                ? formatDateTime(value, { dateStyle: "short", timeStyle: "short" })
                : key === "amount"
                  ? formatAmount(value, source.currency, false)
                  : value}
            </span>
          );
        },
        size: key === "description" || key === "recordId" ? 220 : 160,
      })),
      {
        id: "kind",
        header: () => t("记账性质"),
        size: 150,
        cell: ({ row }: { row: { original: PreviewRow } }) => (
          <Choice
            label={t("第 {{line}} 行性质", { line: n(row.original.row.source.lineNumber) })}
            value={row.original.kind ?? ""}
            options={Object.entries(kinds).map(([value, label]) => ({ value, label: t(label) }))}
            disabled={locked(row.original)}
            onChange={(kind) =>
              changeDecision(row.original.row.source.lineNumber, {
                kind: kind ? (kind as EntryKind) : undefined,
              })
            }
          />
        ),
      },
      {
        id: "amount",
        accessorKey: "amount",
        header: t("确认金额"),
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
        header: () => t("目标账户"),
        size: 240,
        cell: ({ row }: { row: { original: PreviewRow } }) => (
          <Choice
            label={t("第 {{line}} 行账户", { line: n(row.original.row.source.lineNumber) })}
            value={row.original.accountId}
            options={accountOptions}
            disabled={locked(row.original)}
            onChange={(accountId) =>
              changeDecision(row.original.row.source.lineNumber, { accountId })
            }
          />
        ),
      },
      {
        id: "processing",
        header: () => t("处理状态"),
        size: 320,
        cell: ({ row }: { row: { original: PreviewRow } }) => {
          const entry = row.original;
          const appearance = statusAppearance[entry.status];
          const Icon = appearance.icon;
          return (
            <div className="flex items-center gap-2" title={t(entry.reason)}>
              <Badge variant={appearance.variant} data-processing-status={entry.status}>
                <Icon className="me-1 size-3" />
                {t(labels[entry.status])}
              </Badge>
              <span className="truncate">{t(entry.reason)}</span>
            </div>
          );
        },
      },
      {
        id: "actions",
        header: () => t("操作"),
        size: 220,
        cell: ({ row }: { row: { original: PreviewRow } }) => {
          const entry = row.original;
          const source = entry.row.source;
          const decision = decisions[source.lineNumber] ?? {};
          return (
            <div className="flex gap-3">
              {!entry.row.excluded && entry.status !== "duplicate" && (
                <label className="flex items-center gap-1">
                  <Checkbox
                    aria-label={t("第 {{line}} 行排除", { line: n(source.lineNumber) })}
                    disabled={busy}
                    checked={!!decision.excluded}
                    onCheckedChange={(excluded) => changeDecision(source.lineNumber, { excluded })}
                  />
                  {t("排除")}
                </label>
              )}
              {entry.row.reviewReason &&
                !entry.row.excluded &&
                entry.status !== "duplicate" &&
                !decision.excluded && (
                  <label className="flex items-center gap-1">
                    <Checkbox
                      aria-label={t("第 {{line}} 行确认", { line: n(source.lineNumber) })}
                      disabled={busy || !entry.kind || !entry.accountId || !entry.amount}
                      checked={!!decision.confirmed}
                      onCheckedChange={(confirmed) =>
                        changeDecision(source.lineNumber, { confirmed })
                      }
                    />
                    {t("确认")}
                  </label>
                )}
            </div>
          );
        },
      },
    ],
    [t, busy, decisions, accountOptions, formatAmount, formatDateTime],
  );
  const grid = useDataGrid({
    data: gridRows,
    columns,
    getRowId: (entry) => String(entry.line),
    dir,
    readOnly: busy,
    enableRowSelection: false,
    enableSearch: false,
    enablePaste: false,
    onDataChange: (next) => {
      for (const entry of next) {
        const before = preview.find((candidate) => candidate.row.source.lineNumber === entry.line);
        if (before && !locked(before) && entry.amount !== before.amount)
          changeDecision(entry.line, { amount: entry.amount });
      }
    },
  });
  const steps = [
    { id: "upload", label: t(parser?.uploadLabelKey ?? "上传账单") },
    { id: "mapping", label: t("账户映射") },
    { id: "preview", label: t("逐笔预览") },
    { id: "confirm", label: t("提交确认") },
  ];
  const statistics = Object.entries(labels).map(([status, label]) => ({
    label: t(label),
    value: n(counts[status] ?? 0),
  }));
  function back() {
    if (step === "confirm") setStep("preview");
    else if (step === "preview") setStep("mapping");
    else setStep("upload");
  }
  function next() {
    if (step === "upload") setStep("mapping");
    else if (step === "mapping") void saveMappings();
    else if (step === "preview") setStep("confirm");
    else if (step === "confirm") void submit();
  }

  return (
    <div className="statement-import h-dvh min-h-0">
      <Page className="flex h-full min-h-0 flex-col">
        <PageHeader
          heading={t("账单导入")}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
                {t("刷新核对")}
              </Button>
              <Button variant="ghost" disabled={busy || !file} onClick={() => setConfirmOpen(true)}>
                {t("结束 / 取消本次导入")}
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
              steps={<WizardStepIndicator label={t("导入进度")} steps={steps} currentStep={step} />}
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
                      (step === "upload" || step === "mapping" || !!counts.ready)
                    }
                    nextLabel={
                      step === "confirm"
                        ? t("确认仅导入已就绪 {{count}} 笔", { count: n(counts.ready) })
                        : step === "mapping"
                          ? t("保存映射并预览")
                          : t("提交确认")
                    }
                    nextLoadingLabel={t("正在核对并保存…")}
                    backLabel={step === "preview" ? t("返回账户映射") : t("上一步")}
                    isNextLoading={busy}
                  />
                ) : undefined
              }
            >
              {(error || evaluated.error) && (
                <AlertFeedback variant="error" title={t("错误")} role="alert">
                  {t(
                    error || evaluated.error,
                    errorLine === undefined ? {} : { line: n(errorLine) },
                  )}
                </AlertFeedback>
              )}
              {message && step !== "result" && (
                <AlertFeedback variant="warning" title={t("核对提示")}>
                  {t(
                    message,
                    Object.fromEntries(
                      Object.entries(messageValues).map(([key, value]) => [key, n(value)]),
                    ),
                  )}
                </AlertFeedback>
              )}
              {step === "upload" && (
                <div className="space-y-4">
                  <FileDropzone
                    file={file}
                    onFileChange={(nextFile) => {
                      if (file) setConfirmOpen(true);
                      else if (nextFile) void upload(nextFile);
                    }}
                    isLoading={busy || !loaded}
                    accept={[...new Set(statementParsers.flatMap((candidate) => candidate.formats))]
                      .map((format) => `.${format}`).join(",")}
                    error={error}
                    labels={{
                      choose: t("选择账单文件"),
                      remove: t("移除文件"),
                      processing: t("正在读取账单…"),
                      drop: t("或拖拽文件"),
                      hint: statementParsers.map((candidate) => t(candidate.fileHintKey)).join(" · "),
                    }}
                  />
                  <p className="text-muted-foreground text-sm">
                    {t("原文件只在本地读取，预览确认后才会保存账目。")}
                  </p>
                </div>
              )}
              {step === "mapping" && (
                <div className="space-y-4">
                  {parser && (
                    <AlertFeedback variant="warning" title={`${t(parser.displayNameKey)} · ${t("映射实际资金账户")}`}>
                      {t(parser.mappingHintKey, { count: n(rows.length) })}
                    </AlertFeedback>
                  )}
                  {!available.length && (
                    <AlertFeedback variant="warning" title={t("待确认")}>
                      {t("没有可用的 CNY 现金或信用卡账户，请先在主程序创建账户。")}
                    </AlertFeedback>
                  )}
                  {paymentMethods.map((method) => {
                    const resolution = accountResolutions.get(method)!;
                    const candidateIds = resolution.candidates.map((candidate) => candidate.accountId);
                    const options = [
                      ...candidateIds,
                      ...accountOptions.map((option) => option.value).filter((id) => !candidateIds.includes(id)),
                    ].map((id) => accountOptions.find((option) => option.value === id)!);
                    const origin = !resolution.accountId ? "待选择"
                      : Object.hasOwn(mappingChoices, method) ? "人工选择"
                      : resolution.origin === "saved" ? "已保存" : "自动识别";
                    return (
                      <div key={method} className="grid items-start gap-3 sm:grid-cols-2">
                        <span>
                          {method || t("未提供付款方式（请指定收款账户）")}{" "}
                          <Badge variant="outline">{t(origin)}</Badge>
                        </span>
                        <div className="space-y-2">
                          <Choice
                            label={t("账户映射：{{method}}", { method })}
                            value={resolution.accountId}
                            options={options}
                            disabled={busy}
                            onChange={(id) => setMappingChoices((current) => ({ ...current, [method]: id }))}
                          />
                          {resolution.candidates.length > 0 && (
                            <ul aria-label={t("推荐账户")} className="text-muted-foreground space-y-1 text-xs">
                              {resolution.candidates.map((candidate) => (
                                <li key={candidate.accountId}>
                                  {accountOptions.find((option) => option.value === candidate.accountId)!.label}{" · "}
                                  {t(candidate.confidence === "high" ? "高置信" : candidate.confidence === "medium" ? "中置信" : "低置信")}{" · "}
                                  {candidate.reasons.map((reason) => t(reason)).join(" · ")}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <Button variant="outline" disabled={busy} onClick={() => void resetMappings()}>
                    {t("重置映射")}
                  </Button>
                </div>
              )}
              {(step === "preview" || step === "confirm") && (
                <div className="space-y-4">
                  <dl className="flex flex-wrap gap-6">
                    {statistics.map(({ label, value }) => (
                      <div key={label}>
                        <dt className="text-muted-foreground text-sm">{label}</dt>
                        <dd className="text-xl tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <AlertFeedback variant="warning" title={t("提交确认")}>
                    {t(
                      "仅提交已就绪记录。不计收支、组合支付及未知状态需逐笔确认性质、实际金额和账户；转账、还款、理财请排除。本版保留来源分类，不自动分配系统分类。",
                    )}
                  </AlertFeedback>
                  {step === "preview" && <DataGrid {...grid} dir={dir} height={440} />}
                </div>
              )}
              {step === "result" && submission && (
                <ImportResultSummary
                  title={t(
                    submission.outcome === "success"
                      ? "导入完成"
                      : submission.outcome === "partial"
                        ? "部分完成"
                        : "结果待核对",
                  )}
                  outcome={
                    submission.outcome === "success"
                      ? "success"
                      : submission.outcome === "partial"
                        ? "partial"
                        : "uncertain"
                  }
                  description={t(
                    submission.message,
                    Object.fromEntries(
                      Object.entries(submission.messageValues ?? {}).map(([key, value]) => [
                        key,
                        n(value),
                      ]),
                    ),
                  )}
                  statistics={[
                    { label: t("本次确认新增"), value: n(submission.created) },
                    {
                      label: t(submission.outcome === "uncertain" ? "待确认" : "未提交"),
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
                    {t("返回预览")}
                  </Button>
                  <Button onClick={cancel}>{t("开始新导入")}</Button>
                </ImportResultSummary>
              )}
              <p className="text-muted-foreground mt-3 text-xs">
                {t(
                  "重复检测覆盖可读取的非归档账户。若相关账户已归档，请先在主程序取消归档再导入。",
                )}
              </p>
            </ImportWizardLayout>
          </div>
        </PageContent>
        <CancelConfirmationDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          onConfirm={cancel}
          title={t("放弃本次导入？")}
          description={t("将清除已上传账单和未提交的修改。")}
          continueLabel={t("继续编辑")}
          cancelLabel={t("取消本次导入")}
        />
      </Page>
    </div>
  );
}
