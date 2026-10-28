import { useEffect, useRef, useState, useMemo } from "react";
import { useAddonTranslation, type Account, type AddonContext } from "@wealthfolio/addon-sdk";
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
  FileDropzone,
  ImportWizardLayout,
  StepNavigation,
  WizardStepIndicator,
  CancelConfirmationDialog,
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
import type { MessageKey } from "./messages";

type Translate = (key: MessageKey) => string;

export function AntFundImportPage({ ctx }: { ctx: AddonContext }) {
  const { t: translate } = useAddonTranslation();
  const t: Translate = (key) => translate(key);
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
        if (mounted.current) setError(t("unknown"));
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
    if (!(cause instanceof StatementError)) return t("unknown");
    const key =
      cause.code === "date" ? "dateError" : cause.code === "amount" ? "amountError" : cause.code;
    return t(key) + (cause.location ? " (#" + cause.location + ")" : "");
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
        toImportRequest(drafts, accountId, file?.name ?? t("title")),
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
        header: t("sourceRecord"),
        accessorFn: (row: DraftRow) => row.source.line,
        size: 100,
      },
      {
        id: "fund",
        header: t("fundName"),
        accessorFn: (row: DraftRow) => row.source.cells[3],
        size: 220,
      },
      {
        id: "type",
        header: t("type"),
        accessorFn: (row: DraftRow) => row.source.cells[2],
        size: 160,
      },
      {
        id: "status",
        header: () => t("status"),
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
            {t(
              row.original.excluded
                ? "excluded"
                : row.original.legs.length
                  ? "validRows"
                  : "pendingRows",
            )}
          </Badge>
        ),
        size: 130,
      },
      {
        id: "actions",
        header: () => t("actions"),
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
            {t("edit")}
          </Button>
        ),
        size: 100,
      },
    ],
    [translate, busy, drafts],
  );
  const grid = useDataGrid({
    data: drafts,
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
          heading={t("title")}
          actions={
            <Button variant="ghost" disabled={busy || !file} onClick={() => setConfirmOpen(true)}>
              {t("cancel")}
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
                  label={t("importProgress")}
                  steps={[
                    { id: "upload", label: t("upload") },
                    { id: "prepare", label: t("review") },
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
                  nextLabel={t("nextStep")}
                  nextLoadingLabel={t("parsing")}
                  backLabel={t("previousStep")}
                />
              }
            >
              {error && (
                <AlertFeedback variant="error" title={t("failed")}>
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
                    choose: t("choosePdf"),
                    remove: t("cancel"),
                    processing: progress || t("parsing"),
                    drop: t("drop"),
                    hint: t("pdfHint"),
                  }}
                />
              ) : (
                <div className="space-y-4">
                  <label className="block space-y-2">
                    <span>{t("account")}</span>
                    <Select
                      value={accountId}
                      onValueChange={(id) => setAccountId(id ?? "")}
                      disabled={busy}
                      items={accounts.map((a) => ({ value: a.id, label: a.name }))}
                    >
                      <SelectTrigger aria-label={t("account")}>
                        <SelectValue placeholder={t("select")} />
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
                  <AlertFeedback variant="warning" title={t("review")}>
                    {t("handoffHint")}
                  </AlertFeedback>
                  <DataGrid {...grid} dir={dir} height={420} />
                </div>
              )}
            </ImportWizardLayout>
          </div>
        </PageContent>
        <CancelConfirmationDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          onConfirm={reset}
          title={t("cancelTitle")}
          description={t("cancelDescription")}
          continueLabel={t("continue")}
          cancelLabel={t("cancel")}
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
                  {t("edit")} · {t("sourceRecord")} #{n(editing.draft.source.line)}
                </DialogTitle>
                <DialogDescription>
                  {compact(editing.draft.source.cells[3])} · {t("pages")}:{" "}
                  {editing.draft.source.pages.map(n).join(", ")}
                </DialogDescription>
              </DialogHeader>
              <Tabs defaultValue={"edit"}>
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
                  {t("cancel")}
                </Button>
                {
                  <Button
                    disabled={busy}
                    onClick={() => {
                      updateDraft(editing.index, editing.draft);
                      setEditing(null);
                    }}
                  >
                    {t("save")}
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
          {t("price")}:{" "}
          <bdi>{price ? formatDecimal(price, { maximumFractionDigits: 12 }) : "—"}</bdi>
        </p>
      </CardContent>
    </Card>
  );
}
