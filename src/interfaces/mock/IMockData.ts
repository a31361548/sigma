/**
 * Node attributes interface for Sigma/Graphology
 */
export interface ISigmaNode {
  id: string;
  label: string;
  x?: number;
  y?: number;
  size?: number;
  color?: string;
  data?: NodePayload;
}

export interface ISigmaEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  size?: number;
  color?: string;
  type?: string;
  data?: EdgePayload;
}

/**
 * 理專節點的 payload 介面。
 */
export interface IAdvisorPayload {
    label: string;
    metaData: {
        personName: string;
        businessType: '理專';
        jobTitle: string;
        department: string;
        responsibleArea: string;
        taiwanId: string;
    };
    outgoingEdges?: string[];
}

/**
 * 客戶節點的 payload 介面。
 */
export interface IClientPayload {
    label: string;
    metaData: {
        businessType: '客戶';
        personName: string;
        occupation: string;
        companyName: string;
        taiwanId: string;
        email: string;
        advisorId?: string; // 新增:理專 ID
    };
    outgoingEdges?: string[];
}

/**
 * 投資組合節點的 payload 介面。
 */
export interface IPortfolioPayload {
    label: string;
    metaData: {
        businessType: '投資組合';
        portfolioId: string;
        riskLevel: string;
        ownerId?: string; // 新增:持有人 ID
    };
    outgoingEdges?: string[];
}

/**
 * 個人帳號節點的 payload 介面。
 */
export interface IPersonalAccountPayload {
    label: string;
    metaData: {
        businessType: '帳號';
        accountNumber: string;
        bankName: string;
        ownerId?: string; // 新增:持有人 ID
    };
    outgoingEdges?: string[];
}

/**
 * 模擬資料生成器產生的節點 payload 的聯合類型。
 */
export type NodePayload = IAdvisorPayload | IClientPayload | IPortfolioPayload | IPersonalAccountPayload;

/**
 * 結構性邊的資料介面
 */
export interface IStructuralEdgePayload {
    type: 'structural';
}

/**
 * 交易性邊的資料介面
 */
export interface ITransactionalEdgePayload {
    type: 'transactional';
    metaData: {
        amount: number;
        date: string;
        description: string;
    };
}

/**
 * 邊的資料聯合類型
 */
export type EdgePayload = IStructuralEdgePayload | ITransactionalEdgePayload;

/**
 * 最終輸出的圖形資料結構,包含節點和邊的陣列。
 */
export interface IGraphData {
    nodes: ISigmaNode[];
    edges: ISigmaEdge[];
}
