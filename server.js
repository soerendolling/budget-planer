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
    )`);
}

// API Endpoints

// GET all entries
app.get('/api/entries', (req, res) => {
    db.all("SELECT * FROM entries", [], (err, rows) => {
        if (err) {
            res.status(400).json({ "error": err.message });
            return;
        }

        // Transform flat list back into structured state object
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
                account: row.account
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
    const { id, type, data } = req.body;

    // Check if entry exists to determine INSERT vs UPDATE
    // For simplicity with the existing frontend logic that sends the whole entry,
    // we can use REPLACE INTO or INSERT OR REPLACE.

    const isSecurity = data.isSecurity ? 1 : 0;

    const sql = `INSERT OR REPLACE INTO entries 
                 (id, group_type, name, amount, account, interval, category, is_security, savings_type) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const params = [
        data.id,
        type,
        data.name,
        data.amount,
        data.account,
        data.interval || null,
        data.category || null,
        isSecurity,
        data.type || null // savings type
    ];

    db.run(sql, params, function (err) {
        if (err) {
            res.status(400).json({ "error": err.message });
            return;
        }
        res.json({
            "message": "success",
            "data": data,
            "id": this.lastID
        });
    });
});

// DELETE
app.delete('/api/entries/:id', (req, res) => {
    db.run("DELETE FROM entries WHERE id = ?", req.params.id, function (err) {
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
