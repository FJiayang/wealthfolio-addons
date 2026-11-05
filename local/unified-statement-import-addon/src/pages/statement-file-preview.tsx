// Preview layout follows the host upload-step.tsx; see THIRD-PARTY-NOTICES.md.
import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Tabs, TabsList, TabsTrigger, TabsContent, Table, TableHeader, TableHead, TableBody, TableRow, TableCell, useNumberFormatting } from "@wealthfolio/ui";
import { getStatementParser } from "../parsers";
import type { StatementDocument } from "../parsers/types";
import type { PdfOptions } from "../parsers/pdf";
import { StatementPdfPreview } from "./statement-pdf-preview";

export function StatementFilePreview({ document, pdf }: { document: StatementDocument; pdf?: { bytes: Uint8Array; options: PdfOptions } }) {
  const parser = getStatementParser(document.parserId);
  const [tab, setTab] = useState("parsed");
  const [page, setPage] = useState(1);
  const { formatDecimal } = useNumberFormatting();
  const n = (value: number) => formatDecimal(value, { maximumFractionDigits: 0 });
  return <Tabs value={tab} onValueChange={setTab}>
    <Card>
      <CardHeader className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><CardTitle className="text-sm font-medium">文件预览</CardTitle><span className="text-muted-foreground text-xs">{n(document.rows.length)} 行</span></div>
          <TabsList className="bg-secondary flex space-x-1 rounded-full p-1">
            <TabsTrigger className="h-8 rounded-full px-2 text-sm" value="parsed">已解析</TabsTrigger>
            <TabsTrigger className="h-8 rounded-full px-2 text-sm" value="original">原始文件</TabsTrigger>
          </TabsList>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <TabsContent value="parsed" className="m-0 border-0 p-0">
          <div className="isolate max-h-75 overflow-auto border-t">
            <Table><TableHeader><TableRow><TableHead>#</TableHead>{parser.previewColumns.map((column) => <TableHead key={column.field}>{column.label}</TableHead>)}</TableRow></TableHeader>
              <TableBody>{document.rows.map(({ source }, index) => <TableRow key={index}>
                <TableCell>{source.pageNumber ? <Button variant="ghost" size="sm" onClick={() => { setPage(source.pageNumber!); setTab("original"); }}>第 {n(source.pageNumber)} 页 · 第 {n(source.pageLineNumber!)} 行</Button> : n(source.lineNumber)}</TableCell>
                {parser.previewColumns.map((column) => <TableCell key={column.field} className="max-w-80 truncate" title={String(source[column.field] ?? "")}>{String(source[column.field] ?? "")}</TableCell>)}
              </TableRow>)}</TableBody>
            </Table>
          </div>
        </TabsContent>
        <TabsContent value="original" className="m-0 max-h-[36rem] overflow-auto border-t p-3">
          {pdf ? <StatementPdfPreview bytes={pdf.bytes} options={pdf.options} page={page} onPageChange={setPage} /> :
            document.rawPreview?.map((sheet) => <div key={sheet.name} className="space-y-3"><p>{sheet.name}</p><Table><TableBody>{sheet.records.map((record) => <TableRow key={record.lineNumber}><TableCell>{n(record.lineNumber)}</TableCell>{record.cells.map((cell, index) => <TableCell key={index}>{cell}</TableCell>)}</TableRow>)}</TableBody></Table></div>)}
        </TabsContent>
      </CardContent>
    </Card>
  </Tabs>;
}
