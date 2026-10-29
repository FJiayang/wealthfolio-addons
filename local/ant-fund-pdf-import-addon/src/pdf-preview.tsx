import { useEffect, useState } from "react";
import type { AddonContext } from "@wealthfolio/addon-sdk";
import { AlertFeedback, Button, useNumberFormatting } from "@wealthfolio/ui";
import { renderStatementPage } from "./statement";

export function PdfPreview({ file, assets }: { file: File; assets: AddonContext["assets"] }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ image: string; total: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { formatDecimal } = useNumberFormatting();
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    void file
      .arrayBuffer()
      .then((bytes) => renderStatementPage(new Uint8Array(bytes), assets, page))
      .then((next) => {
        if (active) setResult(next);
      })
      .catch(() => {
        if (active) setError("PDF 页面预览失败，请重新选择文件。");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [file, assets, page]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button variant="outline" disabled={busy || page === 1} onClick={() => setPage(page - 1)}>
          上一页
        </Button>
        <span>
          {formatDecimal(page, { maximumFractionDigits: 0 })} /{" "}
          {result ? formatDecimal(result.total, { maximumFractionDigits: 0 }) : "…"}
        </span>
        <Button
          variant="outline"
          disabled={busy || !result || page === result.total}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </Button>
      </div>
      {busy ? (
        <p role="status">正在渲染页面…</p>
      ) : error ? (
        <AlertFeedback variant="error" title="预览失败">
          {error}
        </AlertFeedback>
      ) : (
        result && <img src={result.image} alt={`PDF 第 ${page} 页`} className="h-auto w-full" />
      )}
    </div>
  );
}
