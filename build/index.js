import { createUIResource } from "@mcp-ui/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Database from "better-sqlite3";
import { z } from "zod";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// Initialize database
const db = new Database("transactions.db");
// Ensure table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS txn (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT CHECK(type IN ('income', 'expense')),
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    date TEXT NOT NULL
  )
`);
// Initialize MCP server
const server = new McpServer({
    name: "node-explase",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
// Register tool for adding transactions
server.registerTool("addTransaction", {
    description: "Add a new transaction (income or expense)",
    inputSchema: {
        type: z.enum(["income", "expense"]).describe("Type of transaction"),
        amount: z.number().positive().describe("Transaction amount (must be positive)"),
        category: z.string().describe("Transaction category"),
        description: z.string().optional().describe("Optional transaction description"),
        date: z.string().describe("Transaction date in ISO format"),
    },
}, async ({ type, amount, category, description, date }) => {
    const stmt = db.prepare("INSERT INTO txn (type, amount, category, description, date) VALUES (?, ?, ?, ?, ?)");
    const result = stmt.run(type, amount, category, description || null, new Date(date).toISOString());
    return {
        content: [
            {
                type: "text",
                text: `Transaction added with ID: ${result.lastInsertRowid}`,
            },
        ],
    };
});
// Register tool for listing/querying transactions
server.registerTool("listTransactions", {
    description: "List and filter transactions from the database",
    inputSchema: {
        type: z.enum(["income", "expense"]).optional(),
        category: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        limit: z.number().positive().optional(),
    },
}, async ({ type, category, startDate, endDate, limit }) => {
    let query = "SELECT * FROM txn WHERE 1=1";
    const params = [];
    if (type) {
        query += " AND type = ?";
        params.push(type);
    }
    if (category) {
        query += " AND category = ?";
        params.push(category);
    }
    if (startDate) {
        query += " AND date >= ?";
        params.push(new Date(startDate).toISOString());
    }
    if (endDate) {
        query += " AND date <= ?";
        params.push(new Date(endDate).toISOString());
    }
    query += " ORDER BY date DESC";
    if (limit) {
        query += " LIMIT ?";
        params.push(limit);
    }
    const stmt = db.prepare(query);
    const rows = stmt.all(...params);
    // ✅ Build HTML table for UI
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px;">
        <div style="background: white; border-radius: 8px; padding: 24px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <h2 style="margin: 0 0 20px; color: #1a202c; font-size: 24px; font-weight: 600;">
            📊 Transaction List
          </h2>
          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; background: white;">
              <thead>
                <tr style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                  <th style="padding: 12px 16px; text-align: left; font-weight: 600; border-bottom: 2px solid #e2e8f0;">ID</th>
                  <th style="padding: 12px 16px; text-align: left; font-weight: 600; border-bottom: 2px solid #e2e8f0;">Type</th>
                  <th style="padding: 12px 16px; text-align: right; font-weight: 600; border-bottom: 2px solid #e2e8f0;">Amount</th>
                  <th style="padding: 12px 16px; text-align: left; font-weight: 600; border-bottom: 2px solid #e2e8f0;">Category</th>
                  <th style="padding: 12px 16px; text-align: left; font-weight: 600; border-bottom: 2px solid #e2e8f0;">Description</th>
                  <th style="padding: 12px 16px; text-align: left; font-weight: 600; border-bottom: 2px solid #e2e8f0;">Date</th>
                </tr>
              </thead>
              <tbody>
                ${rows.length
        ? rows
            .map((r, idx) => `
                    <tr style="background: ${idx % 2 === 0 ? '#f7fafc' : 'white'}; transition: background 0.2s;">
                      <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">#${r.id}</td>
                      <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0;">
                        <span style="display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; background: ${r.type === 'income' ? '#c6f6d5' : '#fed7d7'}; color: ${r.type === 'income' ? '#22543d' : '#742a2a'};">
                          ${r.type === 'income' ? '💰 Income' : '💸 Expense'}
                        </span>
                      </td>
                      <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600; color: ${r.type === 'income' ? '#38a169' : '#e53e3e'};">
                        ${r.type === 'income' ? '+' : '-'}$${r.amount.toFixed(2)}
                      </td>
                      <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; color: #4a5568;">
                        <span style="background: #edf2f7; padding: 4px 8px; border-radius: 6px; font-size: 13px;">${r.category}</span>
                      </td>
                      <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; color: #718096;">${r.description || '—'}</td>
                      <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; color: #718096; font-size: 13px;">${new Date(r.date).toLocaleDateString()}</td>
                    </tr>`)
            .join("")
        : `<tr><td colspan="6" style="padding: 40px; text-align: center; color: #a0aec0; font-size: 16px;">
                        <div>📭</div>
                        <div style="margin-top: 8px;">No transactions found</div>
                      </td></tr>`}
              </tbody>
            </table>
          </div>
          ${rows.length > 0 ? `<div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #718096; font-size: 14px; text-align: right;">
            Total: ${rows.length} transaction${rows.length !== 1 ? 's' : ''}
          </div>` : ''}
        </div>
      </div>
    `;
    const resource = createUIResource({
        uri: "ui://txn-list/main",
        content: { type: "rawHtml", htmlString: html },
        encoding: "text"
    });
    // Convert to standard MCP CallToolResult format
    return {
        content: [
            {
                type: "resource",
                resource: resource.resource,
            },
        ],
        _meta: { "openai/outputTemplate": "ui://txn-list/main" }
    };
});
// Register tool for getting transaction summary
server.registerTool("getTransactionSummary", {
    description: "Get summary of total income, expenses, and balance",
    inputSchema: {},
}, async () => {
    const incomeStmt = db.prepare("SELECT SUM(amount) as total FROM txn WHERE type = 'income'");
    const expenseStmt = db.prepare("SELECT SUM(amount) as total FROM txn WHERE type = 'expense'");
    const income = incomeStmt.get();
    const expense = expenseStmt.get();
    const summary = {
        totalIncome: income.total || 0,
        totalExpense: expense.total || 0,
        balance: (income.total || 0) - (expense.total || 0),
    };
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(summary, null, 2),
            },
        ],
    };
});
// Register tool for deleting transactions
server.registerTool("deleteTransaction", {
    description: "Delete transaction(s) by ID, category, date range, or type. Supports single or bulk deletion.",
    inputSchema: {
        id: z.number().positive().optional().describe("Delete specific transaction by ID"),
        ids: z.array(z.number().positive()).optional().describe("Delete multiple transactions by IDs"),
        category: z.string().optional().describe("Delete all transactions in a category"),
        type: z.enum(["income", "expense"]).optional().describe("Delete all transactions of a specific type"),
        startDate: z.string().optional().describe("Delete transactions from this date onwards (ISO format)"),
        endDate: z.string().optional().describe("Delete transactions up to this date (ISO format)"),
        olderThan: z.string().optional().describe("Delete transactions older than this date (ISO format)"),
        confirmBulk: z.boolean().optional().describe("Required confirmation for bulk deletions (must be true)")
    },
}, async ({ id, ids, category, type, startDate, endDate, olderThan, confirmBulk }) => {
    // Validate input combinations
    const filters = [id, ids, category, type, startDate, endDate, olderThan].filter(f => f !== undefined);
    if (filters.length === 0) {
        return {
            content: [
                {
                    type: "text",
                    text: "❌ Error: You must specify at least one deletion criterion (id, ids, category, type, date range, or olderThan).",
                },
            ],
        };
    }
    // Single ID deletion (no bulk confirmation needed)
    if (id && filters.length === 1) {
        const checkStmt = db.prepare("SELECT * FROM txn WHERE id = ?");
        const existing = checkStmt.get(id);
        if (!existing) {
            return {
                content: [
                    {
                        type: "text",
                        text: `❌ Transaction with ID ${id} not found.`,
                    },
                ],
            };
        }
        const deleteStmt = db.prepare("DELETE FROM txn WHERE id = ?");
        deleteStmt.run(id);
        return {
            content: [
                {
                    type: "text",
                    text: `✅ Successfully deleted transaction #${id} (${existing.type}, $${existing.amount}, ${existing.category})`,
                },
            ],
        };
    }
    // Multiple IDs deletion
    if (ids && ids.length > 0) {
        if (!confirmBulk) {
            const previewStmt = db.prepare(`SELECT * FROM txn WHERE id IN (${ids.map(() => '?').join(',')})`);
            const preview = previewStmt.all(...ids);
            return {
                content: [
                    {
                        type: "text",
                        text: `⚠️ Bulk deletion requires confirmation!\n\n` +
                            `You are about to delete ${preview.length} transaction(s):\n` +
                            preview.map(t => `- #${t.id}: ${t.type} $${t.amount} (${t.category})`).join('\n') +
                            `\n\nTo proceed, set "confirmBulk": true`,
                    },
                ],
            };
        }
        const deleteStmt = db.prepare(`DELETE FROM txn WHERE id IN (${ids.map(() => '?').join(',')})`);
        const result = deleteStmt.run(...ids);
        return {
            content: [
                {
                    type: "text",
                    text: `✅ Successfully deleted ${result.changes} transaction(s) with IDs: ${ids.join(', ')}`,
                },
            ],
        };
    }
    // Build dynamic query for bulk deletion
    let query = "SELECT * FROM txn WHERE 1=1";
    const params = [];
    if (category) {
        query += " AND category = ?";
        params.push(category);
    }
    if (type) {
        query += " AND type = ?";
        params.push(type);
    }
    if (startDate) {
        query += " AND date >= ?";
        params.push(new Date(startDate).toISOString());
    }
    if (endDate) {
        query += " AND date <= ?";
        params.push(new Date(endDate).toISOString());
    }
    if (olderThan) {
        query += " AND date < ?";
        params.push(new Date(olderThan).toISOString());
    }
    // Preview matching transactions
    const previewStmt = db.prepare(query);
    const matchingTransactions = previewStmt.all(...params);
    if (matchingTransactions.length === 0) {
        return {
            content: [
                {
                    type: "text",
                    text: "❌ No transactions match the specified criteria.",
                },
            ],
        };
    }
    // Require confirmation for bulk deletion
    if (!confirmBulk) {
        const totalAmount = matchingTransactions.reduce((sum, t) => sum + t.amount, 0);
        const breakdown = {
            income: matchingTransactions.filter(t => t.type === 'income').length,
            expense: matchingTransactions.filter(t => t.type === 'expense').length,
        };
        return {
            content: [
                {
                    type: "text",
                    text: `⚠️ **Bulk Deletion Confirmation Required**\n\n` +
                        `Matching transactions: **${matchingTransactions.length}**\n` +
                        `- Income: ${breakdown.income}\n` +
                        `- Expense: ${breakdown.expense}\n` +
                        `- Total amount: $${totalAmount.toFixed(2)}\n\n` +
                        `**Criteria:**\n` +
                        (category ? `- Category: ${category}\n` : '') +
                        (type ? `- Type: ${type}\n` : '') +
                        (startDate ? `- Start Date: ${startDate}\n` : '') +
                        (endDate ? `- End Date: ${endDate}\n` : '') +
                        (olderThan ? `- Older Than: ${olderThan}\n` : '') +
                        `\n**Preview (first 5):**\n` +
                        matchingTransactions.slice(0, 5).map(t => `- #${t.id}: ${t.type} $${t.amount} (${t.category}) - ${new Date(t.date).toLocaleDateString()}`).join('\n') +
                        (matchingTransactions.length > 5 ? `\n... and ${matchingTransactions.length - 5} more` : '') +
                        `\n\n🔴 **To confirm deletion, set "confirmBulk": true**`,
                },
            ],
        };
    }
    // Execute bulk deletion
    const deleteQuery = query.replace("SELECT *", "DELETE");
    const deleteStmt = db.prepare(deleteQuery);
    const result = deleteStmt.run(...params);
    return {
        content: [
            {
                type: "text",
                text: `✅ Successfully deleted ${result.changes} transaction(s)\n\n` +
                    `**Deleted transactions:**\n` +
                    matchingTransactions.slice(0, 10).map(t => `- #${t.id}: ${t.type} $${t.amount} (${t.category})`).join('\n') +
                    (matchingTransactions.length > 10 ? `\n... and ${matchingTransactions.length - 10} more` : ''),
            },
        ],
    };
});
// Register tool for visualizing transactions as a chart
server.registerTool("visualizeTransactions", {
    description: "Visualize transactions as interactive charts (bar chart, pie chart, or line chart)",
    inputSchema: {
        chartType: z.enum(["bar", "pie", "line"]).optional().describe("Type of chart to generate (default: bar)"),
        groupBy: z.enum(["day", "week", "month", "category"]).optional().describe("How to group the data (default: month)"),
    },
}, async ({ chartType = "bar", groupBy = "month" }) => {
    const rows = db.prepare("SELECT * FROM txn ORDER BY date ASC").all();
    let chartData = {};
    let labels = [];
    let incomeData = [];
    let expenseData = [];
    if (groupBy === "category") {
        // Group by category
        const categoryMap = new Map();
        rows.forEach(r => {
            if (!categoryMap.has(r.category)) {
                categoryMap.set(r.category, { income: 0, expense: 0 });
            }
            const cat = categoryMap.get(r.category);
            if (r.type === "income") {
                cat.income += r.amount;
            }
            else {
                cat.expense += r.amount;
            }
        });
        labels = Array.from(categoryMap.keys());
        incomeData = labels.map(l => categoryMap.get(l).income);
        expenseData = labels.map(l => categoryMap.get(l).expense);
    }
    else {
        // Group by time period
        const timeMap = new Map();
        rows.forEach(r => {
            const date = new Date(r.date);
            let key = "";
            if (groupBy === "day") {
                key = date.toISOString().split("T")[0];
            }
            else if (groupBy === "week") {
                const weekNum = Math.floor(date.getDate() / 7) + 1;
                key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-W${weekNum}`;
            }
            else {
                key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
            }
            if (!timeMap.has(key)) {
                timeMap.set(key, { income: 0, expense: 0 });
            }
            const period = timeMap.get(key);
            if (r.type === "income") {
                period.income += r.amount;
            }
            else {
                period.expense += r.amount;
            }
        });
        labels = Array.from(timeMap.keys()).sort();
        incomeData = labels.map(l => timeMap.get(l).income);
        expenseData = labels.map(l => timeMap.get(l).expense);
    }
    // Calculate totals for pie chart
    const totalIncome = incomeData.reduce((a, b) => a + b, 0);
    const totalExpense = expenseData.reduce((a, b) => a + b, 0);
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px;">
        <div style="background: white; border-radius: 8px; padding: 24px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <h2 style="margin: 0 0 20px; color: #1a202c; font-size: 24px; font-weight: 600;">
            📈 Transaction Visualization
          </h2>
          <div style="background: #f7fafc; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
            <canvas id="transactionChart" width="400" height="200"></canvas>
          </div>
          <div style="display: flex; gap: 16px; justify-content: center;">
            <div style="text-align: center; padding: 12px; background: #c6f6d5; border-radius: 8px; flex: 1;">
              <div style="color: #22543d; font-size: 14px; font-weight: 600;">Total Income</div>
              <div style="color: #22543d; font-size: 24px; font-weight: 700; margin-top: 4px;">$${totalIncome.toFixed(2)}</div>
            </div>
            <div style="text-align: center; padding: 12px; background: #fed7d7; border-radius: 8px; flex: 1;">
              <div style="color: #742a2a; font-size: 14px; font-weight: 600;">Total Expense</div>
              <div style="color: #742a2a; font-size: 24px; font-weight: 700; margin-top: 4px;">$${totalExpense.toFixed(2)}</div>
            </div>
            <div style="text-align: center; padding: 12px; background: ${totalIncome - totalExpense >= 0 ? '#bee3f8' : '#fbb6ce'}; border-radius: 8px; flex: 1;">
              <div style="color: ${totalIncome - totalExpense >= 0 ? '#2c5282' : '#97266d'}; font-size: 14px; font-weight: 600;">Net Balance</div>
              <div style="color: ${totalIncome - totalExpense >= 0 ? '#2c5282' : '#97266d'}; font-size: 24px; font-weight: 700; margin-top: 4px;">$${(totalIncome - totalExpense).toFixed(2)}</div>
            </div>
          </div>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
      <script>
        const ctx = document.getElementById('transactionChart').getContext('2d');
        
        ${chartType === "pie" ? `
        new Chart(ctx, {
          type: 'pie',
          data: {
            labels: ['Income', 'Expense'],
            datasets: [{
              data: [${totalIncome}, ${totalExpense}],
              backgroundColor: ['#48bb78', '#f56565'],
              borderColor: ['#38a169', '#e53e3e'],
              borderWidth: 2
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  font: { size: 14, weight: '600' },
                  padding: 16
                }
              },
              tooltip: {
                callbacks: {
                  label: function(context) {
                    return context.label + ': $' + context.parsed.toFixed(2);
                  }
                }
              }
            }
          }
        });
        ` : `
        new Chart(ctx, {
          type: '${chartType}',
          data: {
            labels: ${JSON.stringify(labels)},
            datasets: [
              {
                label: 'Income',
                data: ${JSON.stringify(incomeData)},
                backgroundColor: 'rgba(72, 187, 120, 0.8)',
                borderColor: '#38a169',
                borderWidth: 2,
                ${chartType === "line" ? "tension: 0.4, fill: true," : ""}
              },
              {
                label: 'Expense',
                data: ${JSON.stringify(expenseData)},
                backgroundColor: 'rgba(245, 101, 101, 0.8)',
                borderColor: '#e53e3e',
                borderWidth: 2,
                ${chartType === "line" ? "tension: 0.4, fill: true," : ""}
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'top',
                labels: {
                  font: { size: 14, weight: '600' },
                  padding: 16
                }
              },
              tooltip: {
                callbacks: {
                  label: function(context) {
                    return context.dataset.label + ': $' + context.parsed.y.toFixed(2);
                  }
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: {
                  callback: function(value) {
                    return '$' + value.toFixed(0);
                  }
                }
              },
              x: {
                ticks: {
                  maxRotation: 45,
                  minRotation: 45
                }
              }
            }
          }
        });
        `}
      </script>
    `;
    const resource = createUIResource({
        uri: "ui://txn-chart/main",
        content: { type: "rawHtml", htmlString: html },
        encoding: "text"
    });
    return {
        content: [
            {
                type: "resource",
                resource: resource.resource,
            },
        ],
        _meta: { "openai/outputTemplate": "ui://txn-chart/main" }
    };
});
// Register resource for raw database data (testing/debugging)
server.registerResource("Raw Database Data", "transaction://raw-data", {
    description: "Raw JSON data of all transactions from the database (for testing/debugging)",
    mimeType: "application/json",
}, async () => {
    const rows = db.prepare("SELECT * FROM txn ORDER BY date DESC").all();
    const metadata = {
        total_transactions: rows.length,
        total_income: rows.filter(r => r.type === 'income').reduce((sum, r) => sum + r.amount, 0),
        total_expense: rows.filter(r => r.type === 'expense').reduce((sum, r) => sum + r.amount, 0),
        categories: [...new Set(rows.map(r => r.category))],
        date_range: {
            earliest: rows.length > 0 ? rows[rows.length - 1].date : null,
            latest: rows.length > 0 ? rows[0].date : null,
        },
    };
    const data = {
        metadata,
        transactions: rows,
    };
    return {
        contents: [
            {
                uri: "transaction://raw-data",
                mimeType: "application/json",
                text: JSON.stringify(data, null, 2),
            },
        ],
    };
});
const app = express();
app.use(express.json());
app.post('/mcp', async (req, res) => {
    try {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true
        });
        res.on('close', () => {
            transport.close();
            server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    }
    catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal server error'
                },
                id: null
            });
        }
    }
});
const port = parseInt(process.env.PORT || '8080');
app.listen(port, () => {
    console.log(`Demo MCP Server running on http://localhost:${port}/mcp`);
}).on('error', error => {
    console.error('Server error:', error);
    process.exit(1);
});
