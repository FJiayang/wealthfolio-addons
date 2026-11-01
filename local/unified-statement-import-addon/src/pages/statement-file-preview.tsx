import { ImportFilePreview } from "@wealthfolio/import-wizard-ui";
import { Table, TableBody, TableRow, TableCell, useNumberFormatting } from "@wealthfolio/ui";
import { getStatementParser } from "../parsers";
import type { StatementDocument } from "../parsers/types";
export function StatementFilePreview({ document }: { document: StatementDocument }) {
  const parser = getStatementParser(document.parserId);
  const { formatDecimal } = useNumberFormatting();
  const n = (value: number) => formatDecimal(value, { maximumFractionDigits: 0 });
  return (
    <ImportFilePreview
      headers={parser!.previewColumns.map((column) => column.label)}
      rows={document.rows.map(({ source }) =>
        parser!.previewColumns.map((column) => String(source[column.field] ?? "")),
      )}
      original={
        <div className="space-y-3">
          {document.rawPreview?.map((sheet) => (
            <div key={sheet.name}>
              <p>{sheet.name}</p>
              <Table>
                <TableBody>
                  {sheet.records.map((record) => (
                    <TableRow key={record.lineNumber}>
                      <TableCell>{n(record.lineNumber)}</TableCell>
                      {record.cells.map((cell, index) => (
                        <TableCell key={index}>{cell}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      }
    />
  );
}
