import {
  ImportWizardLayout,
  FileDropzone,
  WizardStepIndicator,
  StepNavigation,
  CancelConfirmationDialog,
  ImportStatusCards,
  ImportChoice,
  ImportFilePreview,
  ImportMappingGroup,
  ImportReviewTable,
  ImportTypeBadge,
} from "@wealthfolio/import-wizard-ui";
import { useEffect, useRef, useState, useMemo } from "react";
import { type Account, type AddonContext } from "@wealthfolio/addon-sdk";
import {
  Alert,
  AlertDescription,
  AlertFeedback,
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
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  MoneyInput,
  QuantityInput,
  useNumberFormatting,
} from "@wealthfolio/ui";
import { compact, HEADER, parseStatement, StatementError } from "./statement";
import {
  confirmationDate,
  createDrafts,
  toImportRequest,
  unitPrice,
  type DraftLeg,
  type DraftRow,
} from "./import-model";
import { messages } from "./messages";
import { PdfPreview } from "./pdf-preview";

function errorMessage(cause: unknown) {
  if (!(cause instanceof StatementError)) return messages.unknown;
  const key =
    cause.code === "date" ? "dateError" : cause.code === "amount" ? "amountError" : cause.code;
  return messages[key] + (cause.location ? " (#" + cause.location + ")" : "");
}

function draftIssue(draft: DraftRow) {
  if (draft.excluded) return "";
  try {
    toImportRequest([draft], "preview", "preview");
    return "";
  } catch (cause) {
    if (cause instanceof StatementError) return errorMessage(cause);
    throw cause;
  }
}

export function AntFundImportPage({ ctx }: { ctx: AddonContext }) {
  const { formatDecimal } = useNumberFormatting();
  const [format, setFormat] = useState("");
  const [selectedSources, setSelectedSources] = useState<number[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [codeFilter, setCodeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const n = (value: number) => formatDecimal(value, { maximumFractionDigits: 0 });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [step, setStep] = useState("upload");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editing, setEditing] = useState<{ index: number; draft: DraftRow } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const blocked = busy;

  useEffect(() => {
    mounted.current = true;
    void ctx.api.accounts
      .getAll()
      .then((all) => {
        if (mounted.current)
          setAccounts(
            all.filter(
              (a) =>
                a.currency === "CNY" &&
                a.isActive &&
                !a.isArchived &&
                a.accountType === "SECURITIES" &&
                a.trackingMode === "TRANSACTIONS",
            ),
          );
      })
      .catch(() => {
        if (mounted.current) setError(messages.unknown);
      });
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [ctx]);

  useEffect(() => {
    void ctx.router.setLeaveGuard(drafts.length > 0);
  }, [ctx, drafts.length]);

  async function upload(selected: File | null) {
    if (!selected) {
      reset();
      return;
    }
    setFile(selected);
    setBusy(true);
    setError("");
    controller.current = new AbortController();
    try {
      if (format !== "ant-fund-pdf" || !selected.name.toLowerCase().endsWith(".pdf"))
        throw new StatementError("format");
      const rows = await parseStatement(
        new Uint8Array(await selected.arrayBuffer()),
        ctx.assets,
        (page, total) => {
          if (mounted.current) setProgress(n(page) + " / " + n(total));
        },
        controller.current.signal,
      );
      if (mounted.current) {
        setDrafts(createDrafts(rows));
        setSelectedSources([]);
        setStep("upload");
      }
    } catch (cause) {
      if (mounted.current && !controller.current?.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (mounted.current) {
        setBusy(false);
        setProgress("");
      }
      controller.current = null;
    }
  }

  function reset() {
    setSelectedSources([]);
    setTypeFilter("");
    setCodeFilter("");
    setStatusFilter("");
    setAccountFilter("");
    setDrafts([]);
    setFile(null);
    setError("");
    setStep("upload");
    setEditing(null);
  }
  function updateDraft(index: number, draft: DraftRow) {
    setDrafts((rows) => rows.map((row, i) => (i === index ? draft : row)));
  }
  async function handoff() {
    if (busy || !accountId || pendingDrafts.length) return;
    setBusy(true);
    setError("");
    try {
      await ctx.api.activities.openImport(
        toImportRequest(drafts, accountId, file?.name ?? messages.title),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const pendingDrafts = drafts.filter((draft) => draftIssue(draft));
  function skipSources(excluded: boolean) {
    setDrafts((current) =>
      current.map((draft) =>
        selectedSources.includes(draft.source.line) ? { ...draft, excluded } : draft,
      ),
    );
    setSelectedSources([]);
  }
  const gridRows = drafts
    .filter(
      (draft) =>
        (!typeFilter || draft.legs.some((leg) => leg.activityType === typeFilter)) &&
        (!codeFilter || draft.legs.some((leg) => leg.code === codeFilter)) &&
        (!accountFilter || accountId === accountFilter) &&
        (!statusFilter ||
          (draft.excluded ? "excluded" : draftIssue(draft) ? "pending" : "ready") === statusFilter),
    )
    .map((draft) => ({ ...draft, ...(draft.legs.length === 1 ? draft.legs[0] : {}), accountId }));

  const columns = useMemo(
    () => [
      {
        id: "source",
        header: messages.sourceRecord,
        accessorFn: (row: DraftRow) => row.source.line,
        size: 100,
        meta: { readOnly: true },
      },
      {
        id: "fund",
        header: messages.fundName,
        accessorFn: (row: DraftRow) => row.source.cells[3],
        size: 220,
        meta: { readOnly: true },
      },
      {
        id: "type",
        header: (): string => messages.type,
        accessorFn: (row: DraftRow) => row.source.cells[2],
        size: 160,
        meta: { readOnly: true, label: messages.type },
        cell: ({ row }: { row: { original: DraftRow } }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.legs.map((leg, index) => (
              <ImportTypeBadge key={index} type={leg.activityType}>
                {messages[leg.activityType]}
              </ImportTypeBadge>
            ))}
            {!row.original.legs.length && "待补齐"}
          </div>
        ),
      },
      ...(["activityType", "code", "date", "amount", "quantity", "fee"] as const).map((key) => ({
        id: key,
        accessorKey: key,
        header: key === "activityType" ? "记账性质" : messages[key],
        size: 170,
        meta: {
          readOnly: (draft: DraftRow) => draft.excluded || draft.legs.length !== 1,
          cell:
            key === "activityType"
              ? {
                  variant: "select" as const,
                  options: ["BUY", "SELL", "DIVIDEND"].map((value) => ({
                    value,
                    label: messages[value as DraftLeg["activityType"]],
                  })),
                  valueRenderer: (value: string) => (
                    <ImportTypeBadge type={value}>
                      {messages[value as DraftLeg["activityType"]]}
                    </ImportTypeBadge>
                  ),
                }
              : key === "date"
                ? { variant: "date-input" as const }
                : ["amount", "quantity", "fee"].includes(key)
                  ? { variant: "number" as const, valueType: "string" as const, min: 0 }
                  : { variant: "short-text" as const },
        },
      })),
      {
        id: "price",
        header: messages.price,
        size: 150,
        meta: { readOnly: true },
        accessorFn: (draft: DraftRow) =>
          draft.legs
            .map((leg) => {
              try {
                return unitPrice(leg);
              } catch (cause) {
                if (cause instanceof StatementError) return "—";
                throw cause;
              }
            })
            .join(" / "),
      },
      {
        id: "account",
        header: "目标账户",
        size: 180,
        meta: { readOnly: true },
        accessorFn: () =>
          accounts.find((account) => account.id === accountId)?.name ?? "请选择账户",
      },
      {
        id: "status",
        header: (): string => messages.status,
        meta: { readOnly: true, label: messages.status },
        cell: ({ row }: { row: { original: DraftRow } }) => (
          <Badge
            variant={
              row.original.excluded
                ? "outline"
                : !draftIssue(row.original)
                  ? "success-subtle"
                  : "warning-subtle"
            }
          >
            {
              messages[
                row.original.excluded
                  ? "excluded"
                  : !draftIssue(row.original)
                    ? "validRows"
                    : "pendingRows"
              ]
            }
          </Badge>
        ),
        size: 130,
      },
      {
        id: "actions",
        header: (): string => messages.actions,
        meta: { readOnly: true, label: messages.actions },
        cell: ({ row }: { row: { original: DraftRow } }) => (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              setEditing({
                index: drafts.findIndex((draft) => draft.source.line === row.original.source.line),
                draft: structuredClone(row.original),
              })
            }
          >
            {messages.edit}
          </Button>
        ),
        size: 100,
      },
    ],
    [busy, drafts, accounts, accountId],
  );

  return (
    <div className="ant-fund-import h-dvh min-h-0">
      <Page className="flex h-full min-h-0 flex-col">
        <PageHeader
          heading={messages.title}
          actions={
            <Button variant="ghost" disabled={busy || !file} onClick={() => setConfirmOpen(true)}>
              {messages.cancel}
            </Button>
          }
        />
        <PageContent
          withPadding={false}
          className="min-h-0 flex-1 md:min-h-0 [&>div]:h-full [&>div]:min-h-0"
        >
          <div className="h-full min-h-0 px-2 pt-2 pb-6 sm:px-4 sm:pt-4 md:px-6 md:pt-6">
            <ImportWizardLayout
              steps={
                <WizardStepIndicator
                  label={messages.importProgress}
                  steps={[
                    { id: "upload", label: "上传" },
                    { id: "mapping", label: "映射" },
                    { id: "prepare", label: "审核交易" },
                  ]}
                  currentStep={step}
                />
              }
              navigation={
                <StepNavigation
                  onBack={() => setStep(step === "prepare" ? "mapping" : "upload")}
                  onNext={() => {
                    if (step === "upload") setStep("mapping");
                    else if (step === "mapping") setStep("prepare");
                    else void handoff();
                  }}
                  canGoBack={step !== "upload" && !busy}
                  canGoNext={
                    !busy &&
                    drafts.length > 0 &&
                    (step === "upload" ||
                      (!!accountId &&
                        !pendingDrafts.length &&
                        drafts.some((draft) => !draft.excluded)))
                  }
                  isNextLoading={busy}
                  nextLabel={messages.nextStep}
                  nextLoadingLabel={messages.parsing}
                  backLabel={messages.previousStep}
                />
              }
            >
              {error && (
                <AlertFeedback variant="error" title={messages.failed}>
                  {error}
                </AlertFeedback>
              )}
              {step === "upload" ? (
                <div className="space-y-4">
                  <ImportChoice
                    label="流水格式"
                    value={format}
                    options={[{ value: "ant-fund-pdf", label: "蚂蚁基金交易明细 PDF" }]}
                    onChange={setFormat}
                    disabled={busy || !!file}
                  />
                  {format && (
                    <>
                      <FileDropzone
                        file={file}
                        onFileChange={(next) => {
                          if (file) setConfirmOpen(true);
                          else void upload(next);
                        }}
                        isLoading={busy}
                        accept=".pdf,application/pdf"
                        error={error}
                        labels={{
                          choose: messages.choosePdf,
                          remove: messages.cancel,
                          processing: progress || messages.parsing,
                          drop: messages.drop,
                          hint: messages.pdfHint,
                        }}
                      />
                      {file && drafts.length > 0 && (
                        <ImportFilePreview
                          headers={HEADER}
                          rows={drafts.map((draft) => draft.source.cells)}
                          original={<PdfPreview file={file} assets={ctx.assets} />}
                        />
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {step === "mapping" && (
                    <>
                      <ImportStatusCards
                        items={[
                          {
                            label: "账户映射",
                            value: accountId ? "1 / 1" : "0 / 1",
                            tone: accountId ? "success" : "error",
                            icon: <Icons.CheckCircle className="size-4" />,
                          },
                          {
                            label: "业务映射",
                            value: `${n(drafts.filter((draft) => !draft.excluded).length - pendingDrafts.length)} / ${n(drafts.filter((draft) => !draft.excluded).length)}`,
                            tone: pendingDrafts.length ? "warning" : "success",
                            icon: <Icons.CheckCircle className="size-4" />,
                          },
                        ]}
                      />
                      {(pendingDrafts.length > 0 || !accountId) && (
                        <AlertFeedback variant="warning" title="请补齐映射">
                          请选择目标账户，并修正或跳过需要补齐的记录。
                        </AlertFeedback>
                      )}
                      <ImportMappingGroup
                        pending={!accountId}
                        title={accountId ? "已映射账户" : "需要补齐 · 目标账户"}
                      >
                        <label className="block space-y-2">
                          <span>{messages.account}</span>
                          <Select
                            value={accountId}
                            onValueChange={(id) => setAccountId(id ?? "")}
                            disabled={busy}
                            items={accounts.map((a) => ({ value: a.id, label: a.name }))}
                          >
                            <SelectTrigger aria-label={messages.account}>
                              <SelectValue placeholder={messages.select} />
                            </SelectTrigger>
                            <SelectContent>
                              {accounts.map((a) => (
                                <SelectItem key={a.id} value={a.id}>
                                  {a.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                      </ImportMappingGroup>
                      {selectedSources.length > 0 && (
                        <div
                          role="toolbar"
                          aria-label="映射批量操作"
                          className="bg-muted flex gap-2 rounded-lg border p-3"
                        >
                          <Button variant="outline" onClick={() => skipSources(true)}>
                            跳过
                          </Button>
                          <Button variant="outline" onClick={() => skipSources(false)}>
                            取消跳过
                          </Button>
                          <Button variant="ghost" onClick={() => setSelectedSources([])}>
                            清除选择
                          </Button>
                        </div>
                      )}
                      {(pendingDrafts.length ? [true, false] : [false]).map((pending) => (
                        <ImportMappingGroup
                          key={String(pending)}
                          pending={pending}
                          title={
                            pending ? `需要补齐 · ${n(pendingDrafts.length)} 笔` : "已识别 / 已跳过"
                          }
                        >
                          {drafts
                            .filter((draft) => Boolean(draftIssue(draft)) === pending)
                            .map((draft) => (
                              <div
                                key={draft.source.line}
                                className="flex flex-wrap items-center gap-3 rounded-md border p-3"
                              >
                                <Checkbox
                                  aria-label={`选择来源 ${draft.source.line}`}
                                  checked={selectedSources.includes(draft.source.line)}
                                  onCheckedChange={(checked) =>
                                    setSelectedSources((current) =>
                                      checked
                                        ? [...current, draft.source.line]
                                        : current.filter((line) => line !== draft.source.line),
                                    )
                                  }
                                />
                                <span>
                                  #{n(draft.source.line)} · {draft.source.cells[3]} ·{" "}
                                  {draft.source.cells[2]}
                                </span>
                                <span className="text-warning-subtle-foreground">
                                  {draft.excluded ? "已跳过" : draftIssue(draft)}
                                </span>
                                <Button
                                  variant="outline"
                                  onClick={() =>
                                    setEditing({
                                      index: drafts.indexOf(draft),
                                      draft: structuredClone(draft),
                                    })
                                  }
                                >
                                  编辑
                                </Button>
                              </div>
                            ))}
                        </ImportMappingGroup>
                      ))}
                      <details className="rounded-lg border p-3">
                        <summary>固定字段映射</summary>
                        <p className="mt-2 text-sm">
                          基金代码 → 证券代码；确认日期 → 日期；交易类型 →
                          买入、卖出或红利再投资；确认金额、确认份额与手续费 →
                          金额、数量与计算单价。
                        </p>
                      </details>
                    </>
                  )}
                  {step === "prepare" && (
                    <>
                      <AlertFeedback
                        variant={pendingDrafts.length ? "warning" : "success"}
                        title={
                          pendingDrafts.length ? messages.review : "流水已准备好，继续审核资产"
                        }
                      >
                        {messages.handoffHint}
                      </AlertFeedback>
                      <ImportStatusCards
                        items={[
                          {
                            label: messages.validRows,
                            value: n(
                              drafts.filter((draft) => !draft.excluded && !draftIssue(draft))
                                .length,
                            ),
                            tone: "success",
                            icon: <Icons.CheckCircle className="size-4" />,
                          },
                          {
                            label: messages.pendingRows,
                            value: n(pendingDrafts.length),
                            tone: "warning",
                            icon: <Icons.AlertCircle className="size-4" />,
                          },
                          {
                            label: messages.excluded,
                            value: n(drafts.filter((draft) => draft.excluded).length),
                            tone: "muted",
                            icon: <Icons.MinusCircle className="size-4" />,
                          },
                        ]}
                      />
                      <ImportReviewTable
                        data={gridRows}
                        columns={columns}
                        getRowId={(draft) => String(draft.source.line)}
                        busy={busy}
                        onSkip={(selected) =>
                          setDrafts((current) =>
                            current.map((draft) =>
                              selected.some((row) => row.source.line === draft.source.line)
                                ? { ...draft, excluded: true }
                                : draft,
                            ),
                          )
                        }
                        onRestore={(selected) =>
                          setDrafts((current) =>
                            current.map((draft) =>
                              selected.some((row) => row.source.line === draft.source.line)
                                ? { ...draft, excluded: false }
                                : draft,
                            ),
                          )
                        }
                        filters={
                          <>
                            <ImportChoice
                              label="筛选类型"
                              value={typeFilter}
                              options={["BUY", "SELL", "DIVIDEND"].map((value) => ({
                                value,
                                label: messages[value as DraftLeg["activityType"]],
                              }))}
                              onChange={setTypeFilter}
                            />
                            <ImportChoice
                              label="筛选基金代码"
                              value={codeFilter}
                              options={[
                                ...new Set(
                                  drafts.flatMap((draft) => draft.legs.map((leg) => leg.code)),
                                ),
                              ]
                                .filter(Boolean)
                                .map((value) => ({ value, label: value }))}
                              onChange={setCodeFilter}
                            />
                            <ImportChoice
                              label="筛选账户"
                              value={accountFilter}
                              options={accounts.map((account) => ({
                                value: account.id,
                                label: account.name,
                              }))}
                              onChange={setAccountFilter}
                            />
                            <ImportChoice
                              label="筛选状态"
                              value={statusFilter}
                              options={[
                                { value: "pending", label: "待补齐" },
                                { value: "ready", label: "可校验" },
                                { value: "excluded", label: "已跳过" },
                              ]}
                              onChange={setStatusFilter}
                            />
                          </>
                        }
                        onDataChange={(next) =>
                          setDrafts((current) =>
                            current.map((draft) => {
                              const changed = next.find(
                                (row) => row.source.line === draft.source.line,
                              );
                              if (!changed || draft.excluded || draft.legs.length !== 1)
                                return draft;
                              const leg = { ...draft.legs[0] };
                              for (const key of [
                                "activityType",
                                "code",
                                "date",
                                "amount",
                                "quantity",
                                "fee",
                              ] as const)
                                if (changed[key] !== undefined)
                                  Object.assign(leg, { [key]: changed[key] });
                              return { ...draft, legs: [leg] };
                            }),
                          )
                        }
                      />
                    </>
                  )}
                </div>
              )}
            </ImportWizardLayout>
          </div>
        </PageContent>
        <CancelConfirmationDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          onConfirm={reset}
          title={messages.cancelTitle}
          description={messages.cancelDescription}
          continueLabel={messages.continue}
          cancelLabel={messages.cancel}
        />
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
                  {messages.edit} · {messages.sourceRecord} #{n(editing.draft.source.line)}
                </DialogTitle>
                <DialogDescription>
                  {compact(editing.draft.source.cells[3])} · {messages.pages}:{" "}
                  {editing.draft.source.pages.map(n).join(", ")}
                </DialogDescription>
              </DialogHeader>
              <Tabs defaultValue={"edit"}>
                <TabsList>
                  <TabsTrigger value="edit">{messages.edit}</TabsTrigger>
                  <TabsTrigger value="source">{messages.source}</TabsTrigger>
                </TabsList>
                <TabsContent value="edit" className="space-y-4">
                  {!editing.draft.legs.length && (
                    <Alert>
                      <AlertDescription className="space-y-3">
                        <p>{messages.conversionHint}</p>
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
                          {messages.conversion}
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}
                  {editing.draft.legs.map((leg, legIndex) => (
                    <LegEditor
                      key={legIndex}
                      leg={leg}
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
                  <Table aria-label={messages.source}>
                    <TableBody>
                      {editing.draft.source.cells.map((cell, i) => (
                        <TableRow key={i}>
                          <TableHead>{HEADER[i]}</TableHead>
                          <TableCell className="break-all whitespace-pre-wrap">
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
                  {messages.cancel}
                </Button>
                {
                  <Button
                    disabled={busy}
                    onClick={() => {
                      updateDraft(editing.index, editing.draft);
                      setEditing(null);
                    }}
                  >
                    {messages.save}
                  </Button>
                }
              </DialogFooter>
            </DialogContent>
          )}
        </Dialog>
      </Page>
    </div>
  );
}

function LegEditor({
  leg,
  disabled,
  onChange,
}: {
  leg: DraftLeg;
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
        <CardTitle className="text-sm">{messages[leg.activityType]}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 pb-4 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-sm">{messages.type}</span>
          <Select
            disabled={disabled}
            value={leg.activityType}
            items={(["BUY", "SELL", "DIVIDEND"] as const).map((value) => ({
              value,
              label: messages[value],
            }))}
            onValueChange={(value) => {
              if (value) onChange({ ...leg, activityType: value as DraftLeg["activityType"] });
            }}
          >
            <SelectTrigger aria-label={messages.type}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["BUY", "SELL", "DIVIDEND"] as const).map((value) => (
                <SelectItem key={value} value={value}>
                  {messages[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {(["code", "date", "amount", "quantity", "fee"] as const).map((key) => (
          <label key={key} className="space-y-1">
            <span className="text-sm">{messages[key]}</span>
            {key === "amount" || key === "fee" ? (
              <MoneyInput
                disabled={disabled}
                value={leg[key]}
                onValueStringChange={(value) => onChange({ ...leg, [key]: value })}
              />
            ) : key === "quantity" ? (
              <QuantityInput
                disabled={disabled}
                value={leg.quantity}
                onValueStringChange={(quantity) => onChange({ ...leg, quantity })}
              />
            ) : (
              <Input
                disabled={disabled}
                type={key === "date" ? "date" : "text"}
                value={leg[key]}
                onChange={(event) => onChange({ ...leg, [key]: event.target.value })}
              />
            )}
          </label>
        ))}
        <p className="text-muted-foreground text-xs sm:col-span-3">
          {messages.price}:{" "}
          <bdi>{price ? formatDecimal(price, { maximumFractionDigits: 12 }) : "—"}</bdi>
        </p>
      </CardContent>
    </Card>
  );
}
