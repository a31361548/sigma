export type DataSourceType = "mock" | "json";

interface DataSourceToggleProps {
  value: DataSourceType;
  onChange: (value: DataSourceType) => void;
  disabled?: boolean;
}

export const DataSourceToggle = ({ value, onChange, disabled }: DataSourceToggleProps) => {
  const options: { label: string; value: DataSourceType; description: string }[] = [
    { label: "假資料", value: "mock", description: "使用程式內建 20 筆左右範例" },
    { label: "fakedata.json", value: "json", description: "載入 public/fakedata.json" },
  ];

  return (
    <div className="data-source-toggle">
      <div className="panel compact">
        {options.map((option) => (
          <button
            key={option.value}
            className={`toggle-button${option.value === value ? " active" : ""}`}
            onClick={() => onChange(option.value)}
            disabled={disabled}
          >
            <div className="toggle-label">{option.label}</div>
            <div className="toggle-desc">{option.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
};
