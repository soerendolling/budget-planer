const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 3001;
const DB_PATH = path.join(__dirname, 'budget.db');

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname)); // Serve static files (like index.html)

// Database Setup
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDb();
    }
});

function initDb() {
    // Basic Table
    db.run(`CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        group_type TEXT,
        name TEXT,
        amount INTEGER,
        account TEXT,
        interval TEXT,
        category TEXT,
        is_security INTEGER,
        savings_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, () => {
        // Migration: Add new columns if they don't exist
        const columns = [
            'ALTER TABLE entries ADD COLUMN owner TEXT DEFAULT "main"',
            'ALTER TABLE entries ADD COLUMN paid_by TEXT DEFAULT "main"',
            'ALTER TABLE entries ADD COLUMN is_shared INTEGER DEFAULT 0',
            'ALTER TABLE entries ADD COLUMN linked_id TEXT'
        ];

        columns.forEach(col => {
            db.run(col, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.log('Migration note:', err.message);
                }
            });
        });
    });
}

// API Endpoints

// GET all entries
app.get('/api/entries', (req, res) => {
    let query = "SELECT * FROM entries";
    db.all(query, [], (err, rows) => {
        if (err) {
            res.status(400).json({ "error": err.message });
            return;
        }

        const state = {
            fixkosten: [],
            budget: [],
            income: [],
            savings: []
        };

        rows.forEach(row => {
            const entry = {
                id: row.id,
                name: row.name,
                amount: row.amount,
                account: row.account,
                owner: row.owner,
                paidBy: row.paid_by,
                isShared: !!row.is_shared,
                linkedId: row.linked_id
            };

            if (row.group_type === 'fixkosten') {
                entry.interval = row.interval;
                entry.category = row.category;
                entry.isSecurity = !!row.is_security;
                state.fixkosten.push(entry);
            } else if (row.group_type === 'budget') {
                state.budget.push(entry);
            } else if (row.group_type === 'income') {
                state.income.push(entry);
            } else if (row.group_type === 'savings') {
                entry.type = row.savings_type;
                state.savings.push(entry);
            }
        });

        res.json(state);
    });
});

// POST (Create or Update)
app.post('/api/entries', (req, res) => {
    const { id, type, data, isSplit } = req.body;

    // Determine values
    const owner = data.owner || 'main';
    const paidBy = data.paidBy || 'main';
    let amount = data.amount;

    // Split Logic: If split, we NO LONGER halve the amount for the main entry.
    // The main entry keeps the full amount (for bank reconciliation).
    // The partner entry will get half.
    if (isSplit) {
        // amount remains data.amount
    }

    // SQLite Booleans are 0/1
    const isSecurity = data.isSecurity ? 1 : 0;
    const isShared = (isSplit || data.isShared) ? 1 : 0;

    const stmt = db.prepare(`INSERT OR REPLACE INTO entries 
        (id, group_type, name, amount, account, interval, category, is_security, savings_type, owner, paid_by, is_shared, linked_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    // 1. Run Main Insert
    stmt.run(
        id, type, data.name, amount, data.account,
        data.interval || null, data.category || null,
        isSecurity, data.type || null,
        owner, paidBy, isShared, data.linkedId || null,
        function (err) {
            if (err) {
                res.status(400).json({ "error": err.message });
                return;
            }

            // 2. If Split, create Partner Entry
            if (isSplit) {
                const partnerId = id + '_partner';
                const otherOwner = owner === 'main' ? 'partner' : 'main';

                // Partner entry mirrors main entry but with half amount and linked_id
                // Note: paid_by remains whoever paid the original amount!
                stmt.run(
                    partnerId, type, data.name, Math.round(amount / 2), data.account,
                    data.interval || null, data.category || null,
                    isSecurity, data.type || null,
                    otherOwner, paidBy, 1, id, // linked to primary
                    (err) => {
                        if (err) console.error("Error creating split entry:", err);
                        stmt.finalize();
                        res.json({ "message": "success", "id": id });
                    }
                );
            } else {
                // If NOT split (anymore), ensure any existing partner entry is removed
                // and the current entry is marked as not shared
                const partnerId = id + '_partner';
                db.run("DELETE FROM entries WHERE id = ?", partnerId, (err) => {
                    if (err) console.error("Error deleting partner entry:", err);
                    stmt.finalize();
                    res.json({ "message": "success", "id": id });
                });
            }
        }
    );
});

// DELETE
app.delete('/api/entries/:id', (req, res) => {
    // Delete the entry AND any entry linked to it (cascade delete for split entries)
    db.run("DELETE FROM entries WHERE id = ? OR linked_id = ?", [req.params.id, req.params.id], function (err) {
        if (err) {
            res.status(400).json({ "error": err.message });
            return;
        }
        res.json({ message: "deleted", changes: this.changes });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
