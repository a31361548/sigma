import { useEffect, useState, type ReactElement } from "react";
import type { NodePayload } from "../../interfaces/mock/IMockData";

type Field = { label: string; value: string };

interface NodeDetailPanelProps {
  title: string;
  payload: NodePayload | null;
  onClose: () => void;
}

const toText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  return "-";
};

const buildFields = (payload: NodePayload | null): Field[] => {
  if (!payload) return [{ label: "狀態", value: "找不到此節點資料" }];

  const meta = payload.metaData;
  const businessType = meta.businessType;

  const base: Field[] = [
    { label: "類型", value: businessType },
    { label: "顯示名稱", value: payload.label },
  ];

  switch (businessType) {
    case "理專":
      return [
        ...base,
        { label: "姓名", value: toText(meta.personName) },
        { label: "職稱", value: toText(meta.jobTitle) },
        { label: "部門", value: toText(meta.department) },
        { label: "負責區域", value: toText(meta.responsibleArea) },
        { label: "身分證", value: toText(meta.taiwanId) },
      ];
    case "客戶":
      return [
        ...base,
        { label: "姓名", value: toText(meta.personName) },
        { label: "職業", value: toText(meta.occupation) },
        { label: "公司", value: toText(meta.companyName) },
        { label: "Email", value: toText(meta.email) },
        { label: "身分證", value: toText(meta.taiwanId) },
        { label: "所屬理專", value: toText(meta.advisorId) },
      ];
    case "投資組合":
      return [
        ...base,
        { label: "組合代碼", value: toText(meta.portfolioId) },
        { label: "風險等級", value: toText(meta.riskLevel) },
        { label: "持有人", value: toText(meta.ownerId) },
      ];
    case "帳號":
      return [
        ...base,
        { label: "銀行", value: toText(meta.bankName) },
        { label: "帳號", value: toText(meta.accountNumber) },
        { label: "持有人", value: toText(meta.ownerId) },
      ];
    default: {
      const exhaustiveCheck: never = businessType;
      return [...base, { label: "未知類型", value: String(exhaustiveCheck) }];
    }
  }
};

export const NodeDetailPanel = ({ title, payload, onClose }: NodeDetailPanelProps): ReactElement => {
  const fields = buildFields(payload);
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    setNote("");
  }, [payload]);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        height: "100%",
        width: 360,
        zIndex: 80,
        background: "rgba(255, 255, 255, 0.82)",
        backdropFilter: "blur(8px)",
        borderLeft: "1px solid rgba(0,0,0,0.12)",
        boxShadow: "-8px 0 24px rgba(0,0,0,0.12)",
        padding: 16,
        overflowY: "auto",
        color: "#0f172a",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            height: 28,
            width: 28,
            borderRadius: 6,
            border: "1px solid rgba(0,0,0,0.15)",
            background: "rgba(255,255,255,0.7)",
            cursor: "pointer",
          }}
        >
          X
        </button>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: "rgba(15, 23, 42, 0.7)" }}>
        以下為示意用假資料/節點 payload 摘要，可依需求替換為真實 API 回傳。
      </div>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "110px 1fr", rowGap: 10, columnGap: 12 }}>
        {fields.map((f) => (
          <div key={f.label} style={{ display: "contents" }}>
            <div style={{ fontSize: 12, color: "rgba(15, 23, 42, 0.65)" }}>{f.label}</div>
            <div style={{ fontSize: 13, color: "#0f172a", wordBreak: "break-word" }}>{f.value}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>更多資訊（假資料）</div>
        <div style={{ marginTop: 8, fontSize: 13, color: "#0f172a", lineHeight: 1.5 }}>
          <div>風險偏好：中等</div>
          <div>狀態：正常</div>
          <div>最後更新：2025/12/16 10:00</div>
        </div>
      </div>

      <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>備註</div>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="輸入備註..."
          rows={4}
          style={{
            marginTop: 8,
            width: "100%",
            resize: "vertical",
            padding: 8,
            borderRadius: 8,
            border: "1px solid rgba(15, 23, 42, 0.2)",
            background: "rgba(255,255,255,0.9)",
            color: "#0f172a",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        />
      </div>
    </div>
  );
};
