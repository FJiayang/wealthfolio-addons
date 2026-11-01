import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Checkbox,
  DataGrid,
  DataGridColumnHeader,
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
    <details
      open={pending || undefined}
      className={`rounded-lg border ${pending ? "border-warning-subtle-border bg-warning-subtle" : "bg-muted/20"}`}
    >
      <summary className="cursor-pointer p-4 font-medium">{title}</summary>
      <div className="space-y-4 border-t p-4">{children}</div>
    </details>
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
}) {
  const dir = useDirection();
  const { formatDecimal } = useNumberFormatting();
  const [visible, setVisible] = useState(false);
  // Match the host grid: validation must read the current draft during render.
  const cellStateRef = useRef(getCellState);
  cellStateRef.current = getCellState;
  const readCellState = useCallback(
    (rowIndex: number, columnId: string) => cellStateRef.current?.(rowIndex, columnId) ?? null,
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
          aria-label="选择全部行"
          checked={table.getIsAllRowsSelected()}
          indeterminate={table.getIsSomeRowsSelected()}
          disabled={busy || !table.getRowModel().rows.some((row) => row.getCanSelect())}
          onCheckedChange={(checked) => table.toggleAllRowsSelected(Boolean(checked))}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={`选择行 ${getRowId(row.original)}`}
          checked={row.getIsSelected()}
          disabled={busy || !row.getCanSelect()}
          onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
        />
      ),
    }),
    [busy, getRowId],
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
    rowHeight: "medium",
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
    initialState: { columnPinning: { left: ["select"] } },
  });
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
    </div>
  );
}
