import { v4 as uuidv4 } from "uuid";
import { faker } from "@faker-js/faker/locale/zh_TW";
import type {
  IGraphData,
  ISigmaEdge,
  ISigmaNode,
  ITransactionalEdgePayload,
  IAdvisorPayload,
  IClientPayload,
  IPortfolioPayload,
  IPersonalAccountPayload
} from "../interfaces/mock/IMockData";
import type { IMockGeneratorConfig, IQuantityRange } from "../interfaces/mock/IMockGenerator";

const DEFAULT_NAMES = {
  advisors: ["呂明珠", "吳博文", "蔡怡婷", "謝惠玲", "林彥廷"],
  banks: ["銀行A", "銀行B", "銀行C", "銀行D", "銀行E", "銀行F"],
};

// Helper interfaces for internal hierarchy tracking
interface IHierarchicalAccount {
  id: string;
  node: ISigmaNode;
  ownerId: string;
}

interface IHierarchicalPortfolio {
    id: string;
    node: ISigmaNode;
    accounts: IHierarchicalAccount[];
    ownerId: string;
}

interface IHierarchicalClient {
  id: string;
  node: ISigmaNode;
  portfolios: IHierarchicalPortfolio[];
}

interface IHierarchicalAdvisor {
  id: string;
  node: ISigmaNode;
  clients: IHierarchicalClient[];
}

export class MockDataGenerator {
  private readonly advisorCount: number;
  private readonly clientsPerAdvisor: IQuantityRange;
  private readonly portfoliosPerClient: IQuantityRange;

  // Internal storage for hierarchy
  private advisors: IHierarchicalAdvisor[] = [];
  private allAccounts: IHierarchicalAccount[] = [];
  private hardcodedBankAAccounts: IHierarchicalAccount[] = [];

  constructor(config: IMockGeneratorConfig) {
    this.advisorCount = asNumber(config.advisorCount ?? 3);
    this.clientsPerAdvisor = asRange(config.clientsPerAdvisor ?? 2);
    this.portfoliosPerClient = asRange(config.accountsPerClient ?? 1); // accountsPerClient config maps to portfolios count
  }

  public generateGraphData(): IGraphData {
    const nodes: ISigmaNode[] = [];
    const edges: ISigmaEdge[] = [];

    // 1. Generate Hierarchy (Nodes & Structural Edges)
    let nodeIndex = 0;
    // Estimate totals for layout rings
    const estimatedTotal = this.advisorCount * 5 * 2 * 2; // rough estimate

    // Generate Advisors
    for (let i = 0; i < this.advisorCount; i++) {
        const name = DEFAULT_NAMES.advisors[i % DEFAULT_NAMES.advisors.length];
        const advisor = this.createAdvisor(name, nodeIndex++, estimatedTotal);
        this.advisors.push(advisor);

        // 1. Fixed Client "Wang Da Ming" for the first advisor
        if (i === 0) {
            const wangClient = this.createClient(advisor.id, nodeIndex++, estimatedTotal, "王大明");
            advisor.clients.push(wangClient);
            
            // Fixed Portfolio for Wang
            const wangPortfolio = this.createPortfolio(wangClient.id, nodeIndex++, estimatedTotal, "核心資產");
            wangClient.portfolios.push(wangPortfolio);

            // Fixed Bank A Account
            const bankAAccount = this.createAccount(wangPortfolio.id, nodeIndex++, estimatedTotal, "銀行A");
            wangPortfolio.accounts.push(bankAAccount);
            this.allAccounts.push(bankAAccount);
            this.hardcodedBankAAccounts.push(bankAAccount);

            // Random extra accounts for Wang
            const extraCount = randomInt({min: 1, max: 2});
            for(let k=0; k<extraCount; k++) {
                const acc = this.createAccount(wangPortfolio.id, nodeIndex++, estimatedTotal);
                wangPortfolio.accounts.push(acc);
                this.allAccounts.push(acc);
            }
        }

        // 2. Random Clients
        const clientCount = randomInt(this.clientsPerAdvisor);
        for (let j = 0; j < clientCount; j++) {
            const client = this.createClient(advisor.id, nodeIndex++, estimatedTotal);
            advisor.clients.push(client);

            // Random Portfolios
            const portfolioCount = randomInt(this.portfoliosPerClient);
            for (let p = 0; p < portfolioCount; p++) {
                const portfolio = this.createPortfolio(client.id, nodeIndex++, estimatedTotal);
                client.portfolios.push(portfolio);

                // Random Accounts
                const accountCount = randomInt({min: 1, max: 3});
                for(let k=0; k<accountCount; k++) {
                    const account = this.createAccount(portfolio.id, nodeIndex++, estimatedTotal);
                    portfolio.accounts.push(account);
                    this.allAccounts.push(account);
                }
            }
        }
    }

    // Flatten Hierarchy to Nodes & Edges
    this.advisors.forEach(ad => {
        nodes.push(ad.node);
        ad.clients.forEach(cl => {
            nodes.push(cl.node);
            edges.push(this.structuralEdge(ad.id, cl.id));
            cl.portfolios.forEach(pf => {
                nodes.push(pf.node);
                edges.push(this.structuralEdge(cl.id, pf.id));
                pf.accounts.forEach(acc => {
                    nodes.push(acc.node);
                    edges.push(this.structuralEdge(pf.id, acc.id));
                });
            });
        });
    });

    // 2. Generate Transactions
    // A. Fixed Transactions (Wang's Bank A -> Internal / External)
    this.hardcodedBankAAccounts.forEach(source => {
        // Internal Transaction (to another account in the system, e.g., Wang's other account or random)
        // Let's pick a random target from existing accounts (excluding self)
        const possibleTargets = this.allAccounts.filter(a => a.id !== source.id);
        if (possibleTargets.length > 0) {
            const target = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
            edges.push(this.transactionalEdge(source.id, target.id));
        }

        // External Transaction (to a new unknown node)
        const unknownId = uuidv4();
        const unknownNode: ISigmaNode = {
            id: unknownId,
            label: "外部帳戶",
            x: Math.random() * 2000, // Random pos
            y: Math.random() * 2000,
            color: "#94a3b8", // Grey
            size: 5,
            data: {
                label: "外部帳戶",
                metaData: {
                    businessType: "帳號",
                    accountNumber: faker.finance.accountNumber(12),
                    bankName: "他行",
                    ownerId: "UNKNOWN"
                }
            } as IPersonalAccountPayload
        };
        nodes.push(unknownNode);
        edges.push(this.transactionalEdge(source.id, unknownId));
    });

    // B. Random Transactions
    const randomTxCount = 10; // Generate some random noise
    for(let i=0; i<randomTxCount; i++) {
        if (this.allAccounts.length < 2) break;
        const source = this.allAccounts[Math.floor(Math.random() * this.allAccounts.length)];
        const target = this.allAccounts[Math.floor(Math.random() * this.allAccounts.length)];
        if (source.id !== target.id) {
            edges.push(this.transactionalEdge(source.id, target.id));
        }
    }

    // C. Guaranteed parallel edges: ensure 1~2 groups of (A -> B) with 3 edges each
    this.injectGuaranteedParallelTransactions(edges);

    return { nodes, edges };
  }

  // --- Creators ---

  private createAdvisor(name: string, nodeIndex: number, total: number): IHierarchicalAdvisor {
      const id = uuidv4();
      const { x, y } = circlePosition(nodeIndex, total, 200);
      return {
          id,
          clients: [],
          node: {
              id,
              label: name,
              x, y,
              data: {
                  label: name,
                  metaData: {
                      businessType: "理專",
                      personName: name,
                      jobTitle: "財富管理顧問",
                      department: "財管部",
                      responsibleArea: "台北",
                      taiwanId: `A${faker.string.numeric(9)}`
                  }
              } as IAdvisorPayload
          }
      };
  }

  private createClient(advisorId: string, nodeIndex: number, total: number, fixedName?: string): IHierarchicalClient {
    const id = uuidv4();
    const name = fixedName || faker.person.fullName();
    const { x, y } = circlePosition(nodeIndex, total, 400);
    return {
        id,
        portfolios: [],
        node: {
            id,
            label: name,
            x, y,
            data: {
                label: name,
                metaData: {
                    businessType: "客戶",
                    personName: name,
                    advisorId,
                    occupation: faker.person.jobTitle(),
                    companyName: faker.company.name(),
                    taiwanId: `B${faker.string.numeric(9)}`,
                    email: faker.internet.email()
                }
            } as IClientPayload
        }
    };
  }

  private createPortfolio(clientId: string, nodeIndex: number, total: number, fixedName?: string): IHierarchicalPortfolio {
      const id = uuidv4();
      const label = fixedName || `組合-${faker.string.alphanumeric(3).toUpperCase()}`;
      const { x, y } = circlePosition(nodeIndex, total, 600);
      return {
          id,
          accounts: [],
          ownerId: clientId,
          node: {
              id,
              label,
              x, y,
              data: {
                  label,
                  metaData: {
                      businessType: "投資組合",
                      portfolioId: `P-${faker.string.numeric(6)}`,
                      riskLevel: faker.helpers.arrayElement(["保守", "穩健", "積極"]),
                      ownerId: clientId
                  }
              } as IPortfolioPayload
          }
      };
  }

  private createAccount(portfolioId: string, nodeIndex: number, total: number, fixedBank?: string): IHierarchicalAccount {
      const id = uuidv4();
      const bank = fixedBank || faker.helpers.arrayElement(DEFAULT_NAMES.banks);
      const accNum = faker.finance.accountNumber(12);
      const { x, y } = circlePosition(nodeIndex, total, 800);
      return {
          id,
          ownerId: portfolioId,
          node: {
              id,
              label: accNum,
              x, y,
              data: {
                  label: accNum,
                  metaData: {
                      businessType: "帳號",
                      accountNumber: accNum,
                      bankName: bank,
                      ownerId: portfolioId
                  }
              } as IPersonalAccountPayload
          }
      };
  }

  // --- Edges ---

  private structuralEdge(source: string, target: string): ISigmaEdge {
    return {
      id: uuidv4(),
      source,
      target,
      data: { type: "structural" },
    };
  }

  private transactionalEdge(source: string, target: string): ISigmaEdge {
      return {
          id: uuidv4(),
          source,
          target,
          label: `$${faker.finance.amount()}`,
          data: {
              type: "transactional",
              metaData: {
                  amount: Number(faker.finance.amount()),
                  date: faker.date.recent({ days: 30 }).toISOString().split('T')[0],
                  description: "轉帳"
              }
          } as ITransactionalEdgePayload
      };
  }

  private injectGuaranteedParallelTransactions(edges: ISigmaEdge[]): void {
    const getPair = (pairIndex: number): { sourceId: string; targetId: string } | null => {
      if (this.advisors.length >= 2) {
        const sourceIdx = (pairIndex * 2) % this.advisors.length;
        const targetIdx = (sourceIdx + 1) % this.advisors.length;
        const sourceId = this.advisors[sourceIdx]?.id;
        const targetId = this.advisors[targetIdx]?.id;
        if (sourceId && targetId && sourceId !== targetId) return { sourceId, targetId };
      }

      if (this.allAccounts.length >= 2) {
        const source = this.allAccounts[Math.floor(Math.random() * this.allAccounts.length)];
        const candidates = this.allAccounts.filter((acc) => acc.id !== source.id);
        if (candidates.length === 0) return null;
        const target = candidates[Math.floor(Math.random() * candidates.length)];
        return { sourceId: source.id, targetId: target.id };
      }

      return null;
    };

    const makeGroup = (suffix: string, pairIndex: number): boolean => {
      const pair = getPair(pairIndex);
      if (!pair) return false;

      const created: ISigmaEdge[] = Array.from({ length: 3 }, (_v, index) => ({
        ...this.transactionalEdge(pair.sourceId, pair.targetId),
        label: `平行交易${suffix}-${index + 1}`,
        data: {
          type: "transactional",
          metaData: {
            amount: Number(faker.finance.amount()),
            date: faker.date.recent({ days: 30 }).toISOString().split("T")[0],
            description: `平行交易${suffix}-${index + 1}`,
          },
        } as ITransactionalEdgePayload,
      }));

      edges.push(...created);
      return true;
    };

    // Always at least 1 group
    makeGroup("A", 0);

    // Optionally add a 2nd group (only if enough accounts)
    if ((this.advisors.length >= 4 || this.allAccounts.length >= 4) && randomInt({ min: 0, max: 1 }) === 1) {
      makeGroup("B", 1);
    }
  }
}

// Helpers
function asNumber(input: number | IQuantityRange): number {
  if (typeof input === "number") return input;
  return input.min; 
}

function asRange(input: number | IQuantityRange): IQuantityRange {
    if (typeof input === "number") return { min: input, max: input };
    return input;
}

function randomInt(range: IQuantityRange): number {
    return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
}

function circlePosition(index: number, total: number, radius = 220) {
    const angle = (index / Math.max(1, total)) * Math.PI * 2;
    return {
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    };
  }
