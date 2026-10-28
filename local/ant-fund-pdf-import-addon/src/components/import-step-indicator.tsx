import { Icons, useNumberFormatting } from "@wealthfolio/ui";
import type { MessageKey } from "../messages";

const steps = [
  { id: "upload", label: "upload" },
  { id: "funds", label: "funds" },
  { id: "review", label: "preview" },
  { id: "result", label: "done" },
] as const;
export type ImportStep = (typeof steps)[number]["id"];

// Same compact rail as the host import wizard and the unified statement addon.
export function ImportStepIndicator({
  currentStep,
  t,
}: {
  currentStep: ImportStep;
  t: (key: MessageKey) => string;
}) {
  const currentIndex = steps.findIndex((step) => step.id === currentStep);
  const { formatDecimal } = useNumberFormatting();
  return (
    <nav aria-label={t("importProgress")} className="ant-fund-import-steps w-full">
      <ol className="mx-auto flex max-w-85 items-center px-5 py-3 md:max-w-3xl md:justify-center md:px-0 md:py-0">
        {steps.map((step, index) => {
          const completed = index < currentIndex,
            current = step.id === currentStep;
          return (
            <li
              key={step.id}
              aria-current={current ? "step" : undefined}
              className={`flex items-center ${index === steps.length - 1 ? "" : "flex-1"}`}
            >
              <span
                aria-hidden="true"
                style={{
                  boxShadow: current
                    ? "0 0 0 4px color-mix(in oklab, var(--primary) 15%, transparent)"
                    : undefined,
                }}
                className={`flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors md:size-10 ${completed ? "border-primary bg-primary text-primary-foreground" : current ? "border-primary bg-primary/10 text-primary scale-110" : "border-muted-foreground/30 text-muted-foreground"}`}
              >
                {completed ? (
                  <Icons.Check className="size-4" />
                ) : (
                  <span className="text-sm font-medium">{formatDecimal(index + 1)}</span>
                )}
              </span>
              <span
                className={`ms-3 hidden whitespace-nowrap text-sm md:inline ${current ? "text-primary font-semibold" : completed ? "text-foreground font-medium" : "text-muted-foreground font-medium"}`}
              >
                {t(step.label)}
              </span>
              <span className="sr-only md:hidden">{t(step.label)}</span>
              {index < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`mx-2 h-0.5 min-w-4 flex-1 md:min-w-8 ${completed ? "bg-primary" : "bg-muted-foreground/30"}`}
                />
              )}
            </li>
          );
        })}
      </ol>
      <p
        aria-hidden="true"
        className="text-muted-foreground pb-2 text-center text-xs font-medium md:hidden"
      >
        {t(steps[currentIndex].label)}
      </p>
    </nav>
  );
}
