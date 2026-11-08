import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@wealthfolio/ui";

export function ImportSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  placeholder = "请选择",
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange(value: string): void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <Select
      value={value || "__none__"}
      onValueChange={(value) => onChange(value === "__none__" ? "" : (value ?? ""))}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className="w-full min-w-0">
        <SelectValue>
          {options.find((option) => option.value === value)?.label ?? placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">{placeholder}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
