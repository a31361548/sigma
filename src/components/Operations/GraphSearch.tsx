import { useSigma } from "@react-sigma/core";
import { useState, useEffect } from "react";

interface GraphSearchProps {
  className?: string;
}

export const GraphSearch = ({ className }: GraphSearchProps) => {
  const sigma = useSigma();
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<string[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  // When search term changes, find matching nodes
  useEffect(() => {
    if (!search || search.trim() === "") {
      setMatches([]);
      setIsOpen(false);
      setCurrentMatchIndex(0);
      return;
    }

    const graph = sigma.getGraph();
    const found: string[] = [];
    
    graph.forEachNode((nodeId, attributes) => {
      const label = attributes.label || "";
      if (label.toLowerCase().includes(search.toLowerCase())) {
        found.push(nodeId);
      }
    });

    setMatches(found);
    setIsOpen(found.length > 0);
    setCurrentMatchIndex(0); // Reset to first match
  }, [search, sigma]);

  const handleFocus = (nodeId: string) => {
    const graph = sigma.getGraph();
    
    // Auto-Expand Logic:
    // If the node is hidden (or we just want to ensure path is visible),
    // traverse incoming structural edges (Advisor -> Client -> Portfolio -> Account) upwards.
    // Reveal all ancestors to ensure context is shown.
    
    const queue = [nodeId];
    const visited = new Set([nodeId]);
    
    while(queue.length > 0) {
        const curr = queue.shift()!;
        graph.setNodeAttribute(curr, "hidden", false);
        
        // Find structural parents (incoming edges)
        graph.forEachInEdge(curr, (_edge, attr, source) => {
            if (attr.edgeType === 'structural') {
                if (!visited.has(source)) {
                    visited.add(source);
                    queue.push(source);
                }
            }
        });
    }

    // Force refresh to apply changes visually immediately
    sigma.refresh();

    // Now animate camera
    const nodePosition = sigma.getNodeDisplayData(nodeId);
    if (nodePosition) {
      sigma.getCamera().animate(
        { ...nodePosition, ratio: 0.1 },
        { duration: 600 }
      );
      // Removed: setSearch(sigma.getGraph().getNodeAttribute(nodeId, "label"));
      // We keep the search term to allow navigation
    }
  };

  const handleNext = () => {
    if (matches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % matches.length;
    setCurrentMatchIndex(nextIndex);
    handleFocus(matches[nextIndex]);
  };

  const handlePrev = () => {
    if (matches.length === 0) return;
    const prevIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
    setCurrentMatchIndex(prevIndex);
    handleFocus(matches[prevIndex]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNext();
    }
  };

  return (
    <div className={`search-container ${className || ""}`} style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 10, display: "flex", alignItems: "center", gap: "8px" }}>
      <div className="search-input-wrapper" style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input
          type="text"
          placeholder="搜尋節點 (Search)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            padding: "8px 12px",
            paddingRight: matches.length > 0 ? "80px" : "12px", // Make room for counter
            borderRadius: "4px",
            border: "1px solid #ccc",
            width: "300px",
            fontSize: "14px",
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
          }}
        />
        
        {matches.length > 0 && (
          <div style={{ position: "absolute", right: "8px", display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "#666" }}>
            <span>{currentMatchIndex + 1} / {matches.length}</span>
            <button onClick={handlePrev} style={{ border: "none", background: "none", cursor: "pointer", padding: "0 2px", fontWeight: "bold" }}>↓</button>
            <button onClick={handleNext} style={{ border: "none", background: "none", cursor: "pointer", padding: "0 2px", fontWeight: "bold" }}>↑</button>
          </div>
        )}

        {isOpen && matches.length > 0 && (
          <ul style={{
            position: "absolute",
            top: "100%",
            left: 0,
            width: "100%",
            background: "white",
            border: "1px solid #ccc",
            borderRadius: "0 0 4px 4px",
            listStyle: "none",
            margin: 0,
            padding: 0,
            maxHeight: "200px",
            overflowY: "auto",
            boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
          }}>
            {matches.slice(0, 10).map((nodeId, idx) => { // List only top 10 to avoid performance issues
               const label = sigma.getGraph().getNodeAttribute(nodeId, "label");
               return (
                 <li 
                   key={nodeId}
                   onClick={() => {
                     setCurrentMatchIndex(idx); // Note: this might be wrong if list is truncated
                     // Actually for list click we usually just focus directly.
                     // But to keep sync with navigation, we might need to find the real index in `matches`.
                     const realIdx = matches.indexOf(nodeId);
                     if (realIdx !== -1) setCurrentMatchIndex(realIdx);
                     handleFocus(nodeId);
                     setIsOpen(false);
                   }}
                   style={{
                     padding: "8px 12px",
                     cursor: "pointer",
                     borderBottom: "1px solid #eee",
                     color: "#333",
                     background: currentMatchIndex === matches.indexOf(nodeId) ? "#e6f7ff" : "white"
                   }}
                   onMouseEnter={(e) => e.currentTarget.style.background = "#f0f0f0"}
                   onMouseLeave={(e) => e.currentTarget.style.background = currentMatchIndex === matches.indexOf(nodeId) ? "#e6f7ff" : "white"}
                 >
                   {label}
                 </li>
               );
            })}
             {matches.length > 10 && (
                <li style={{ padding: "8px 12px", color: "#999", fontStyle: "italic" }}>
                    ... and {matches.length - 10} more
                </li>
             )}
          </ul>
        )}
      </div>
    </div>
  );
};
