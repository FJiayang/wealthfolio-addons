import { useEffect, useRef, useState } from "react";
import type {
  Account,
  ActivityImport,
  AddonContext,
  ImportActivitiesResult,
  SymbolSearchResult,
} from "@wealthfolio/addon-sdk";
import {
  Button,
  Input,
  Label,
  Page,
  PageHeader,
  PageContent,
  Checkbox,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  useLocalizationSettings,
  useNumberFormatting,
  useAmountFormatting,
  useDateFormatting,
} from "@wealthfolio/ui";
import { parseStatement, StatementError, HEADER, compact } from "./statement";
import {
  createDrafts,
  toActivities,
  unitPrice,
  bindingFromSearch,
  requiresExistingAsset,
  sourceRowNumber,
  confirmationDate,
  hasErrors,
  isDuplicate,
  rowsToImport,
  reconcileResult,
  type DraftRow,
  type DraftLeg,
  type FundBinding,
} from "./import-model";
import { en, zh, type MessageKey } from "./messages";

export function AntFundImportPage({ ctx }: { ctx: AddonContext }) {
  const { uiLocale } = useLocalizationSettings();
  const messages = uiLocale.startsWith("zh") ? zh : en;
  const t = (key: MessageKey) => messages[key];
  const { formatDecimal } = useNumberFormatting();
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
  const [page, setPage] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

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
    setBusy(true);
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
      if (mounted.current) setDrafts(createDrafts(rows));
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
      if (mounted.current) setResult(result);
    } catch (error) {
      if (mounted.current) {
        setChecked([]);
        setError(error instanceof StatementError ? errorMessage(error) : t("uncertain"));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const funds = new Map<string, string>();
  for (const draft of drafts)
    if (!draft.excluded) {
      if (!draft.legs.length)
        funds.set(compact(draft.source.cells[5]), compact(draft.source.cells[3]));
      for (const leg of draft.legs) if (leg.code) funds.set(leg.code, leg.name);
    }
  const pending = drafts.filter((draft) => {
    if (draft.excluded) return false;
    try {
      toActivities([draft], bindings, accountId);
      return false;
    } catch {
      return true;
    }
  }).length;
  function draftError(draft: DraftRow) {
    if (draft.excluded) return "";
    try {
      toActivities([draft], bindings, accountId);
      return "";
    } catch (error) {
      return errorMessage(error);
    }
  }
  const failures = result ? reconcileResult(checked, result) : [];
  const blocked = busy || !!result;
  const totalPages = Math.max(1, Math.ceil(drafts.length / 20));

  return (
    <Page className="ant-fund-import">
      <PageHeader heading={t("title")} text={t("description")} />
      <PageContent>
        <p className="text-muted-foreground text-sm">{t("cashHint")}</p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <fieldset disabled={blocked} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ant-account">{t("account")}</Label>
            <Select
              items={accounts.map((account) => ({ value: account.id, label: account.name }))}
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
          <div className="space-y-2">
            <Label htmlFor="ant-pdf">{t("upload")}</Label>
            <Input
              id="ant-pdf"
              type="file"
              accept=".pdf,application/pdf"
              onChange={(event) => {
                void upload(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
        </fieldset>
        {progress && (
          <div role="status">
            {t("parsing")}: <bdi>{progress}</bdi>{" "}
            <Button variant="outline" onClick={() => controller.current?.abort()}>
              {t("cancel")}
            </Button>
          </div>
        )}
        {!!drafts.length && (
          <>
            <p role="status">
              {t("records")}: {n(drafts.length)} · {t("pendingRows")}: {n(pending)} ·{" "}
              {t("validRows")}: {n(drafts.filter((draft) => !draft.excluded).length - pending)} ·{" "}
              {t("excluded")}: {n(drafts.filter((draft) => draft.excluded).length)}
            </p>
            <details>
              <summary className="font-medium">
                {t("funds")} ({n(funds.size)})
              </summary>
              <p className="text-muted-foreground text-sm">{t("fundHint")}</p>
              <div className="space-y-3">
                {[...funds].map(([code, name]) => (
                  <FundSelector
                    key={code}
                    code={code}
                    name={name}
                    ctx={ctx}
                    binding={bindings[code]}
                    disabled={blocked}
                    t={t}
                    onBind={(binding) => {
                      invalidate();
                      setBindings((all) => ({ ...all, [code]: binding }));
                    }}
                  />
                ))}
              </div>
            </details>
            <section className="space-y-3">
              <h2 className="text-xl font-medium">{t("review")}</h2>
              <p className="text-muted-foreground text-sm">{t("pendingHint")}</p>
              {drafts.slice(page * 20, page * 20 + 20).map((draft, offset) => {
                const index = page * 20 + offset;
                return (
                  <details
                    key={draft.source.line}
                    className="rounded-md border p-3"
                    open={draft.legs.length === 0 && !draft.excluded}
                  >
                    <summary>
                      <bdi>
                        #{draft.source.line} · {compact(draft.source.cells[5])}
                      </bdi>{" "}
                      {compact(draft.source.cells[3])} · {compact(draft.source.cells[2])}{" "}
                      {draft.excluded
                        ? `· ${t("excluded")}`
                        : draftError(draft)
                          ? `· ${t("pendingRows")}`
                          : ""}
                    </summary>
                    {draftError(draft) && (
                      <p className="text-destructive text-sm">{draftError(draft)}</p>
                    )}
                    <fieldset disabled={blocked} className="space-y-4">
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={draft.excluded}
                          disabled={blocked}
                          onCheckedChange={(excluded) => updateDraft(index, { ...draft, excluded })}
                        />
                        {t("exclude")}
                      </label>
                      {!draft.legs.length && (
                        <div>
                          <p>{t("conversionHint")}</p>
                          <Button
                            variant="outline"
                            onClick={() =>
                              updateDraft(index, {
                                ...draft,
                                legs: [
                                  {
                                    activityType: "SELL",
                                    code: "",
                                    name: "",
                                    date: confirmationDate(draft.source.cells[11]),
                                    amount: "",
                                    quantity: compact(draft.source.cells[7]),
                                    fee: "0",
                                  },
                                  {
                                    activityType: "BUY",
                                    code: compact(draft.source.cells[5]),
                                    name: compact(draft.source.cells[3]),
                                    date: confirmationDate(draft.source.cells[11]),
                                    amount: compact(draft.source.cells[8]),
                                    quantity: compact(draft.source.cells[9]),
                                    fee: compact(draft.source.cells[10]),
                                  },
                                ],
                              })
                            }
                          >
                            {t("conversion")}
                          </Button>
                        </div>
                      )}
                      {draft.legs.map((leg, legIndex) => (
                        <LegEditor
                          key={legIndex}
                          leg={leg}
                          t={t}
                          disabled={draft.excluded}
                          onChange={(updated) =>
                            updateDraft(index, {
                              ...draft,
                              legs: draft.legs.map((item, i) => (i === legIndex ? updated : item)),
                            })
                          }
                        />
                      ))}
                    </fieldset>
                    <details>
                      <summary>
                        {t("source")} · {t("pages")}: {draft.source.pages.map(n).join(", ")}
                      </summary>
                      <dl className="grid gap-1 text-sm">
                        {draft.source.cells.map((cell, i) => (
                          <div key={i}>
                            <dt className="inline font-medium">{HEADER[i]}: </dt>
                            <dd className="inline">
                              <bdi>{cell}</bdi>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </details>
                );
              })}
              <div className="flex items-center gap-3">
                <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  {t("previous")}
                </Button>
                <bdi>
                  {n(page + 1)} / {n(totalPages)}
                </bdi>
                <Button
                  variant="outline"
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  {t("next")}
                </Button>
              </div>
            </section>
            <Button disabled={blocked || pending > 0} onClick={() => void validate()}>
              {t("validate")}
            </Button>
          </>
        )}
        {!!checked.length && (
          <section className="space-y-3">
            <h2 className="text-xl font-medium">{t("checked")}</h2>
            <p>
              {t("rows")}: {n(checked.length)} · {t("duplicates")}:{" "}
              {n(checked.filter(isDuplicate).length)} · {t("failed")}:{" "}
              {n(checked.filter(hasErrors).length)}
            </p>
            {checked.map((row, index) => (
              <details
                key={row.lineNumber}
                className="rounded-md border p-2"
                open={hasErrors(row) || isDuplicate(row)}
              >
                <summary>
                  <bdi>
                    {sourceLabel(row.lineNumber)} · {row.symbol} · {formatAmount(row.amount, "CNY")}{" "}
                    · {formatCalendarDate(String(row.date).slice(0, 10))}
                  </bdi>{" "}
                  · {t(row.activityType as DraftLeg["activityType"])}
                </summary>
                <pre className="text-sm">
                  {Object.values(row.errors ?? {})
                    .flat()
                    .concat(warningMessages(row))
                    .join("\n")}
                </pre>
                {isDuplicate(row) && (
                  <label className="flex items-center gap-2">
                    <Checkbox
                      disabled={blocked || hasErrors(row)}
                      checked={row.forceImport ?? false}
                      onCheckedChange={(forceImport) =>
                        setChecked((all) =>
                          all.map((item, i) => (i === index ? { ...item, forceImport } : item)),
                        )
                      }
                    />
                    {t("force")}
                  </label>
                )}
              </details>
            ))}
            <Button
              disabled={
                blocked ||
                checked.some(hasErrors) ||
                !checked.some((row) => !isDuplicate(row) || row.forceImport)
              }
              onClick={() => void commit()}
            >
              {t("import")}
            </Button>
          </section>
        )}
        {result && (
          <section role="status" className="space-y-3">
            <h2 className="text-xl font-medium">{t("done")}</h2>
            <p>
              {t("imported")}: {n(result.summary.imported)} · {t("skipped")}:{" "}
              {n(result.summary.skipped + previewSkipped)} · {t("duplicates")}:{" "}
              {n(result.summary.duplicates + previewSkipped)} · {t("failed")}: {n(failures.length)}
            </p>
            <p>
              {t("run")}: <bdi>{result.importRunId}</bdi>
            </p>
            {failures.map((row) => (
              <pre key={row.lineNumber}>
                {sourceLabel(row.lineNumber)} · {t(row.activityType as DraftLeg["activityType"])}:{" "}
                {Object.values(row.errors ?? {})
                  .flat()
                  .join("\n")}
              </pre>
            ))}
            {result.activities
              .filter((row) => warningMessages(row).length)
              .map((row) => (
                <pre key={`warning-${row.lineNumber}`}>
                  {sourceLabel(row.lineNumber)} · {t(row.activityType as DraftLeg["activityType"])}{" "}
                  · {t("warnings")}: {warningMessages(row).join("\n")}
                </pre>
              ))}
            {!!failures.length && (
              <Button disabled={busy} onClick={() => void validate(failures)}>
                {t("failedOnly")}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setDrafts([]);
                setBindings({});
                setChecked([]);
                setResult(null);
                setError("");
              }}
            >
              {t("newSession")}
            </Button>
          </section>
        )}
      </PageContent>
    </Page>
  );
}

function FundSelector({
  code,
  name,
  binding,
  ctx,
  disabled,
  t,
  onBind,
}: {
  code: string;
  name: string;
  binding?: FundBinding;
  ctx: AddonContext;
  disabled: boolean;
  t: (key: MessageKey) => string;
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
    <fieldset disabled={disabled || busy} className="space-y-2 rounded-md border p-3">
      <legend>
        <bdi>{code}</bdi> {name} ·{" "}
        {binding ? `${t("bound")}: ${binding.symbolName ?? binding.symbol}` : t("unbound")}
      </legend>
      <div className="flex gap-2">
        <Input
          aria-label={`${t("query")} ${code}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button variant="outline" disabled={!query.trim()} onClick={() => void search()}>
          {t("search")}
        </Button>
      </div>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {results.map((item, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
          <bdi>
            {item.symbol} · {item.longName || item.shortName} · {item.exchangeName || item.exchange}{" "}
            · {item.providerId}
          </bdi>
          {requiresExistingAsset(item) && (
            <p className="text-muted-foreground basis-full">{t("createAsset")}</p>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={requiresExistingAsset(item)}
            onClick={() => onBind(bindingFromSearch(item))}
          >
            {t("bind")}
          </Button>
        </div>
      ))}
    </fieldset>
  );
}

function LegEditor({
  leg,
  t,
  disabled,
  onChange,
}: {
  leg: DraftLeg;
  t: (key: MessageKey) => string;
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
    <fieldset disabled={disabled} className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
      <label className="space-y-1">
        <span className="text-sm">{t("type")}</span>
        <Select
          items={(["BUY", "SELL", "DIVIDEND"] as const).map((type) => ({
            value: type,
            label: t(type),
          }))}
          value={leg.activityType}
          onValueChange={(value) => {
            if (value) onChange({ ...leg, activityType: value as DraftLeg["activityType"] });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["BUY", "SELL", "DIVIDEND"] as const).map((type) => (
              <SelectItem key={type} value={type}>
                {t(type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {(["code", "date", "amount", "quantity", "fee"] as const).map((key) => (
        <label key={key} className="space-y-1">
          <span className="text-sm">{t(key)}</span>
          <Input
            type={key === "date" ? "date" : "text"}
            inputMode={key === "code" ? "numeric" : key === "date" ? undefined : "decimal"}
            value={leg[key]}
            onChange={(event) => onChange({ ...leg, [key]: event.target.value })}
          />
        </label>
      ))}
      <p className="text-muted-foreground text-sm">
        {t("price")}: <bdi>{price ? formatDecimal(price, { maximumFractionDigits: 12 }) : "—"}</bdi>
      </p>
    </fieldset>
  );
}
