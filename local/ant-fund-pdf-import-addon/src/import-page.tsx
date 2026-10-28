import {
  ImportWizardLayout,
  FileDropzone,
  WizardStepIndicator,
  StepNavigation,
  CancelConfirmationDialog,
  ImportStatusCards,
} from "@wealthfolio/import-wizard-ui";
import { useEffect, useRef, useState, useMemo, type CSSProperties } from "react";
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
  DataGrid,
  useDataGrid,
  useDirection,
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

export function AntFundImportPage({ ctx }: { ctx: AddonContext }) {
  const { formatDecimal } = useNumberFormatting();
  const dir = useDirection();
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

  function errorMessage(cause: unknown) {
    if (!(cause instanceof StatementError)) return messages.unknown;
    const key =
      cause.code === "date" ? "dateError" : cause.code === "amount" ? "amountError" : cause.code;
    return messages[key] + (cause.location ? " (#" + cause.location + ")" : "");
  }

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
        setStep("prepare");
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
    if (busy) return;
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

  const columns = useMemo(
    () => [
      {
        id: "source",
        header: messages.sourceRecord,
        accessorFn: (row: DraftRow) => row.source.line,
        size: 100,
      },
      {
        id: "fund",
        header: messages.fundName,
        accessorFn: (row: DraftRow) => row.source.cells[3],
        size: 220,
      },
      {
        id: "type",
        header: messages.type,
        accessorFn: (row: DraftRow) => row.source.cells[2],
        size: 160,
      },
      {
        id: "status",
        header: () => messages.status,
        cell: ({ row }: { row: { original: DraftRow } }) => (
          <Badge
            variant={
              row.original.excluded
                ? "outline"
                : row.original.legs.length
                  ? "success-subtle"
                  : "warning-subtle"
            }
          >
            {
              messages[
                row.original.excluded
                  ? "excluded"
                  : row.original.legs.length
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
        header: () => messages.actions,
        cell: ({ row }: { row: { original: DraftRow } }) => (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              setEditing({
                index: drafts.indexOf(row.original),
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
    [busy, drafts],
  );
  const grid = useDataGrid({
    data: drafts,
    rowHeight: "medium",
    columns,
    getRowId: (row) => String(row.source.line),
    readOnly: true,
    enableRowSelection: false,
    enableSearch: false,
    enablePaste: false,
    dir,
  });

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
                    { id: "upload", label: messages.upload },
                    { id: "prepare", label: messages.review },
                  ]}
                  currentStep={step}
                />
              }
              navigation={
                <StepNavigation
                  onBack={() => setStep("upload")}
                  onNext={() => {
                    if (step === "upload") setStep("prepare");
                    else void handoff();
                  }}
                  canGoBack={step !== "upload" && !busy}
                  canGoNext={!busy && drafts.length > 0 && (step === "upload" || !!accountId)}
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
              ) : (
                <div className="space-y-4">
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
                  <AlertFeedback variant="warning" title={messages.review}>
                    {messages.handoffHint}
                  </AlertFeedback>
                  <ImportStatusCards
                    items={[
                      {
                        label: messages.validRows,
                        value: n(
                          drafts.filter((draft) => !draft.excluded && draft.legs.length > 0).length,
                        ),
                        tone: "success",
                        icon: <Icons.CheckCircle className="size-4" />,
                      },
                      {
                        label: messages.pendingRows,
                        value: n(
                          drafts.filter((draft) => !draft.excluded && draft.legs.length === 0)
                            .length,
                        ),
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
                  <DataGrid
                    {...grid}
                    dir={dir}
                    height={420}
                    className="import-wizard-grid"
                    style={
                      {
                        "--import-wizard-grid-width": `${grid.table.getTotalSize()}px`,
                      } as CSSProperties
                    }
                  />
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
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={editing.draft.excluded}
                      disabled={blocked}
                      onCheckedChange={(excluded) =>
                        setEditing({ ...editing, draft: { ...editing.draft, excluded } })
                      }
                    />
                    {messages.exclude}
                  </label>
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
