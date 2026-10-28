import { Fragment, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardHeader,
  Icons,
  Spinner,
  useNumberFormatting,
} from "@wealthfolio/ui";

export interface ImportWizardLayoutProps {
  children: ReactNode;
  steps?: ReactNode;
  navigation?: ReactNode;
  isResult?: boolean;
}

export function ImportWizardLayout({
  children,
  steps,
  navigation,
  isResult,
}: ImportWizardLayoutProps) {
  return (
    <Card data-import-wizard className="flex h-full min-h-0 w-full flex-col gap-0 overflow-hidden">
      {!isResult && steps && (
        <CardHeader className="shrink-0 border-b px-3 py-3 sm:px-6 sm:py-4">{steps}</CardHeader>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">{children}</div>
      {navigation && <div className="shrink-0 px-3 pb-3 sm:px-6 sm:pb-6">{navigation}</div>}
    </Card>
  );
}

export interface WizardStepIndicatorProps {
  label: string;
  steps: { id: string; label: string }[];
  currentStep: string;
}

export function WizardStepIndicator({ label, steps, currentStep }: WizardStepIndicatorProps) {
  const { formatDecimal } = useNumberFormatting();
  const currentIndex = steps.findIndex((step) => step.id === currentStep);
  return (
    <div aria-label={label}>
      <div className="flex items-center justify-center py-3">
        {steps.map((step, index) => {
          const completed = index < currentIndex;
          const current = index === currentIndex;
          return (
            <Fragment key={step.id}>
              <div className="flex items-center">
                <div
                  aria-current={current ? "step" : undefined}
                  aria-label={step.label}
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors md:size-10 ${
                    completed
                      ? "border-primary bg-primary text-primary-foreground"
                      : current
                        ? "border-primary bg-primary/10 text-primary ring-primary/15 ring-4"
                        : "border-muted-foreground/30 text-muted-foreground"
                  }`}
                >
                  {completed ? (
                    <Icons.Check className="size-4" />
                  ) : (
                    <span className="text-sm font-medium">
                      {formatDecimal(index + 1, { maximumFractionDigits: 0 })}
                    </span>
                  )}
                </div>
                <span
                  className={`ms-3 hidden text-sm md:inline ${current ? "text-primary font-semibold" : completed ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`mx-2 h-0.5 w-6 md:w-16 ${completed ? "bg-primary" : "bg-muted-foreground/30"}`}
                />
              )}
            </Fragment>
          );
        })}
      </div>
      <p className="text-muted-foreground pb-3 text-center text-xs md:hidden">
        {steps[currentIndex]?.label}
      </p>
    </div>
  );
}

export interface StepNavigationProps {
  onNext: () => void;
  onBack: () => void;
  canGoBack: boolean;
  canGoNext: boolean;
  nextLabel: string;
  nextLoadingLabel: string;
  backLabel: string;
  isNextLoading?: boolean;
  showNext?: boolean;
}

export function StepNavigation({
  onNext,
  onBack,
  canGoBack,
  canGoNext,
  nextLabel,
  nextLoadingLabel,
  backLabel,
  isNextLoading,
  showNext = true,
}: StepNavigationProps) {
  return (
    <div className="flex flex-col-reverse justify-between gap-3 border-t pt-4 sm:flex-row">
      <Button variant="outline" onClick={onBack} disabled={!canGoBack} className="w-full sm:w-auto">
        <Icons.ArrowLeft className="me-2 size-4 rtl:rotate-180" />
        {backLabel}
      </Button>
      {showNext && (
        <Button
          onClick={onNext}
          disabled={!canGoNext || isNextLoading}
          className="w-full sm:w-auto"
        >
          {isNextLoading ? (
            <>
              <Spinner className="me-2 size-4" />
              {nextLoadingLabel}
            </>
          ) : (
            <>
              {nextLabel}
              <Icons.ArrowRight className="ms-2 size-4 rtl:rotate-180" />
            </>
          )}
        </Button>
      )}
    </div>
  );
}

export interface FileDropzoneProps {
  file: File | null;
  labels: { remove: string; processing: string; choose: string; drop: string; hint: string };
  onFileChange: (file: File | null) => void;
  isLoading?: boolean;
  accept?: string;
  isValid?: boolean;
  error?: string | null;
}

export function FileDropzone({
  file,
  labels,
  onFileChange,
  isLoading = false,
  accept = "*",
  isValid = true,
  error,
}: FileDropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { formatDecimal } = useNumberFormatting();
  const invalid = !isValid || !!error;
  const choose = () => {
    if (!file && !isLoading) input.current?.click();
  };
  return (
    <div
      className={`group relative flex h-full flex-col items-center justify-center gap-2 rounded-lg border p-4 transition-colors ${dragging ? "border-primary bg-primary/5" : "border-border bg-background/50"} ${file && !invalid && !isLoading ? "" : "border-dashed"} ${!file && !isLoading ? "cursor-pointer hover:bg-background/80" : ""}`}
      role={!file ? "button" : undefined}
      tabIndex={!file && !isLoading ? 0 : undefined}
      aria-label={!file ? labels.choose : undefined}
      aria-disabled={isLoading || undefined}
      onClick={choose}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          choose();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        if (!file && !isLoading && event.dataTransfer.files[0])
          onFileChange(event.dataTransfer.files[0]);
      }}
    >
      <input
        ref={input}
        aria-label={labels.choose}
        type="file"
        accept={accept}
        disabled={isLoading}
        className="hidden"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          if (event.target.files?.[0]) onFileChange(event.target.files[0]);
        }}
      />
      <span
        className={`flex size-10 items-center justify-center rounded-full ${isLoading ? "bg-info-subtle text-info-subtle-foreground" : invalid ? "bg-destructive-subtle text-destructive-subtle-foreground" : file ? "bg-success-subtle text-success-subtle-foreground" : "bg-muted text-muted-foreground"}`}
      >
        {isLoading ? (
          <Spinner className="size-5" />
        ) : invalid ? (
          <Icons.AlertCircle className="size-5" />
        ) : file ? (
          <Icons.CheckCircle className="size-5" />
        ) : (
          <Icons.Import className="size-5" />
        )}
      </span>
      <div className="min-w-0 max-w-full text-center text-xs">
        {isLoading ? (
          <p className="font-medium">{labels.processing}</p>
        ) : file ? (
          <>
            <p
              className={`break-all font-medium ${invalid ? "text-destructive-subtle-foreground" : ""}`}
            >
              {file.name}
            </p>
            <p className="text-muted-foreground">
              {formatDecimal(file.size / 1024, { maximumFractionDigits: 2 })} KB
            </p>
          </>
        ) : (
          <>
            <p>
              <span className="text-primary font-medium">{labels.choose}</span> {labels.drop}
            </p>
            <p className="text-muted-foreground">{labels.hint}</p>
          </>
        )}
      </div>
      {file && !isLoading && (
        <Button
          size="sm"
          variant="outline"
          onClick={(event) => {
            event.stopPropagation();
            onFileChange(null);
            if (input.current) input.current.value = "";
          }}
        >
          <Icons.Trash className="me-2 size-4" />
          {labels.remove}
        </Button>
      )}
    </div>
  );
}

export interface CancelConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title: string;
  description: string;
  continueLabel: string;
  cancelLabel: string;
}

export function CancelConfirmationDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  continueLabel,
  cancelLabel,
}: CancelConfirmationDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Icons.AlertTriangle className="text-warning-subtle-foreground size-5" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{continueLabel}</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            <Icons.X className="me-2 size-4" />
            {cancelLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface ImportResultSummaryProps {
  title: string;
  description?: ReactNode;
  outcome?: "success" | "partial" | "uncertain";
  statistics: { label: string; value: ReactNode }[];
  children?: ReactNode;
}

export function ImportResultSummary({
  title,
  description,
  outcome = "success",
  statistics,
  children,
}: ImportResultSummaryProps) {
  return (
    <div className="flex flex-col items-center gap-6 py-6 text-center" role="status">
      <span
        className={`flex size-16 items-center justify-center rounded-full ${outcome === "success" ? "bg-success-subtle text-success-subtle-foreground" : "bg-warning-subtle text-warning-subtle-foreground"}`}
      >
        {outcome === "success" ? (
          <Icons.CheckCircle className="size-9" />
        ) : (
          <Icons.AlertTriangle className="size-9" />
        )}
      </span>
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        {description && <div className="text-muted-foreground mt-2 text-sm">{description}</div>}
      </div>
      <dl className="flex flex-wrap justify-center gap-8">
        {statistics.map(({ label, value }) => (
          <div key={label}>
            <dt className="text-muted-foreground text-sm">{label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">{children}</div>
    </div>
  );
}

const statusStyles = {
  success: "border-success-subtle-border bg-success-subtle text-success-subtle-foreground",
  info: "border-info-subtle-border bg-info-subtle text-info-subtle-foreground",
  muted: "border-border bg-muted text-muted-foreground",
  warning: "border-warning-subtle-border bg-warning-subtle text-warning-subtle-foreground",
  error:
    "border-destructive-subtle-border bg-destructive-subtle text-destructive-subtle-foreground",
};

export interface ImportStatusItem {
  label: string;
  value: ReactNode;
  tone: keyof typeof statusStyles;
  icon: ReactNode;
}

export function ImportStatusCards({ items }: { items: ImportStatusItem[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {items.map(({ label, value, tone, icon }) => (
        <div
          key={label}
          className={`flex min-w-0 items-center gap-3 rounded-md border p-3 ${statusStyles[tone]}`}
        >
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-current/10"
          >
            {icon}
          </span>
          <div className="min-w-0">
            <dt className="text-sm font-medium">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}
