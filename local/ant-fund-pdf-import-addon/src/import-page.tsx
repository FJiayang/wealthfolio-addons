import { useEffect, useRef, useState } from "react";
import type {
  Account,
  ActivityImport,
  AddonContext,
  ImportActivitiesResult,
  SymbolSearchResult,
} from "@wealthfolio/addon-sdk";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icons,
  Input,
  Label,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useAmountFormatting,
  useDateFormatting,
  useLocalizationSettings,
  useNumberFormatting,
} from "@wealthfolio/ui";
import { compact, HEADER, parseStatement, StatementError } from "./statement";
import {
  bindingFromSearch,
  confirmationDate,
  createDrafts,
  hasErrors,
  isDuplicate,
  reconcileResult,
  requiresExistingAsset,
  rowsToImport,
  sourceRowNumber,
  toActivities,
  unitPrice,
  type DraftLeg,
  type DraftRow,
  type FundBinding,
} from "./import-model";
import { ImportStepIndicator, type ImportStep } from "./components/import-step-indicator";
import { en, zh, type MessageKey } from "./messages";

type Translate = (key: MessageKey) => string;
const appearances = {
  ready: {
    variant: "success-subtle",
    icon: Icons.CheckCircle,
    surface: "bg-success-subtle text-success-subtle-foreground border-success-subtle-border",
  },
  pending: {
    variant: "warning-subtle",
    icon: Icons.AlertTriangle,
    surface: "bg-warning-subtle text-warning-subtle-foreground border-warning-subtle-border",
  },
  error: {
    variant: "destructive-subtle",
    icon: Icons.XCircle,
    surface:
      "bg-destructive-subtle text-destructive-subtle-foreground border-destructive-subtle-border",
  },
  duplicate: {
    variant: "info-subtle",
    icon: Icons.Copy,
    surface: "bg-info-subtle text-info-subtle-foreground border-info-subtle-border",
  },
  excluded: {
    variant: "outline",
    icon: Icons.X,
    surface: "bg-muted/30 text-muted-foreground border-border",
  },
  imported: {
    variant: "success-subtle",
    icon: Icons.CheckCircle,
    surface: "bg-success-subtle text-success-subtle-foreground border-success-subtle-border",
  },
} as const;
type RowStatus = keyof typeof appearances;
const statusKeys: Record<RowStatus, MessageKey> = {
  ready: "validRows",
  pending: "pendingRows",
  error: "failed",
  duplicate: "duplicates",
  excluded: "excluded",
  imported: "imported",
};

export function AntFundImportPage({ ctx }: { ctx: AddonContext }) {
  const { uiLocale } = useLocalizationSettings();
  const messages = uiLocale.startsWith("zh") ? zh : en;
  const t: Translate = (key) => messages[key];
  const { formatDecimal, formatQuantity } = useNumberFormatting();
  const { formatAmount } = useAmountFormatting();
  const { formatCalendarDate } = useDateFormatting();
  const n = (value: number) => formatDecimal(value, { maximumFractionDigits: 0 });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [bindings, setBindings] = useState<Record<string, FundBinding>>({});
  const [checked, setChecked] = useState<ActivityImport[]>([]);
  const [result, setResult] = useState<ImportActivitiesResult | null>(null);
  const [previewSkipped, setPreviewSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [step, setStep] = useState<ImportStep>("upload");
  const [fileName, setFileName] = useState("");
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<RowStatus | "all">("all");
  const [selectedFund, setSelectedFund] = useState<{ code: string; name: string } | null>(null);
  const [editing, setEditing] = useState<{ index: number; draft: DraftRow } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const blocked = busy || !!result;

  function errorMessage(error: unknown): string {
    if (error instanceof StatementError) {
      const key =
        error.code === "date" ? "dateError" : error.code === "amount" ? "amountError" : error.code;
      return `${t(key)}${error.location ? ` (#${error.location})` : ""}`;
    }
    return t("unknown");
  }
  function sourceLabel(lineNumber: number | undefined) {
    return lineNumber === undefined
      ? t("unknownSource")
      : `${t("sourceRecord")} #${n(sourceRowNumber(lineNumber))}`;
  }
  function warningMessages(row: ActivityImport) {
    const messages = Object.entries(row.warnings ?? {})
      .filter(([key]) => key !== "_duplicate" || row.duplicateOfLineNumber == null)
      .flatMap(([, warnings]) => warnings);
    if (row.duplicateOfLineNumber != null)
      messages.push(`${t("duplicateSource")} ${sourceLabel(row.duplicateOfLineNumber)}`);
    return messages;
  }
  useEffect(() => {
    mounted.current = true;
    ctx.api.accounts
      .getAll()
      .then((all) => {
        if (mounted.current)
          setAccounts(
            all.filter(
              (account) =>
                account.currency === "CNY" &&
                account.isActive &&
                !account.isArchived &&
                account.accountType === "SECURITIES" &&
                account.trackingMode === "TRANSACTIONS",
            ),
          );
      })
      .catch(() => {
        if (mounted.current) setError(t("unknown"));
      });
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [ctx]);

  function invalidate() {
    setChecked([]);
    setResult(null);
    setPreviewSkipped(0);
    setError("");
  }
  async function upload(file?: File) {
    if (!file) return;
    invalidate();
    setDrafts([]);
    setBindings({});
    setPage(0);
    setFilter("all");
    setBusy(true);
    setFileName(file.name);
    controller.current = new AbortController();
    try {
      const rows = await parseStatement(
        new Uint8Array(await file.arrayBuffer()),
        ctx.assets,
        (page, total) => {
          if (mounted.current) setProgress(`${page} / ${total}`);
        },
        controller.current.signal,
      );
      if (mounted.current) {
        setDrafts(createDrafts(rows));
        setStep("funds");
      }
    } catch (error) {
      if (mounted.current && !controller.current.signal.aborted)
        setError(error instanceof StatementError ? errorMessage(error) : t("format"));
    } finally {
      if (mounted.current) {
        setBusy(false);
        setProgress("");
      }
      controller.current = null;
    }
  }
  function updateDraft(index: number, draft: DraftRow) {
    invalidate();
    setDrafts((rows) => rows.map((row, i) => (i === index ? draft : row)));
  }
  async function validate(inputs?: ActivityImport[]) {
    setError("");
    setBusy(true);
    setChecked([]);
    try {
      const rows = inputs ?? toActivities(drafts, bindings, accountId);
      const checked = await ctx.api.activities.checkImport(
        rows.map((row) => ({ ...row, forceImport: false })),
      );
      if (
        checked.length !== rows.length ||
        checked.some((row, i) => row.lineNumber !== rows[i].lineNumber)
      )
        throw new StatementError("validation");
      if (mounted.current) {
        setChecked(checked);
        setResult(null);
        setStep("review");
        setFilter("all");
        setPage(0);
      }
    } catch (error) {
      if (mounted.current) setError(errorMessage(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function commit() {
    setBusy(true);
    setError("");
    try {
      const rows = rowsToImport(checked);
      if (!rows.length) throw new StatementError("empty");
      setPreviewSkipped(checked.length - rows.length);
      const result = await ctx.api.activities.import(rows);
      if (mounted.current) {
        setResult(result);
        setStep("result");
        setPage(0);
        setFilter("all");
      }
    } catch (error) {
      if (mounted.current) {
        setChecked([]);
        setError(error instanceof StatementError ? errorMessage(error) : t("uncertain"));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function reset() {
    invalidate();
    setDrafts([]);
    setBindings({});
    setFileName("");
    setStep("upload");
    setPage(0);
    setFilter("all");
    setEditing(null);
    setSelectedFund(null);
  }
  function draftError(draft: DraftRow) {
    if (draft.excluded) return "";
    try {
      toActivities([draft], bindings, accountId);
      return "";
    } catch (error) {
      return errorMessage(error);
    }
  }

  const funds = new Map<string, string>();
  for (const draft of drafts)
    if (!draft.excluded) {
      if (!draft.legs.length)
        funds.set(compact(draft.source.cells[5]), compact(draft.source.cells[3]));
      for (const leg of draft.legs) if (leg.code) funds.set(leg.code, leg.name);
    }
  const pending = drafts.filter((draft) => draftError(draft)).length;
  const checkedByLine = new Map(checked.map((row) => [row.lineNumber, row]));
  const resultByLine = new Map(result?.activities.map((row) => [row.lineNumber, row]) ?? []);
  const entries = drafts
    .flatMap((draft, index) =>
      (draft.legs.length ? draft.legs : [undefined]).map((leg, legIndex) => {
        const line = draft.source.line * 2 + legIndex;
        const checkedRow = checkedByLine.get(line);
        const returned = resultByLine.get(line);
        const hostRow = returned ?? checkedRow;
        const problem = draftError(draft);
        const status: RowStatus = draft.excluded
          ? "excluded"
          : problem
            ? "pending"
            : hostRow && hasErrors(hostRow)
              ? "error"
              : hostRow && isDuplicate(hostRow) && !hostRow.forceImport
                ? "duplicate"
                : returned
                  ? "imported"
                  : "ready";
        const notes = hostRow
          ? Object.values(hostRow.errors ?? {})
              .flat()
              .concat(warningMessages(hostRow))
              .join("\n")
          : problem;
        return { draft, index, leg, line, checkedRow, status, notes };
      }),
    )
    .filter((entry) => !checked.length || entry.draft.excluded || checkedByLine.has(entry.line));
  const filtered = filter === "all" ? entries : entries.filter((entry) => entry.status === filter);
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, totalPages - 1);
  const failures = result ? reconcileResult(checked, result) : [];
  const ResultIcon =
    failures.length || result?.summary.success === false ? Icons.AlertTriangle : Icons.Check;
  const statusLabel = (status: RowStatus) =>
    t(status === "ready" && checked.length ? "readyToImport" : statusKeys[status]);

  return (
    <div className="ant-fund-import">
      <Page>
        <PageHeader heading={t("title")} />
        <PageContent withPadding={false}>
          <div className="px-2 pt-2 pb-6 sm:px-4 sm:pt-4 md:px-6 md:pt-6">
            <Card className="w-full gap-0 overflow-hidden">
              <CardHeader className="shrink-0 border-b px-3 py-3 sm:px-6 sm:py-4">
                <ImportStepIndicator currentStep={step} t={t} />
              </CardHeader>
              <CardContent className="space-y-6 p-3 sm:p-6">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription role="alert">{error}</AlertDescription>
                  </Alert>
                )}
                {step === "upload" && (
                  <section className="space-y-5" aria-label={t("upload")}>
                    <div>
                      <h2 className="text-sm font-semibold">{t("uploadTitle")}</h2>
                      <p className="text-muted-foreground mt-1 text-sm">{t("description")}</p>
                    </div>
                    <div className="max-w-md space-y-2">
                      <Label htmlFor="ant-account">{t("account")}</Label>
                      <Select
                        disabled={busy}
                        items={accounts.map((account) => ({
                          value: account.id,
                          label: account.name,
                        }))}
                        value={accountId}
                        onValueChange={(value) => {
                          if (value) {
                            setAccountId(value);
                            invalidate();
                          }
                        }}
                      >
                        <SelectTrigger id="ant-account">
                          <SelectValue placeholder={t("select")} />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!accounts.length && (
                        <p className="text-muted-foreground text-sm">{t("emptyAccounts")}</p>
                      )}
                    </div>
                    <Input
                      ref={input}
                      type="file"
                      className="sr-only"
                      aria-label={t("upload")}
                      accept=".pdf,application/pdf"
                      disabled={busy || !accountId}
                      onChange={(event) => {
                        void upload(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                    <Button
                      variant="outline"
                      className="bg-background/50 hover:bg-background/80 hover:border-muted-foreground/50 h-32 w-full flex-col gap-2 rounded-lg border-dashed"
                      disabled={busy || !accountId}
                      onClick={() => input.current?.click()}
                    >
                      <Icons.Upload className="text-muted-foreground size-5" />
                      <span>{busy ? t("parsing") : t("choosePdf")}</span>
                      <span className="text-muted-foreground text-xs font-normal">
                        {t("pdfHint")}
                      </span>
                    </Button>
                    {fileName && (
                      <p className="text-muted-foreground text-sm">
                        <bdi>{fileName}</bdi>
                        {drafts.length ? ` · ${t("records")}: ${n(drafts.length)}` : ""}
                      </p>
                    )}
                    {progress && (
                      <div className="flex items-center gap-3" role="status">
                        {t("parsing")}: <bdi>{progress}</bdi>
                        <Button variant="outline" onClick={() => controller.current?.abort()}>
                          {t("cancel")}
                        </Button>
                      </div>
                    )}
                    <Alert>
                      <AlertDescription>{t("cashHint")}</AlertDescription>
                    </Alert>
                  </section>
                )}
                {step === "funds" && (
                  <section className="space-y-4" aria-label={t("funds")}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold">{t("funds")}</h2>
                      <span className="text-muted-foreground text-xs">
                        {n([...funds.keys()].filter((code) => !!bindings[code]).length)} /{" "}
                        {n(funds.size)} · {t("bound")}
                      </span>
                    </div>
                    <Alert>
                      <AlertDescription>{t("fundHint")}</AlertDescription>
                    </Alert>
                    <div className="ant-fund-import-scroll max-h-[65vh] rounded-md border">
                      <Table
                        aria-label={t("funds")}
                        containerClassName="overflow-visible"
                        className="ant-fund-import-grid w-max min-w-full border-separate border-spacing-0 text-xs"
                      >
                        <TableHeader className="bg-card sticky top-0 z-10">
                          <TableRow>
                            {["code", "fundName", "boundAsset", "status", "actions"].map((key) => (
                              <TableHead key={key}>{t(key as MessageKey)}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[...funds].map(([code, name]) => (
                            <TableRow key={code}>
                              <TableCell className="font-mono">
                                <bdi>{code}</bdi>
                              </TableCell>
                              <TableCell className="max-w-80 truncate" title={name}>
                                {name}
                              </TableCell>
                              <TableCell className="max-w-80 truncate">
                                {bindings[code]?.symbolName || bindings[code]?.symbol || "—"}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={bindings[code] ? "success-subtle" : "warning-subtle"}
                                >
                                  {bindings[code] ? t("bound") : t("unbound")}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setSelectedFund({ code, name })}
                                >
                                  {t("search")}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </section>
                )}
                {(step === "review" || step === "result") && (
                  <>
                    {result && (
                      <div
                        className="flex flex-col items-center gap-3 py-6 text-center"
                        role="status"
                      >
                        <div
                          className={`${failures.length || !result.summary.success ? "bg-warning-subtle text-warning-subtle-foreground" : "bg-success-subtle text-success-subtle-foreground"} flex size-14 items-center justify-center rounded-full`}
                        >
                          <ResultIcon className="size-7" />
                        </div>
                        <h2 className="text-xl font-semibold">{t("done")}</h2>
                        <p className="text-muted-foreground text-sm">
                          {t("imported")}: {n(result.summary.imported)} · {t("skipped")}:{" "}
                          {n(result.summary.skipped + previewSkipped)} · {t("failed")}:{" "}
                          {n(failures.length)}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {t("run")}: <bdi>{result.importRunId}</bdi>
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      {(["ready", "pending", "error", "duplicate", "excluded"] as const).map(
                        (status) => {
                          const { surface, icon: Icon } = appearances[status];
                          return (
                            <Card key={status} className={surface} data-processing-status={status}>
                              <CardContent className="flex items-center gap-3 p-3">
                                <Icon className="size-5 shrink-0" aria-hidden="true" />
                                <div>
                                  <p className="text-xs font-medium">
                                    {result && status === "ready"
                                      ? t("imported")
                                      : statusLabel(status)}
                                  </p>
                                  <p className="font-mono text-xl font-semibold tabular-nums">
                                    {n(
                                      entries.filter((entry) =>
                                        result && status === "ready"
                                          ? entry.status === "imported"
                                          : entry.status === status,
                                      ).length,
                                    )}
                                  </p>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        },
                      )}
                    </div>
                    {!result && (
                      <Alert>
                        <AlertDescription>{t("pendingHint")}</AlertDescription>
                      </Alert>
                    )}
                    <section className="space-y-3" aria-label={t("review")}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="text-sm font-semibold">{t("review")} · CNY</h2>
                          <p className="text-muted-foreground text-xs">
                            {t("records")}: {n(drafts.length)} · {t("rows")}: {n(entries.length)}
                          </p>
                        </div>
                        <Select
                          value={filter}
                          items={[
                            { value: "all", label: t("all") },
                            ...Object.keys(appearances).map((status) => ({
                              value: status,
                              label: statusLabel(status as RowStatus),
                            })),
                          ]}
                          onValueChange={(value) => {
                            if (value) {
                              setFilter(value as RowStatus | "all");
                              setPage(0);
                            }
                          }}
                        >
                          <SelectTrigger aria-label={t("filter")} className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{t("all")}</SelectItem>
                            {Object.keys(appearances).map((status) => (
                              <SelectItem key={status} value={status}>
                                {statusLabel(status as RowStatus)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="ant-fund-import-scroll max-h-[65vh] rounded-md border">
                        <Table
                          aria-label={t("review")}
                          containerClassName="overflow-visible"
                          className="ant-fund-import-grid w-max min-w-full border-separate border-spacing-0 font-mono text-xs"
                        >
                          <TableHeader className="bg-card sticky top-0 z-10">
                            <TableRow>
                              {[
                                "#",
                                t("date"),
                                t("fundName"),
                                t("code"),
                                t("type"),
                                t("quantity"),
                                t("amount"),
                                t("fee"),
                                t("status"),
                                t("notes"),
                                t("actions"),
                              ].map((label) => (
                                <TableHead key={label}>{label}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filtered
                              .slice(currentPage * 20, currentPage * 20 + 20)
                              .map((entry) => {
                                const { draft, index, leg, line, checkedRow, status, notes } =
                                  entry;
                                const { variant, icon: Icon } = appearances[status];
                                const code = leg?.code || compact(draft.source.cells[5]);
                                return (
                                  <TableRow key={line}>
                                    <TableCell>
                                      <bdi>{n(draft.source.line)}</bdi>
                                    </TableCell>
                                    <TableCell>
                                      <bdi>{leg?.date ? formatCalendarDate(leg.date) : "—"}</bdi>
                                    </TableCell>
                                    <TableCell
                                      className="max-w-64 truncate"
                                      title={
                                        bindings[code]?.symbolName ||
                                        leg?.name ||
                                        compact(draft.source.cells[3])
                                      }
                                    >
                                      {bindings[code]?.symbolName ||
                                        leg?.name ||
                                        compact(draft.source.cells[3])}
                                    </TableCell>
                                    <TableCell>
                                      <bdi>{code || "—"}</bdi>
                                    </TableCell>
                                    <TableCell>
                                      {leg ? t(leg.activityType) : compact(draft.source.cells[2])}
                                    </TableCell>
                                    <TableCell data-numeric>
                                      <bdi>
                                        {leg?.quantity && /^\d+(\.\d+)?$/.test(leg.quantity)
                                          ? formatQuantity(leg.quantity)
                                          : "—"}
                                      </bdi>
                                    </TableCell>
                                    <TableCell data-numeric>
                                      <bdi>
                                        {leg?.amount && /^\d+(\.\d+)?$/.test(leg.amount)
                                          ? formatAmount(leg.amount, "CNY")
                                          : "—"}
                                      </bdi>
                                    </TableCell>
                                    <TableCell data-numeric>
                                      <bdi>
                                        {leg?.fee && /^\d+(\.\d+)?$/.test(leg.fee)
                                          ? formatAmount(leg.fee, "CNY")
                                          : "—"}
                                      </bdi>
                                    </TableCell>
                                    <TableCell>
                                      <Badge
                                        variant={variant}
                                        className={
                                          status === "excluded"
                                            ? "bg-muted/30 text-muted-foreground"
                                            : undefined
                                        }
                                        data-processing-status={status}
                                      >
                                        <Icon className="size-3" />
                                        {statusLabel(status)}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="max-w-80 whitespace-normal font-sans">
                                      <span className="whitespace-pre-wrap">{notes || "—"}</span>
                                      {checkedRow && isDuplicate(checkedRow) && (
                                        <label className="mt-2 flex items-center gap-2">
                                          <Checkbox
                                            disabled={blocked || hasErrors(checkedRow)}
                                            checked={checkedRow.forceImport ?? false}
                                            onCheckedChange={(forceImport) =>
                                              setChecked((all) =>
                                                all.map((row) =>
                                                  row.lineNumber === line
                                                    ? { ...row, forceImport }
                                                    : row,
                                                ),
                                              )
                                            }
                                          />
                                          {t("force")}
                                        </label>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-1">
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          disabled={busy}
                                          aria-label={`${result ? t("inspect") : t("edit")} ${t("sourceRecord")} #${draft.source.line}`}
                                          onClick={() =>
                                            setEditing({
                                              index,
                                              draft: {
                                                ...draft,
                                                legs: draft.legs.map((leg) => ({ ...leg })),
                                              },
                                            })
                                          }
                                        >
                                          <Icons.Pencil className="size-4" />
                                        </Button>
                                        {!result && (
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            disabled={busy || !code}
                                            aria-label={`${t("funds")} ${code}`}
                                            onClick={() =>
                                              setSelectedFund({
                                                code,
                                                name: leg?.name || compact(draft.source.cells[3]),
                                              })
                                            }
                                          >
                                            <Icons.Search className="size-4" />
                                          </Button>
                                        )}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            {!filtered.length && (
                              <TableRow>
                                <TableCell
                                  colSpan={11}
                                  className="text-muted-foreground py-8 text-center"
                                >
                                  {t("noRows")}
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="flex items-center justify-end gap-3">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={currentPage === 0}
                          onClick={() => setPage(currentPage - 1)}
                        >
                          <Icons.ArrowLeft className="size-4 rtl:rotate-180" />
                          {t("previous")}
                        </Button>
                        <bdi className="text-muted-foreground text-xs">
                          {n(currentPage + 1)} / {n(totalPages)}
                        </bdi>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={currentPage + 1 >= totalPages}
                          onClick={() => setPage(currentPage + 1)}
                        >
                          {t("next")}
                          <Icons.ArrowRight className="size-4 rtl:rotate-180" />
                        </Button>
                      </div>
                    </section>
                  </>
                )}
              </CardContent>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-3 sm:px-6 sm:py-4">
                <div>
                  {step !== "upload" && step !== "result" && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setStep(step === "funds" ? "upload" : "funds")}
                    >
                      <Icons.ArrowLeft className="size-4 rtl:rotate-180" />
                      {t("previousStep")}
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {step === "upload" && !!drafts.length && (
                    <Button disabled={busy} onClick={() => setStep("funds")}>
                      {t("nextStep")}
                      <Icons.ArrowRight className="size-4 rtl:rotate-180" />
                    </Button>
                  )}
                  {step === "funds" && (
                    <Button onClick={() => setStep("review")}>
                      {t("preview")}
                      <Icons.ArrowRight className="size-4 rtl:rotate-180" />
                    </Button>
                  )}
                  {step === "review" && (
                    <>
                      <Button
                        variant="outline"
                        disabled={blocked || pending > 0}
                        onClick={() => void validate()}
                      >
                        {t("validate")}
                      </Button>
                      <Button
                        disabled={
                          blocked ||
                          !checked.length ||
                          checked.some(hasErrors) ||
                          !checked.some((row) => !isDuplicate(row) || row.forceImport)
                        }
                        onClick={() => void commit()}
                      >
                        {t("import")}
                      </Button>
                    </>
                  )}
                  {step === "result" && (
                    <>
                      {!!failures.length && (
                        <Button disabled={busy} onClick={() => void validate(failures)}>
                          {t("failedOnly")}
                        </Button>
                      )}
                      <Button variant="outline" disabled={busy} onClick={reset}>
                        {t("newSession")}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </PageContent>
        <Dialog
          open={!!selectedFund}
          onOpenChange={(open) => {
            if (!open) setSelectedFund(null);
          }}
        >
          {selectedFund && (
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>
                  {t("funds")} · <bdi>{selectedFund.code}</bdi>
                </DialogTitle>
                <DialogDescription>
                  {selectedFund.name} · {t("fundHint")}
                </DialogDescription>
              </DialogHeader>
              <FundSelector
                key={selectedFund.code}
                code={selectedFund.code}
                ctx={ctx}
                disabled={blocked}
                t={t}
                onBind={(binding) => {
                  invalidate();
                  setBindings((all) => ({ ...all, [selectedFund.code]: binding }));
                  setSelectedFund(null);
                }}
              />
            </DialogContent>
          )}
        </Dialog>
        <Dialog
          open={!!editing}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        >
          {editing && (
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>
                  {t(result ? "inspect" : "edit")} · {t("sourceRecord")} #
                  {n(editing.draft.source.line)}
                </DialogTitle>
                <DialogDescription>
                  {compact(editing.draft.source.cells[3])} · {t("pages")}:{" "}
                  {editing.draft.source.pages.map(n).join(", ")}
                </DialogDescription>
              </DialogHeader>
              <Tabs defaultValue={result ? "source" : "edit"}>
                <TabsList>
                  <TabsTrigger value="edit">{t("edit")}</TabsTrigger>
                  <TabsTrigger value="source">{t("source")}</TabsTrigger>
                </TabsList>
                <TabsContent value="edit" className="space-y-4">
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={editing.draft.excluded}
                      disabled={blocked}
                      onCheckedChange={(excluded) =>
                        setEditing({ ...editing, draft: { ...editing.draft, excluded } })
                      }
                    />
                    {t("exclude")}
                  </label>
                  {!editing.draft.legs.length && (
                    <Alert>
                      <AlertDescription className="space-y-3">
                        <p>{t("conversionHint")}</p>
                        <Button
                          variant="outline"
                          disabled={blocked || editing.draft.excluded}
                          onClick={() => {
                            const source = editing.draft.source.cells;
                            setEditing({
                              ...editing,
                              draft: {
                                ...editing.draft,
                                legs: [
                                  {
                                    activityType: "SELL",
                                    code: "",
                                    name: "",
                                    date: confirmationDate(source[11]),
                                    amount: "",
                                    quantity: compact(source[7]),
                                    fee: "0",
                                  },
                                  {
                                    activityType: "BUY",
                                    code: compact(source[5]),
                                    name: compact(source[3]),
                                    date: confirmationDate(source[11]),
                                    amount: compact(source[8]),
                                    quantity: compact(source[9]),
                                    fee: compact(source[10]),
                                  },
                                ],
                              },
                            });
                          }}
                        >
                          {t("conversion")}
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}
                  {editing.draft.legs.map((leg, legIndex) => (
                    <LegEditor
                      key={legIndex}
                      leg={leg}
                      t={t}
                      disabled={blocked || editing.draft.excluded}
                      onChange={(updated) =>
                        setEditing({
                          ...editing,
                          draft: {
                            ...editing.draft,
                            legs: editing.draft.legs.map((leg, i) =>
                              i === legIndex ? updated : leg,
                            ),
                          },
                        })
                      }
                    />
                  ))}
                </TabsContent>
                <TabsContent value="source">
                  <Table aria-label={t("source")}>
                    <TableBody>
                      {editing.draft.source.cells.map((cell, i) => (
                        <TableRow key={i}>
                          <TableHead>{HEADER[i]}</TableHead>
                          <TableCell className="whitespace-pre-wrap break-all">
                            <bdi>{cell || "—"}</bdi>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TabsContent>
              </Tabs>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditing(null)}>
                  {t("cancel")}
                </Button>
                {!result && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      updateDraft(editing.index, editing.draft);
                      setEditing(null);
                    }}
                  >
                    {t("save")}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          )}
        </Dialog>
      </Page>
    </div>
  );
}

function FundSelector({
  code,
  ctx,
  disabled,
  t,
  onBind,
}: {
  code: string;
  ctx: AddonContext;
  disabled: boolean;
  t: Translate;
  onBind: (binding: FundBinding) => void;
}) {
  const [query, setQuery] = useState(code),
    [results, setResults] = useState<SymbolSearchResult[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function search() {
    setBusy(true);
    setMessage("");
    setResults([]);
    try {
      const results = await ctx.api.market.searchTicker(query);
      setResults(results);
      if (!results.length) setMessage(t("noResults"));
    } catch {
      setMessage(t("unknown"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          aria-label={t("query")}
          value={query}
          disabled={disabled || busy}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={disabled || busy || !query.trim()}
          onClick={() => void search()}
        >
          <Icons.Search className="size-4" />
          {t("search")}
        </Button>
      </div>
      {message && (
        <Alert>
          <AlertDescription role="status">{message}</AlertDescription>
        </Alert>
      )}
      {!!results.length && (
        <Table aria-label={t("searchResults")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("code")}</TableHead>
              <TableHead>{t("fundName")}</TableHead>
              <TableHead>{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((item, i) => (
              <TableRow key={i}>
                <TableCell>
                  <bdi>{item.canonicalSymbol || item.symbol}</bdi>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <p>{item.longName || item.shortName}</p>
                  <p className="text-muted-foreground text-xs">
                    {item.exchangeName || item.exchange} · {item.providerId}
                  </p>
                  {requiresExistingAsset(item) && (
                    <p className="text-muted-foreground mt-2 text-xs">{t("createAsset")}</p>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled || busy || requiresExistingAsset(item)}
                    onClick={() => onBind(bindingFromSearch(item))}
                  >
                    {t("bind")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function LegEditor({
  leg,
  t,
  disabled,
  onChange,
}: {
  leg: DraftLeg;
  t: Translate;
  disabled: boolean;
  onChange: (leg: DraftLeg) => void;
}) {
  const { formatDecimal } = useNumberFormatting();
  let price = "";
  try {
    price = unitPrice(leg);
  } catch {
    /* Incomplete values remain editable. */
  }
  return (
    <Card className="gap-0">
      <CardHeader className="py-3">
        <CardTitle className="text-sm">{t(leg.activityType)}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 pb-4 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-sm">{t("type")}</span>
          <Select
            disabled={disabled}
            value={leg.activityType}
            items={(["BUY", "SELL", "DIVIDEND"] as const).map((value) => ({
              value,
              label: t(value),
            }))}
            onValueChange={(value) => {
              if (value) onChange({ ...leg, activityType: value as DraftLeg["activityType"] });
            }}
          >
            <SelectTrigger aria-label={t("type")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["BUY", "SELL", "DIVIDEND"] as const).map((value) => (
                <SelectItem key={value} value={value}>
                  {t(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {(["code", "date", "amount", "quantity", "fee"] as const).map((key) => (
          <label key={key} className="space-y-1">
            <span className="text-sm">{t(key)}</span>
            <Input
              disabled={disabled}
              type={key === "date" ? "date" : "text"}
              inputMode={key === "code" ? "numeric" : key === "date" ? undefined : "decimal"}
              value={leg[key]}
              onChange={(event) => onChange({ ...leg, [key]: event.target.value })}
            />
          </label>
        ))}
        <p className="text-muted-foreground text-xs sm:col-span-3">
          {t("price")}:{" "}
          <bdi>{price ? formatDecimal(price, { maximumFractionDigits: 12 }) : "—"}</bdi>
        </p>
      </CardContent>
    </Card>
  );
}
