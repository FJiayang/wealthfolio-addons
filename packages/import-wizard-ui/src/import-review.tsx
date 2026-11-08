import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getPaginationRowModel } from "@tanstack/table-core";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Checkbox,
  DataGrid,
  DataGridColumnHeader,
  Icons,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useDataGrid,
  useDirection,
  useNumberFormatting,
} from "@wealthfolio/ui";

export function ImportChoice({
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
    <div className="min-w-40 flex-1">
      <Select
        value={value || "__none__"}
        disabled={disabled}
        items={[{ value: "__none__", label: "请选择" }, ...options]}
        onValueChange={(next) => onChange(next === "__none__" ? "" : (next ?? ""))}
      >
        <SelectTrigger aria-label={label} className="w-full min-w-0">
          <SelectValue placeholder={label}>
            {options.find((option) => option.value === value)?.label ?? label}
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
    </div>
  );
}

export function ImportFilePreview({
  headers,
  rows,
  original,
}: {
  headers: readonly string[];
  rows: readonly (readonly string[])[];
  original: ReactNode;
}) {
  const { formatDecimal } = useNumberFormatting();
  return (
    <Tabs defaultValue="parsed" className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <span>文件预览 · {formatDecimal(rows.length, { maximumFractionDigits: 0 })} 行</span>
        <TabsList>
          <TabsTrigger value="parsed">已解析</TabsTrigger>
          <TabsTrigger value="original">原始文件</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="parsed" className="max-h-96 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              {headers.map((header) => (
                <TableHead key={header}>{header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={index}>
                <TableCell>{formatDecimal(index + 1, { maximumFractionDigits: 0 })}</TableCell>
                {row.map((cell, column) => (
                  <TableCell key={column} className="max-w-80 truncate" title={cell}>
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TabsContent>
      <TabsContent value="original" className="max-h-[36rem] overflow-auto p-3">
        {original}
      </TabsContent>
    </Tabs>
  );
}

export function ImportMappingGroup({
  title,
  pending = false,
  children,
}: {
  title: string;
  pending?: boolean;
  children: ReactNode;
}) {
  return (
    <Accordion
      keepMounted
      defaultValue={pending ? ["mapping"] : []}
      className={`rounded-lg border ${pending ? "border-warning-subtle-border bg-warning-subtle" : "bg-muted/20"}`}
    >
      <AccordionItem value="mapping" className="border-0">
        <AccordionTrigger className="p-4 hover:no-underline">{title}</AccordionTrigger>
        <AccordionContent className="space-y-4 border-t p-4">{children}</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function ImportTypeBadge({ type, children }: { type: string; children: ReactNode }) {
  const variant = ["BUY", "DEPOSIT", "TRANSFER_IN"].includes(type)
    ? "success"
    : ["SELL", "WITHDRAWAL", "TRANSFER_OUT", "FEE", "TAX"].includes(type)
      ? "destructive"
      : ["DIVIDEND", "INTEREST"].includes(type)
        ? "info"
        : "default";
  return (
    <Badge variant={variant} className="rounded-sm">
      {children}
    </Badge>
  );
}

export function ImportReviewTable<T>({
  data,
  columns,
  getRowId,
  busy,
  onSkip,
  onRestore,
  onReview,
  canReview,
  canSelect,
  filters,
  onDataChange,
  getCellState,
  pageSize,
}: {
  data: T[];
  columns: Parameters<typeof useDataGrid<T>>[0]["columns"];
  getRowId(row: T): string;
  busy?: boolean;
  onSkip(rows: T[]): void;
  onRestore(rows: T[]): void;
  onReview?(rows: T[]): void;
  canReview?(row: T): boolean;
  canSelect?(row: T): boolean;
  filters?: ReactNode;
  onDataChange?: Parameters<typeof useDataGrid<T>>[0]["onDataChange"];
  getCellState?: (rowIndex: number, columnId: string) => {
    type: "error" | "warning";
    messages: string[];
  } | null;
  pageSize?: number;
}) {
  const dir = useDirection();
  const { formatDecimal } = useNumberFormatting();
  const [visible, setVisible] = useState(false);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: pageSize ?? 50 });
  const hasMultiplePages = !!pageSize && data.length > pageSize;
  const paginationModel = useMemo(() => getPaginationRowModel<T>(), []);
  const tableRef = useRef<{ getRowModel(): { rows: { original: T }[] } } | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(data.length / (pageSize ?? 50)) - 1);
    setPagination((current) => ({ pageIndex: Math.min(current.pageIndex, lastPage), pageSize: pageSize ?? 50 }));
  }, [data.length, pageSize]);
  // Match the host grid: validation must read the current draft during render.
  const cellStateRef = useRef(getCellState);
  cellStateRef.current = getCellState;
  const readCellState = useCallback(
    (rowIndex: number, columnId: string) => {
      const row = tableRef.current?.getRowModel().rows[rowIndex]?.original;
      const originalIndex = row === undefined ? rowIndex : dataRef.current.indexOf(row);
      return cellStateRef.current?.(originalIndex, columnId) ?? null;
    },
    [],
  );
  const selectionColumn = useMemo<Parameters<typeof useDataGrid<T>>[0]["columns"][number]>(
    () => ({
      id: "select",
      size: 48,
      enableHiding: false,
      enableSorting: false,
      enableResizing: false,
      meta: { readOnly: true },
      header: ({ table }) => (
        <Checkbox
          aria-label={hasMultiplePages ? "选择本页全部行" : "选择全部行"}
          checked={pageSize ? table.getIsAllPageRowsSelected() : table.getIsAllRowsSelected()}
          indeterminate={pageSize ? table.getIsSomePageRowsSelected() : table.getIsSomeRowsSelected()}
          disabled={busy || !table.getRowModel().rows.some((row) => row.getCanSelect())}
          onCheckedChange={(checked) => pageSize ? table.toggleAllPageRowsSelected(Boolean(checked)) : table.toggleAllRowsSelected(Boolean(checked))}
        />
      ),
      cell: ({ row }) => (
        <div className="flex h-full items-center">
          <Checkbox
            aria-label={`选择行 ${getRowId(row.original)}`}
            checked={row.getIsSelected()}
            disabled={busy || !row.getCanSelect()}
            onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
          />
        </div>
      ),
    }),
    [busy, getRowId, hasMultiplePages, pageSize],
  );
  const reviewColumns = useMemo<Parameters<typeof useDataGrid<T>>[0]["columns"]>(
    () => [
      selectionColumn,
      ...columns.map((column): Parameters<typeof useDataGrid<T>>[0]["columns"][number] =>
        column.id && typeof column.header === "function"
          ? {
              ...column,
              id: column.id,
              header: (context) => (
                <DataGridColumnHeader header={context.header} table={context.table} />
              ),
            }
          : column,
      ),
    ],
    [selectionColumn, columns],
  );
  const grid = useDataGrid({
    data,
    columns: reviewColumns,
    getRowId,
    dir,
    readOnly: busy || !onDataChange,
    enablePaste: !!onDataChange,
    enableRowSelection: (row) => !busy && (canSelect?.(row.original) ?? true),
    enableMultiRowSelection: true,
    enableSearch: false,
    onDataChange,
    meta: { getCellState: readCellState },
    ...(pageSize ? { state: { pagination }, onPaginationChange: setPagination, getPaginationRowModel: paginationModel, autoResetPageIndex: false } : {}),
    initialState: { columnPinning: { left: ["select"] } },
  });
  tableRef.current = grid.table;
  useEffect(() => {
    if (pageSize && grid.dataGridRef.current) grid.dataGridRef.current.scrollTop = 0;
  }, [grid.dataGridRef, pagination.pageIndex, pageSize]);
  const selected = grid.table.getSelectedRowModel().rows.map((row) => row.original);
  function run(action: (rows: T[]) => void) {
    action(selected);
    grid.table.resetRowSelection();
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {filters}
        <Button variant="outline" onClick={() => setVisible(!visible)}>
          显示列
        </Button>
      </div>
      {visible && (
        <div className="flex flex-wrap gap-3 rounded-md border p-3">
          {grid.table
            .getAllLeafColumns()
            .filter((column) => column.getCanHide())
            .map((column) => (
              <label key={column.id} className="flex items-center gap-2">
                <Checkbox
                  checked={column.getIsVisible()}
                  onCheckedChange={(checked) => column.toggleVisibility(Boolean(checked))}
                />
                {column.columnDef.meta?.label ??
                  (typeof column.columnDef.header === "string"
                    ? column.columnDef.header
                    : column.id)}
              </label>
            ))}
        </div>
      )}
      {selected.length > 0 && (
        <div
          role="toolbar"
          aria-label="批量操作"
          className="bg-muted flex flex-wrap items-center gap-2 rounded-lg border p-3"
        >
          <span>已选择 {formatDecimal(selected.length, { maximumFractionDigits: 0 })} 行</span>
          <Button variant="outline" disabled={busy} onClick={() => run(onSkip)}>
            跳过
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => run(onRestore)}>
            取消跳过
          </Button>
          {onReview && (
            <Button
              variant="outline"
              disabled={busy || !selected.every((row) => canReview?.(row))}
              onClick={() => run(onReview)}
            >
              标记已核对
            </Button>
          )}
          <Button variant="ghost" onClick={() => grid.table.resetRowSelection()}>
            清除选择
          </Button>
        </div>
      )}
      <DataGrid
        {...grid}
        dir={dir}
        height={440}
        className="import-wizard-grid"
        style={
          {
            "--import-wizard-grid-width": `${grid.table.getTotalSize()}px`,
          } as import("react").CSSProperties
        }
      />
      {pageSize && data.length > pageSize && <div className="flex flex-col gap-3 px-2 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-center text-sm sm:text-start">
          第 {formatDecimal(pagination.pageIndex * pageSize + 1)}–{formatDecimal(Math.min((pagination.pageIndex + 1) * pageSize, data.length))} 条，共 {formatDecimal(data.length)} 条
        </p>
        <div className="flex items-center justify-center gap-2">
          <span className="text-muted-foreground text-sm">第 {formatDecimal(pagination.pageIndex + 1)} / {formatDecimal(grid.table.getPageCount())} 页</span>
          <Button variant="outline" size="icon" className="h-9 w-9 sm:h-8 sm:w-8" aria-label="上一页" disabled={!grid.table.getCanPreviousPage()} onClick={() => grid.table.previousPage()}><Icons.ChevronLeft className="h-4 w-4 rtl:rotate-180" /></Button>
          <Button variant="outline" size="icon" className="h-9 w-9 sm:h-8 sm:w-8" aria-label="下一页" disabled={!grid.table.getCanNextPage()} onClick={() => grid.table.nextPage()}><Icons.ChevronRight className="h-4 w-4 rtl:rotate-180" /></Button>
        </div>
      </div>}
    </div>
  );
}
