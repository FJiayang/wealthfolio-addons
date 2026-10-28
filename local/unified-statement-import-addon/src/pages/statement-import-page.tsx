import { useEffect, useMemo, useRef, useState } from "react";
import type { Account, AddonContext } from "@wealthfolio/addon-sdk";
import {
  Alert,
  AlertDescription,
  Button,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
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
} from "@wealthfolio/ui";
import { parseStatement } from "../parsers";
import type { EntryKind, StatementRow } from "../parsers/types";
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
import { ImportStepIndicator, type ImportStep } from "../components/import-step-indicator";

const labels: Record<PreviewStatus, string> = {
  ready: "待导入",
  duplicate: "重复",
  excluded: "排除",
  review: "待确认",
  error: "错误",
};
const statusAppearance = {
  ready: {
    className: "border-success-subtle-border bg-success-subtle text-success-subtle-foreground",
    icon: Icons.CheckCircle,
  },
  duplicate: {
    className: "border-info-subtle-border bg-info-subtle text-info-subtle-foreground",
    icon: Icons.Copy,
  },
  excluded: {
    className: "border-border bg-muted/30 text-muted-foreground",
    icon: Icons.MinusCircle,
  },
  review: {
    className: "border-warning-subtle-border bg-warning-subtle text-warning-subtle-foreground",
    icon: Icons.AlertCircle,
  },
  error: {
    className:
      "border-destructive-subtle-border bg-destructive-subtle text-destructive-subtle-foreground",
    icon: Icons.XCircle,
  },
};
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
  return (
    <Select
      value={value || "__none__"}
      onValueChange={(next) => onChange(next === "__none__" ? "" : (next ?? ""))}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className="h-8 w-full min-w-32 rounded-md text-xs">
        <SelectValue>
          {options.find((option) => option.value === value)?.label ?? "请选择"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">请选择</SelectItem>
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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activities, setActivities] = useState<ExistingActivity[]>([]);
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [mappings, setMappings] = useState<Mappings>({});
  const [decisions, setDecisions] = useState<Decisions>({});
  const [step, setStep] = useState<ImportStep>("upload");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  const submitter = useMemo(() => createSubmitter(ctx.api), [ctx]);
  const input = useRef<HTMLInputElement>(null);

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
    label: `${account.name} · ${account.accountType === "CREDIT_CARD" ? "信用卡" : "现金"}`,
  }));
  const evaluated = useMemo(() => {
    try {
      return { preview: buildPreview(rows, accounts, activities, mappings, decisions), error: "" };
    } catch (cause) {
      return {
        preview: [] as PreviewRow[],
        error: cause instanceof Error ? cause.message : "来源信息无法读取。",
      };
    }
  }, [rows, accounts, activities, mappings, decisions]);
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

  function changeDecision(line: number, patch: RowDecision) {
    if (step === "result") setStep("preview");
    setDecisions((current) => ({
      ...current,
      [line]: { ...current[line], confirmed: false, ...patch },
    }));
    setMessage("");
  }

  async function upload(file: File) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const parsed = parseStatement(new Uint8Array(await file.arrayBuffer()), file.name);
      setRows(parsed);
      setDecisions({});
      setStep("mapping");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "账单读取失败。");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function saveMappings() {
    setBusy(true);
    setError("");
    try {
      await ctx.api.storage.set(MAPPING_KEY, JSON.stringify(mappings));
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
      const result = await submitter(rows, mappings, decisions, preview);
      setMessage(result.message);
      const [currentAccounts, currentActivities] = await Promise.all([
        ctx.api.accounts.getAll(),
        ctx.api.activities.getAll(),
      ]);
      setAccounts(currentAccounts);
      setActivities(currentActivities);
      if (result.created > 0) setStep("result");
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
      setError("");
      setMessage("已重置保存的账户映射。");
    } catch {
      setError("重置映射失败。");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setRows([]);
    setDecisions({});
    setStep("upload");
    setError("");
    setMessage("");
  }

  return (
    <div className="statement-import">
      <Page>
        <PageHeader
          heading="账单导入"
          actions={
            <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
              刷新核对
            </Button>
          }
        />
        <PageContent withPadding={false}>
          <div className="px-2 pt-2 pb-6 sm:px-4 sm:pt-4 md:px-6 md:pt-6">
            <Card className="w-full gap-0 overflow-hidden">
              <CardHeader className="shrink-0 border-b px-3 py-3 sm:px-6 sm:py-4">
                <ImportStepIndicator currentStep={step} />
              </CardHeader>
              <CardContent className="space-y-6 p-3 sm:p-6">
                {(error || evaluated.error) && (
                  <Alert variant="destructive">
                    <AlertDescription role="alert">{error || evaluated.error}</AlertDescription>
                  </Alert>
                )}
                {message && step !== "result" && (
                  <Alert>
                    <AlertDescription role="status">{message}</AlertDescription>
                  </Alert>
                )}
                {step === "upload" && (
                  <Card className="border-0 bg-transparent shadow-none">
                    <CardHeader className="px-0 pt-0">
                      <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                        <span className="text-muted-foreground font-mono text-xs tabular-nums">
                          01
                        </span>
                        上传支付宝交易明细
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 px-0 pb-0">
                      <Input
                        ref={input}
                        aria-label="选择 CSV 文件"
                        type="file"
                        className="sr-only"
                        accept=".csv,text/csv"
                        disabled={busy || !loaded}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void upload(file);
                        }}
                      />
                      <Button
                        variant="outline"
                        className="bg-background/50 hover:bg-background/80 hover:border-muted-foreground/50 h-32 w-full flex-col gap-2 rounded-lg border-dashed"
                        disabled={busy || !loaded}
                        onClick={() => input.current?.click()}
                      >
                        <Icons.Upload className="text-muted-foreground size-5" />
                        <span>{busy ? "正在读取账单…" : "选择 CSV 文件"}</span>
                        <span className="text-muted-foreground text-xs font-normal">
                          支付宝交易明细 · UTF-8 / GB18030
                        </span>
                      </Button>
                      <p className="text-muted-foreground text-xs">
                        原文件只在本地读取，预览确认后才会保存账目。
                      </p>
                      {!loaded && (
                        <p className="text-muted-foreground text-sm">正在等待账户与账目数据。</p>
                      )}
                    </CardContent>
                  </Card>
                )}
                {step === "mapping" && (
                  <Card className="border-0 bg-transparent shadow-none">
                    <CardHeader className="px-0 pt-0">
                      <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                        <span className="text-muted-foreground font-mono text-xs tabular-nums">
                          02
                        </span>
                        映射实际资金账户
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 px-0 pb-0">
                      <p className="text-muted-foreground text-sm">
                        已读取 {rows.length}{" "}
                        条明细。银行卡名称及尾号仅作提示，请选择实际扣款或收款账户。余额宝、花呗或组合付款不应直接当作支付宝余额。
                      </p>
                      {!available.length && (
                        <Alert variant="warning">
                          <AlertDescription>
                            没有可用的 CNY 现金或信用卡账户，请先在主程序创建账户。
                          </AlertDescription>
                        </Alert>
                      )}
                      <div className="statement-import-scroll max-h-[65vh] rounded-md border">
                        <Table
                          aria-label="账户映射"
                          containerClassName="overflow-visible"
                          className="statement-import-grid min-w-[640px] border-separate border-spacing-0 text-xs"
                        >
                          <TableHeader className="bg-card sticky top-0 z-10">
                            <TableRow>
                              <TableHead>#</TableHead>
                              <TableHead>付款方式</TableHead>
                              <TableHead>目标账户</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {paymentMethods.map((method, index) => (
                              <TableRow key={method}>
                                <TableCell className="w-12 font-mono tabular-nums">
                                  {index + 1}
                                </TableCell>
                                <TableCell className="max-w-96 truncate" title={method}>
                                  {method || "未提供付款方式（请指定收款账户）"}
                                </TableCell>
                                <TableCell className="w-64 min-w-64">
                                  <Choice
                                    label={`账户映射：${method || "未提供付款方式"}`}
                                    value={mappings[method] ?? ""}
                                    options={accountOptions}
                                    disabled={busy}
                                    onChange={(id) =>
                                      setMappings((current) => ({ ...current, [method]: id }))
                                    }
                                  />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:items-center">
                        <Button variant="outline" disabled={busy} onClick={cancel}>
                          <Icons.ArrowLeft className="me-2 size-4 rtl:rotate-180" />
                          取消本次导入
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => void resetMappings()}
                        >
                          重置映射
                        </Button>
                        <Button
                          className="sm:ms-auto"
                          disabled={busy}
                          onClick={() => void saveMappings()}
                        >
                          保存映射并预览
                          <Icons.ArrowRight className="ms-2 size-4 rtl:rotate-180" />
                        </Button>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        只记住付款方式与系统账户的映射；不会保存账单文件。未映射行不会提交。
                      </p>
                    </CardContent>
                  </Card>
                )}
                {(step === "preview" || step === "result") && (
                  <>
                    {step === "result" && (
                      <div
                        className="flex flex-col items-center gap-3 py-6 text-center"
                        role="status"
                      >
                        <div className="bg-success-subtle text-success-subtle-foreground flex size-14 items-center justify-center rounded-full">
                          <Icons.Check className="size-7" />
                        </div>
                        <h2 className="text-xl font-semibold">导入结果</h2>
                        <p className="text-muted-foreground text-sm">{message}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      {Object.entries(labels).map(([status, label]) => {
                        const { className, icon: Icon } = statusAppearance[status as PreviewStatus];
                        return (
                          <Card key={status} className={className} data-processing-status={status}>
                            <CardContent className="flex items-center gap-3 p-3">
                              <Icon aria-hidden="true" className="size-5 shrink-0" />
                              <div>
                                <p className="text-xs font-medium">{label}</p>
                                <p className="font-mono text-xl font-semibold tabular-nums">
                                  {counts[status]}
                                </p>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                    <Alert>
                      <AlertDescription>
                        仅提交已就绪记录。不计收支、组合支付及未知状态需逐笔确认性质、实际金额和账户；转账、还款、理财请排除。本版保留来源分类，不自动分配系统分类。
                      </AlertDescription>
                    </Alert>
                    <section className="space-y-3" aria-label="逐笔预览">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold">逐笔预览 · CNY</h2>
                        <span className="text-muted-foreground font-mono text-xs">
                          共 {preview.length} 条
                        </span>
                      </div>
                      <div className="statement-import-scroll max-h-[65vh] rounded-md border">
                        <Table
                          aria-label="账单预览"
                          containerClassName="overflow-visible"
                          className="statement-import-grid w-max min-w-full border-separate border-spacing-0 font-mono text-xs"
                        >
                          <TableHeader className="bg-card sticky top-0 z-10">
                            <TableRow>
                              {[
                                "#",
                                "交易时间",
                                "交易对方",
                                "商品说明",
                                "来源分类",
                                "收/支",
                                "付款方式",
                                "交易状态",
                                "订单号",
                                "原金额",
                                "记账性质",
                                "确认金额",
                                "目标账户",
                                "处理状态",
                                "操作",
                              ].map((label) => (
                                <TableHead key={label}>{label}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {preview.map((entry) => {
                              const { row } = entry;
                              const source = row.source;
                              const decision = decisions[source.lineNumber] ?? {};
                              const StatusIcon = statusAppearance[entry.status].icon;
                              const locked =
                                busy ||
                                row.excluded ||
                                entry.status === "duplicate" ||
                                Boolean(row.error);
                              return (
                                <TableRow key={source.lineNumber}>
                                  <TableCell className="w-12 tabular-nums">
                                    {source.lineNumber}
                                  </TableCell>
                                  <TableCell>{source.originalTime}</TableCell>
                                  <TableCell className="max-w-48 truncate" title={source.merchant}>
                                    {source.merchant}
                                  </TableCell>
                                  <TableCell
                                    className="max-w-64 truncate"
                                    title={source.description}
                                  >
                                    {source.description}
                                  </TableCell>
                                  <TableCell>{source.category}</TableCell>
                                  <TableCell>{source.direction}</TableCell>
                                  <TableCell
                                    className="max-w-56 truncate"
                                    title={source.paymentMethod}
                                  >
                                    {source.paymentMethod || "未提供"}
                                  </TableCell>
                                  <TableCell>{source.status}</TableCell>
                                  <TableCell>{source.recordId || "缺失"}</TableCell>
                                  <TableCell data-numeric>{source.amount}</TableCell>
                                  <TableCell className="min-w-36">
                                    <Choice
                                      label={`第 ${source.lineNumber} 行性质`}
                                      value={entry.kind ?? ""}
                                      options={Object.entries(kinds).map(([value, label]) => ({
                                        value,
                                        label,
                                      }))}
                                      disabled={locked}
                                      onChange={(kind) =>
                                        changeDecision(source.lineNumber, {
                                          kind: kind ? (kind as EntryKind) : undefined,
                                        })
                                      }
                                    />
                                  </TableCell>
                                  <TableCell className="w-28 min-w-28">
                                    <Input
                                      aria-label={`第 ${source.lineNumber} 行确认金额`}
                                      inputMode="decimal"
                                      value={entry.amount}
                                      disabled={locked}
                                      className="h-8 rounded-md text-end font-mono text-xs"
                                      onChange={(event) =>
                                        changeDecision(source.lineNumber, {
                                          amount: event.target.value,
                                        })
                                      }
                                    />
                                  </TableCell>
                                  <TableCell className="min-w-56">
                                    <Choice
                                      label={`第 ${source.lineNumber} 行账户`}
                                      value={entry.accountId}
                                      options={accountOptions}
                                      disabled={locked}
                                      onChange={(accountId) =>
                                        changeDecision(source.lineNumber, { accountId })
                                      }
                                    />
                                  </TableCell>
                                  <TableCell title={entry.reason}>
                                    <div className="flex items-center gap-2">
                                      <Badge
                                        variant="outline"
                                        className={`gap-1 text-xs ${statusAppearance[entry.status].className}`}
                                        data-processing-status={entry.status}
                                      >
                                        <StatusIcon aria-hidden="true" className="size-3" />
                                        {labels[entry.status]}
                                      </Badge>
                                      <span className="text-muted-foreground max-w-56 truncate">
                                        {entry.reason}
                                      </span>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-3">
                                      {!row.excluded && entry.status !== "duplicate" && (
                                        <label className="flex items-center gap-1.5">
                                          <Checkbox
                                            aria-label={`第 ${source.lineNumber} 行排除`}
                                            disabled={busy}
                                            checked={Boolean(decision.excluded)}
                                            onCheckedChange={(checked) =>
                                              changeDecision(source.lineNumber, {
                                                excluded: checked,
                                              })
                                            }
                                          />
                                          排除
                                        </label>
                                      )}
                                      {row.reviewReason &&
                                        !row.excluded &&
                                        entry.status !== "duplicate" &&
                                        !decision.excluded && (
                                          <label
                                            className="flex items-center gap-1.5"
                                            title="已核实性质、实际金额和账户"
                                          >
                                            <Checkbox
                                              aria-label={`第 ${source.lineNumber} 行确认`}
                                              disabled={
                                                busy ||
                                                !entry.kind ||
                                                !entry.accountId ||
                                                Boolean(row.error) ||
                                                !source.recordId
                                              }
                                              checked={Boolean(decision.confirmed)}
                                              onCheckedChange={(checked) =>
                                                changeDecision(source.lineNumber, {
                                                  confirmed: checked,
                                                })
                                              }
                                            />
                                            已核实
                                          </label>
                                        )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </section>
                    <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:items-center">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setStep("mapping");
                          setMessage("");
                        }}
                      >
                        <Icons.ArrowLeft className="me-2 size-4 rtl:rotate-180" />
                        返回账户映射
                      </Button>
                      <Button variant="ghost" disabled={busy} onClick={cancel}>
                        结束 / 取消本次导入
                      </Button>
                      <Button
                        className="sm:ms-auto"
                        disabled={busy || !loaded || Boolean(evaluated.error) || !counts.ready}
                        onClick={() => void submit()}
                      >
                        {busy ? "正在核对并保存…" : `确认仅导入已就绪 ${counts.ready} 笔`}
                        <Icons.ArrowRight className="ms-2 size-4 rtl:rotate-180" />
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            <p className="text-muted-foreground mt-3 text-xs">
              重复检测覆盖可读取的非归档账户。若相关账户已归档，请先在主程序取消归档再导入。
            </p>
          </div>
        </PageContent>
      </Page>
    </div>
  );
}
