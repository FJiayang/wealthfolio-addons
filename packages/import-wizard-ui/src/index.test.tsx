// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FormattingProvider } from "@wealthfolio/ui";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  FileDropzone,
  ImportWizardLayout,
  StepNavigation,
  ImportStatusCards,
  ImportReviewTable,
  ImportFilePreview,
} from ".";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const labels = {
  choose: "选择文件",
  drop: "或拖拽",
  remove: "移除",
  processing: "处理中",
  hint: "PDF",
};

it("筛选后批量跳过仅操作当前数据中的稳定 ID，操作后清除选择", async () => {
  const onSkip = vi.fn();
  const data = [
    { id: "original-9", amount: "10" },
    { id: "original-2", amount: "20" },
  ];
  const render = async (rows: typeof data) =>
    act(async () =>
      root.render(
        <FormattingProvider locale="zh-CN">
          <ImportReviewTable
            data={rows}
            columns={[{ id: "amount", accessorKey: "amount", header: "金额" }]}
            getRowId={(row) => row.id}
            onSkip={onSkip}
            onRestore={vi.fn()}
          />
        </FormattingProvider>,
      ),
    );
  await render(data);
  await act(async () => container.querySelector<HTMLElement>('[aria-label="选择全部行"]')!.click());
  await render([data[1]]);
  const toolbar = container.querySelector('[role="toolbar"]')!;
  expect(toolbar.textContent).toContain("已选择 1 行");
  await act(async () =>
    [...toolbar.querySelectorAll("button")]
      .find((button) => button.textContent === "跳过")!
      .click(),
  );
  expect(onSkip).toHaveBeenCalledWith([data[1]]);
  expect(container.querySelector('[role="toolbar"]')).toBeNull();
});

it("文件预览提供原始内容切换", async () => {
  await act(async () =>
    root.render(
      <FormattingProvider locale="zh-CN">
        <ImportFilePreview headers={["金额"]} rows={[["10"]]} original={<pre>original csv</pre>} />
      </FormattingProvider>,
    ),
  );
  expect(container.textContent).toContain("10");
  await act(async () =>
    [...container.querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((tab) => tab.textContent === "原始文件")!
      .click(),
  );
  expect(container.textContent).toContain("original csv");
});

it("支持拖入文件，处理中及已有文件时不替换，并可移除后重新选择", async () => {
  const onFileChange = vi.fn();
  const file = new File(["test"], "synthetic.pdf");
  const render = async (selected: File | null, isLoading = false) =>
    act(async () =>
      root.render(
        <FormattingProvider locale="zh-CN">
          <FileDropzone
            file={selected}
            isLoading={isLoading}
            onFileChange={onFileChange}
            labels={labels}
          />
        </FormattingProvider>,
      ),
    );
  const drop = async () => {
    const event = new Event("drop", { bubbles: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    await act(async () => container.firstElementChild!.dispatchEvent(event));
  };
  await render(null);
  await drop();
  expect(onFileChange).toHaveBeenCalledWith(file);
  onFileChange.mockClear();
  await render(null, true);
  await drop();
  await render(file);
  await drop();
  expect(onFileChange).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(onFileChange).toHaveBeenCalledWith(null);
  await render(null);
  const choose = vi.spyOn(container.querySelector<HTMLInputElement>("input")!, "click");
  await act(async () =>
    container
      .querySelector('[role="button"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(choose).toHaveBeenCalledOnce();
});

it("结果页隐藏步骤，处理中禁止提交并显示进度文字", async () => {
  const onNext = vi.fn();
  await act(async () =>
    root.render(
      <ImportWizardLayout
        isResult
        steps={<span>步骤</span>}
        navigation={
          <StepNavigation
            onNext={onNext}
            onBack={vi.fn()}
            canGoBack
            canGoNext
            isNextLoading
            nextLabel="提交"
            nextLoadingLabel="核对中"
            backLabel="返回"
          />
        }
      >
        <span>结果</span>
      </ImportWizardLayout>,
    ),
  );
  expect(container.textContent).not.toContain("步骤");
  const button = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("核对中"),
  )!;
  expect(button.disabled).toBe(true);
  await act(async () => button.click());
  expect(onNext).not.toHaveBeenCalled();
});

it("状态卡同时保留文字、数量和语义配色", async () => {
  await act(async () =>
    root.render(
      <ImportStatusCards
        items={[
          { label: "待导入", value: "17", tone: "success", icon: <span>✓</span> },
          { label: "错误", value: "2", tone: "error", icon: <span>!</span> },
        ]}
      />,
    ),
  );
  expect(container.querySelector("dt")!.textContent).toBe("待导入");
  expect(container.querySelector("dd")!.textContent).toBe("17");
  expect(container.querySelector("dl > div")!.className).toContain("bg-success-subtle");
  expect(container.querySelector("dl > div:last-child")!.className).toContain(
    "bg-destructive-subtle",
  );
});
