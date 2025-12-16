/**
 * 數量範圍的介面,用於定義最小和最大值。
 */
export interface IQuantityRange {
    min: number;
    max: number;
}

/**
 * MockDataGenerator 的設定選項介面。
 * 
 * 節點顏色說明 (Node Color Legend):
 * 🔴 紅色 (Red): 理專 (Advisor)
 * 🟢 綠色 (Green): 客戶 (Client)
 * 🟣 紫色 (Violet): 帳號 (Account)
 * 🟡 黃色 (Yellow): 被標記 (Marked) 的節點
 * 🟠 橘色 (Orange): 搜尋選中 (Highlighted) 的節點
 */
export interface IMockGeneratorConfig {
    /**
     * 要產生的理專數量。
     * 可以是一個固定數字,或是一個範圍物件 { min: number, max: number }。
     * @default 5
     */
    advisorCount: number | IQuantityRange;

    /**
     * 每位理專平均擁有的客戶數量。
     * 可以是一個固定數字,或是一個範圍物件 { min: number, max: number }。
     * @default { min: 2, max: 5 }
     */
    clientsPerAdvisor: number | IQuantityRange;

    /**
     * 每位客戶平均擁有的個人帳號數量。
     * 可以是一個固定數字,或是一個範圍物件 { min: number, max: number }。
     * @default { min: 1, max: 3 }
     */
    accountsPerClient: number | IQuantityRange;

    /**
     * 每個隨機客戶帳號發起的交易數量。
     * 這些交易會各自產生一個新的、獨立的目標帳號節點。
     * 可以是一個固定數字,或是一個範圍物件 { min: number, max: number }。
     * @default { min: 0, max: 2 }
     */
    transactionsPerAccount: number | IQuantityRange;

    /**
     * 為固定 "王大明" 的 "銀行A" 帳戶產生的固定交易數量。
     * 這些交易會指向一個新的、共用的 "銀行A" 帳戶,該帳戶再連到一個新客戶。
     * 建議設定為至少 2,以展示多重邊。
     * @default { min: 2, max: 4 }
     */
    fixedTransactionsPerAccount: number | IQuantityRange;
}
