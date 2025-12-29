import React from "react";

interface ContextMenuProps {
  x: number;
  y: number;
  nodeId: string;
  isMarked: boolean;
  onClose: () => void;
  onHide: (nodeId: string) => void;
  onExpand: (nodeId: string) => void;
  onShowDetails: (nodeId: string) => void;
  onToggleMark: (nodeId: string) => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  nodeId,
  isMarked,
  onClose,
  onHide,
  onExpand,
  onShowDetails,
  onToggleMark,
}) => {
  return (
    <div
      style={{
        position: "absolute",
        top: y,
        left: x,
        zIndex: 100,
        backgroundColor: "white",
        border: "1px solid #ccc",
        borderRadius: "4px",
        boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
        padding: "4px 0",
        minWidth: "120px",
      }}
      onMouseLeave={onClose}
    >
      <div
        style={{
          padding: "8px 12px",
          cursor: "pointer",
          fontSize: "14px",
          color: "#333",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f0f0f0")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "white")}
        onClick={() => {
          onExpand(nodeId);
          onClose();
        }}
      >
        展開 (Expand)
      </div>
      <div
        style={{
          padding: "8px 12px",
          cursor: "pointer",
          fontSize: "14px",
          color: "#333",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f0f0f0")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "white")}
        onClick={() => {
          onShowDetails(nodeId);
          onClose();
        }}
      >
        資料詳情
      </div>
      <div
        style={{
          padding: "8px 12px",
          cursor: "pointer",
          fontSize: "14px",
          color: "#333",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f0f0f0")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "white")}
        onClick={() => {
          onToggleMark(nodeId);
          onClose();
        }}
      >
        {isMarked ? "取消標記" : "標記"}
      </div>
      <div
        style={{
          padding: "8px 12px",
          cursor: "pointer",
          fontSize: "14px",
          color: "#333",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f0f0f0")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "white")}
        onClick={() => {
          onHide(nodeId);
          onClose();
        }}
      >
        隱藏 (Hide)
      </div>
    </div>
  );
};
