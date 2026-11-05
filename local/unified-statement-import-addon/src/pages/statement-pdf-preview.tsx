import { useEffect, useState } from "react";
import { AlertFeedback, Button, useNumberFormatting } from "@wealthfolio/ui";
import type { PdfOptions } from "../parsers/pdf";

export function StatementPdfPreview({ bytes, options, page, onPageChange }: {
  bytes: Uint8Array; options: PdfOptions; page: number; onPageChange(page: number): void;
}) {
  const [result, setResult] = useState<{ image: string; total: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { formatDecimal } = useNumberFormatting();
  useEffect(() => {
    let active = true;
    setBusy(true); setError(""); setResult(null);
    void (async () => {
      const { openPdf } = await import("../parsers/pdf");
      const pdf = await openPdf(bytes, options);
      try {
        if (!active) return;
        const source = await pdf.getPage(page);
        const viewport = source.getViewport({ scale: 1000 / source.getViewport({ scale: 1 }).width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await source.render({ canvas, viewport }).promise;
        if (active) setResult({ image: canvas.toDataURL("image/png"), total: pdf.numPages });
      } finally { await pdf.destroy(); }
    })().catch(() => { if (active) setError("PDF 页面预览失败，请核对文件与密码后重新读取。"); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [bytes, options.assets, options.password, page]);
  return <div className="space-y-3">
    <div className="flex items-center gap-3">
      <Button variant="outline" disabled={busy || page === 1} onClick={() => onPageChange(page - 1)}>上一页</Button>
      <span>{formatDecimal(page, { maximumFractionDigits: 0 })} / {result ? formatDecimal(result.total, { maximumFractionDigits: 0 }) : "…"}</span>
      <Button variant="outline" disabled={busy || !result || page >= result.total} onClick={() => onPageChange(page + 1)}>下一页</Button>
    </div>
    {busy ? <p role="status">正在渲染页面…</p> : error ? <AlertFeedback variant="error" title="预览失败">{error}</AlertFeedback> :
      result && <img src={result.image} alt={`PDF 第 ${page} 页`} className="h-auto w-full" />}
  </div>;
}
