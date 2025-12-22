// State management
let state = {
    fixkosten: [],
    budget: [],
    income: [],
    savings: [],
    accounts: []
};

// Partner Mode State
let currentView = 'main'; // 'main', 'partner', 'combined'

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    initEventListeners();
});

async function loadData() {
    try {
        // Load Accounts First
        const accResponse = await fetch('http://localhost:3001/api/accounts');
        if (accResponse.ok) {
            state.accounts = await accResponse.json();
        }

        const response = await fetch('http://localhost:3001/api/entries');
        if (!response.ok) throw new Error('Failed to load data');
        const data = await response.json();

        // Merge entries into state
        state.fixkosten = data.fixkosten;
        state.budget = data.budget;
        state.income = data.income;
        state.savings = data.savings;

        updateDashboard();
    } catch (err) {
        console.error('Error loading data:', err);
    }
}

// saveData is removed as we now save per-action via API calls


function initEventListeners() {
    document.getElementById('entryForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('exportBtn').addEventListener('click', exportData);
    document.getElementById('importBtn').addEventListener('change', importData);

    document.getElementById('accountForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('accId').value || Date.now().toString();
        const name = document.getElementById('accName').value;
        const owner = document.getElementById('accOwner').value;
        const iban = document.getElementById('accIban').value;

        try {
            await fetch('http://localhost:3001/api/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, name, owner, iban })
            });
            await loadData();
            renderAccountMgmtList();
            document.getElementById('accountForm').reset();
            document.getElementById('accId').value = '';
        } catch (err) {
            console.error(err);
        }
    });
}

// View Switching
window.switchView = function (view) {
    currentView = view;

    // Update Buttons
    document.querySelectorAll('.btn-view').forEach(btn => btn.classList.remove('active'));
    const btnId = 'view' + view.charAt(0).toUpperCase() + view.slice(1);
    document.getElementById(btnId).classList.add('active');

    // Show/Hide Settlement
    const settlementCard = document.getElementById('settlementCard');
    if (settlementCard) {
        settlementCard.style.display = view === 'combined' ? 'block' : 'none';
    }

    updateDashboard();
}

function getFilteredState(listName) {
    const list = state[listName] || [];
    if (currentView === 'combined') {
        // In Combined View, we only want to see the "Source" transaction (Full Amount).
        // Any entry with a linkedId is a split/derivative (representing a share), so we hide it.
        // This works for both:
        // 1. Persona-paid Splits: Source (100%) has linkedId=null. Split (50%) has linkedId.
        // 2. Shared-Account Splits: Master (100%) has linkedId=null. Shares (50%) have linkedId.
        return list.filter(item => !item.linkedId);
    }
    return list.filter(item => item.owner === currentView);
}


// Precision helper (cents)
const toCents = (val) => Math.round(parseFloat(val.toString().replace(',', '.')) * 100);
const fromCents = (val) => (val / 100).toFixed(2).replace('.', ',');

// Dashboard Updates
let budgetChart = null;

function updateDashboard() {
    const summary = calculateSummary();

    document.getElementById('totalSecurity').textContent = fromCents(summary.security) + ' €';
    document.getElementById('yearSecurity').textContent = fromCents(summary.security * 12) + ' €';

    document.getElementById('totalFixed').textContent = fromCents(summary.fixed) + ' €';
    document.getElementById('yearFixed').textContent = fromCents(summary.fixed * 12) + ' €';

    document.getElementById('totalLife').textContent = fromCents(summary.life) + ' €';
    document.getElementById('yearLife').textContent = fromCents(summary.life * 12) + ' €';

    document.getElementById('totalWealth').textContent = fromCents(summary.wealth) + ' €';
    document.getElementById('yearWealth').textContent = fromCents(summary.wealth * 12) + ' €';

    document.getElementById('totalBuffer').textContent = fromCents(summary.buffer) + ' €';
    document.getElementById('yearBuffer').textContent = fromCents(summary.buffer * 12) + ' €';

    updateChart(summary);
    renderTables();
    renderAccountOverview();
}

function calculateSummary() {
    let security = 0;
    let fixed = 0;
    let life = 0;
    let wealth = 0;
    let income = 0;

    // Use Filtered Data for Summary
    getFilteredState('fixkosten').forEach(item => {
        let monthly = item.amount;
        if (item.interval === 'Halbjährlich') monthly = Math.round(item.amount / 6);
        if (item.interval === 'Jährlich') monthly = Math.round(item.amount / 12);

        // Logic Change for Shared Entries:
        // If it is a shared entry AND it is the main/source entry (no linkedId),
        // AND it is NOT a 'shared' account entry (which is 100% shared expense),
        // we count HALF (your share).
        // Partner entries (linkedId exists) are already halved in the DB.
        if (item.isShared && !item.linkedId && item.owner !== 'shared') {
            monthly = Math.round(monthly / 2);
        }

        // Security is now determined by category 'Versicherung'
        if (item.category === 'Versicherung') security += monthly;
        else fixed += monthly;
    });

    getFilteredState('budget').forEach(item => life += item.amount);
    getFilteredState('savings').forEach(item => wealth += item.amount);
    getFilteredState('income').forEach(item => income += item.amount);

    // Settlement Calculation (only relevant for Combined View)
    if (currentView === 'combined') {
        calculateSettlement();
    }

    return {
        security,
        fixed,
        life,
        wealth,
        buffer: income - (security + fixed + life + wealth)
    };
}

function calculateSettlement() {
    let partnerOwesMain = 0;
    let mainOwesPartner = 0;

    // Iterate over ALL entries to find cross-payments
    ['fixkosten', 'budget', 'income', 'savings'].forEach(type => {
        state[type].forEach(entry => {
            // Check if account is shared (no debt if paid from shared)
            if (isSharedAccount(entry.account)) return;

            // Case 1: Partner's entry paid by Main
            if (entry.owner === 'partner' && entry.paidBy === 'main') {
                partnerOwesMain += entry.amount;
            }
            // Case 2: Main's entry paid by Partner
            if (entry.owner === 'main' && entry.paidBy === 'partner') {
                mainOwesPartner += entry.amount;
            }
        });
    });

    const diff = partnerOwesMain - mainOwesPartner;
    const settlementEl = document.getElementById('totalSettlement');
    const settlementText = document.getElementById('settlementText');

    settlementEl.textContent = fromCents(Math.abs(diff)) + ' €';

    if (diff > 0) {
        settlementText.textContent = 'Partnerin schuldet dir';
        settlementEl.style.color = '#30d158'; // Green (receiving)
    } else if (diff < 0) {
        settlementText.textContent = 'Du schuldest Partnerin';
        settlementEl.style.color = '#ff453a'; // Red (paying)
    } else {
        settlementText.textContent = 'Ausgeglichen';
        settlementEl.style.color = 'inherit';
    }
}

// Account Overview Logic
function calculateAccountBalances() {
    const balances = {};
    const processItem = (item, type) => {
        // Skip shared entries if they are just placeholders (though logic below handles amounts correctly)
        // Similar filter logic as calculateSummary but per account

        let monthly = item.amount;
        if (item.interval === 'Halbjährlich') monthly = Math.round(item.amount / 6);
        if (item.interval === 'Jährlich') monthly = Math.round(item.amount / 12);

        // Check if this entry represents a Real Bank Transaction for the current view
        // 1. If it's a Shared Account: Everyone counts their share (liability to the pot).
        // 2. If it's a Personal Account: Only the Payer (Primary Entry) counts the expense.
        //    The Receiver (Linked Entry) filters out because it's just a budget shadow, not a bank hit.

        // Fix: Use helper function as SHARED_ACCOUNTS constant was removed
        const isShared = isSharedAccount(item.account);

        if (!isShared && item.linkedId) {
            // It's a shadow entry on a personal account (e.g. Partner's split share of a dinner I paid).
            // It does not hit the Partner's bank account directly.
            return;
        }

        if (!balances[item.account]) {
            balances[item.account] = { income: 0, expenses: 0 };
        }

        if (type === 'income') {
            balances[item.account].income += monthly;
        } else {
            balances[item.account].expenses += monthly;
        }
    };

    getFilteredState('fixkosten').forEach(i => processItem(i, 'fixkosten'));
    getFilteredState('budget').forEach(i => processItem(i, 'budget'));
    getFilteredState('income').forEach(i => processItem(i, 'income'));
    getFilteredState('savings').forEach(i => processItem(i, 'savings'));

    return balances;
}

function renderAccountOverview() {
    const balances = calculateAccountBalances();
    const container = document.getElementById('accountCards');

    // Ensure container has list styling class
    container.className = 'account-list-container';
    container.innerHTML = '';

    const sortedAccounts = Object.keys(balances).sort();

    sortedAccounts.forEach(accountName => {
        const { expenses } = balances[accountName];

        // Show only accounts that have expenses (> 0)
        if (expenses <= 0) return;

        // Skip 'Unzugeordnet' from the Bank Account View
        if (accountName === 'Unzugeordnet') return;

        // Find account details for IBAN
        const accDetails = state.accounts.find(a => a.name === accountName);
        let ibanDisplay = '';
        if (accDetails && accDetails.iban && accDetails.iban.length > 4) {
            ibanDisplay = `<span style="font-family:monospace; color:#888; font-size:0.8rem; margin-left:8px;">*${accDetails.iban.slice(-5)}</span>`;
        }

        const row = document.createElement('div');
        row.className = 'account-list-item';

        row.innerHTML = `
            <div style="display:flex; align-items:center;">
                <span class="account-name">${accountName}</span>
                ${ibanDisplay}
            </div>
            <span class="account-result negative">
                -${fromCents(expenses)} €
            </span>
        `;
        container.appendChild(row);
    });
}


function updateChart(summary) {
    const ctx = document.getElementById('budgetChart').getContext('2d');
    const data = [
        summary.security / 100,
        summary.fixed / 100,
        summary.life / 100,
        summary.wealth / 100,
        Math.max(0, summary.buffer / 100)
    ];

    if (budgetChart) {
        budgetChart.data.datasets[0].data = data;
        budgetChart.update();
    } else {
        budgetChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Sicherheit', 'Fixkosten', 'Leben', 'Vermögen', 'Puffer'],
                datasets: [{
                    data: data,
                    backgroundColor: ['#5e5ce6', '#ff9f0a', '#a2a2ff', '#30d158', '#1d1d1f'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
    }
}

// Table Rendering
function renderTables() {
    renderTable('fixkosten', ['name', 'amount', 'interval', 'category', 'account']);
    renderTable('budget', ['name', 'amount', 'account']);
    renderTable('income', ['name', 'amount', 'account']);
    renderTable('savings', ['name', 'amount', 'type', 'account']);
}

function renderTable(type, fields) {
    const tbody = document.querySelector(`#${type}Table tbody`);
    tbody.innerHTML = '';

    getFilteredState(type).forEach(item => {

        const tr = document.createElement('tr');
        fields.forEach(field => {
            const td = document.createElement('td');
            if (field === 'amount') {
                let displayAmountCode = item.amount;
                let shareAmount = null;

                if (item.isShared) {
                    if (item.linkedId) {
                        // Linked Entry (e.g. Partner seeing split, or Shared Account part)
                        // DB Amount is the Share (50%). Display Full Amount (100%).
                        displayAmountCode = item.amount * 2;
                        shareAmount = item.amount;
                    } else if (item.owner !== 'shared') {
                        // Payer Entry (Main)
                        // DB Amount is Full (100%). Share is 50%.
                        displayAmountCode = item.amount;
                        shareAmount = Math.round(item.amount / 2);
                    }
                }

                let text = fromCents(displayAmountCode) + ' €';

                // Show Anteil if applicable and NOT in Combined View
                if (shareAmount !== null && currentView !== 'combined') {
                    text += `<div class="amount-detail">Anteil: ${fromCents(shareAmount)} €</div>`;
                }

                td.innerHTML = text;
            } else if (field === 'isSecurity') {
                td.textContent = item[field] ? 'Ja' : 'Nein';
            } else if (field === 'account') {
                if (item[field] === 'Unzugeordnet') {
                    td.innerHTML = `<span class="badge-warning">⚠️ Unzugeordnet</span>`;
                } else {
                    td.textContent = item[field];
                }
            } else {
                td.textContent = item[field];
            }
            tr.appendChild(td);
        });

        const actionsTd = document.createElement('td');

        let deleteBtn = '';
        const isLinked = !!item.linkedId;

        // Delete Restriction Logic
        // 1. Linked Entry -> Always Disabled (Standard)
        // 2. Combined View -> Only allow delete if owner is 'shared'
        let canDelete = true;
        let deleteTitle = '';

        if (isLinked) {
            canDelete = false;
            deleteTitle = `Teil einer geteilten Ausgabe. Haupteintrag unter: ${getMainEntryLocation(type, item.linkedId)}`;
        } else if (currentView === 'combined' && item.owner !== 'shared') {
            canDelete = false;
            const ownerName = item.owner === 'main' ? 'Ich' : 'Partnerin';
            deleteTitle = `Dieser Eintrag gehört zu ${ownerName}. Löschen nur in der jeweiligen Ansicht möglich.`;
        }

        if (canDelete) {
            deleteBtn = `<button class="btn-danger" onclick="deleteEntry('${type}', '${item.id}')">DEL</button>`;
        } else {
            deleteBtn = `<button class="btn-danger" style="opacity: 0.3; cursor: not-allowed;" title="${deleteTitle}">DEL</button>`;
        }

        actionsTd.innerHTML = `
            <button class="btn-secondary" onclick="editEntry('${type}', '${item.id}')">Edit</button>
            ${deleteBtn}
        `;
        tr.appendChild(actionsTd);
        tbody.appendChild(tr);
    });
}

// Tab Switching
window.openTab = function (evt, tabName) {
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    document.querySelectorAll('.tab-link').forEach(tl => tl.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');
    evt.currentTarget.classList.add('active');
}

// Modal Logic
window.showModal = function (type, id = null) {
    const modal = document.getElementById('entryModal');
    const form = document.getElementById('entryForm');
    const fieldsContainer = document.getElementById('formFields');
    const title = document.getElementById('modalTitle');

    document.getElementById('entryType').value = type;
    document.getElementById('entryId').value = id || '';

    title.textContent = id ? 'Eintrag bearbeiten' : 'Hinzufügen';

    const item = id ? state[type].find(i => i.id === id) : null;

    // Accounts based on Current View
    const accounts = getAccountsForView();

    // Split Checkbox: Show if it's a new entry OR if it's not a linked entry
    // Check if it WAS split before (isShared is true and we own it)
    const isLinked = item?.linkedId;
    const showSplit = !isLinked && currentView !== 'combined';
    const isSplitChecked = item?.isShared && !isLinked;
    // Actually, simplifying: precise control over split usually happens in individual views.

    // Read-Only mode for linked entries OR if viewing Personal entries in Combined View
    let readOnly = !!isLinked;
    let readOnlyReason = 'linked'; // 'linked' or 'wrong_view'

    if (!readOnly && currentView === 'combined' && item && item.owner !== 'shared') {
        readOnly = true;
        readOnlyReason = 'wrong_view';
    }

    const readOnlyAttr = readOnly ? 'disabled' : '';

    if (readOnly) {
        if (readOnlyReason === 'linked') {
            title.textContent = 'Eintrag (automatisch verwaltet)';
        } else {
            title.textContent = 'Eintrag (Nur in eigener Ansicht bearbeitbar)';
        }
    } else if (item?.isShared) {
        title.textContent = 'Geteilter Eintrag bearbeiten';
    }

    let fields = '';

    // If read-only, we might want to show a notice
    const location = isLinked ? getMainEntryLocation(type, item.linkedId) : '';
    let notice = '';

    if (readOnly) {
        if (readOnlyReason === 'linked') {
            notice = `<p style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 15px;">Dieser Eintrag wird automatisch durch den Haupteintrag verwaltet (zu finden unter: ${location}).</p>`;
        } else {
            const ownerName = item.owner === 'main' ? 'Ich' : 'Partnerin';
            notice = `<p style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 15px;">Dieser Eintrag gehört zu "${ownerName}". Bitte wechsle in diese Ansicht, um ihn zu bearbeiten.</p>`;
        }
    }

    if (type === 'fixkosten') {
        fields = `
            ${notice}
            ${createField('Bezeichnung', 'name', 'text', item?.name, readOnlyAttr)}
            ${createField('Betrag (€)', 'amount', 'text', item ? fromCents(item.amount) : '', readOnlyAttr)}
            <div class="form-group">
                <label>Intervall</label>
                <select id="interval" ${readOnlyAttr}>
                    <option value="Monatlich" ${item?.interval === 'Monatlich' ? 'selected' : ''}>Monatlich</option>
                    <option value="Halbjährlich" ${item?.interval === 'Halbjährlich' ? 'selected' : ''}>Halbjährlich</option>
                    <option value="Jährlich" ${item?.interval === 'Jährlich' ? 'selected' : ''}>Jährlich</option>
                </select>
            </div>
            ${createCategorySelect(item?.category, readOnlyAttr)}
            ${readOnly ? createField('Konto', 'account', 'text', item?.account, readOnlyAttr) : createAccountSelect(item?.account, accounts, readOnlyAttr)}
            ${createSplitCheckbox(showSplit, isSplitChecked)}
        `;
    } else if (type === 'budget') {
        fields = `
            ${notice}
            ${createField('Bezeichnung', 'name', 'text', item?.name, readOnlyAttr)}
            ${createField('Monatlicher Betrag (€)', 'amount', 'text', item ? fromCents(item.amount) : '', readOnlyAttr)}
            ${readOnly ? createField('Konto', 'account', 'text', item?.account, readOnlyAttr) : createAccountSelect(item?.account, accounts, readOnlyAttr)}
            ${createSplitCheckbox(showSplit, isSplitChecked)}
        `;
    } else if (type === 'income') {
        fields = `
            ${notice}
            ${createField('Bezeichnung', 'name', 'text', item?.name, readOnlyAttr)}
            ${createField('Betrag (€)', 'amount', 'text', item ? fromCents(item.amount) : '', readOnlyAttr)}
            ${readOnly ? createField('Konto', 'account', 'text', item?.account, readOnlyAttr) : createAccountSelect(item?.account, accounts, readOnlyAttr)}
        `;
    } else if (type === 'savings') {
        fields = `
            ${notice}
            ${createField('Bezeichnung', 'name', 'text', item?.name, readOnlyAttr)}
            ${createField('Betrag (€)', 'amount', 'text', item ? fromCents(item.amount) : '', readOnlyAttr)}
            <div class="form-group">
                <label>Typ</label>
                <select id="type" ${readOnlyAttr}>
                    <option value="Cash">Cash</option>
                    <option value="Sparplan">Sparplan</option>
                </select>
            </div>
            ${readOnly ? createField('Konto', 'account', 'text', item?.account, readOnlyAttr) : createAccountSelect(item?.account, accounts, readOnlyAttr)}
            ${createSplitCheckbox(showSplit, isSplitChecked)}
        `;
    }


    // Hide Save Button if Read Only
    const footer = modal.querySelector('.modal-footer');
    const saveBtn = footer.querySelector('button[type="submit"]');
    if (readOnly) {
        saveBtn.style.display = 'none';
        // Add a "Delete" button if not exists or let table handle it? 
        // Table handles delete.
    } else {
        saveBtn.style.display = 'block';
    }

    fieldsContainer.innerHTML = fields;
    modal.style.display = 'flex';
}


function createField(label, id, type, value, attributes = '') {
    return `
        <div class="form-group">
            <label>${label}</label>
            <input type="${type}" id="${id}" value="${value || ''}" required ${attributes}>
        </div>
    `;
}

function getMainEntryLocation(type, linkedId) {
    if (!linkedId) return '';
    const mainEntry = state[type].find(i => i.id === linkedId);
    if (!mainEntry) return 'Unbekannt';

    if (mainEntry.owner === 'shared') return 'Gemeinsam';
    if (mainEntry.owner === 'main') return 'Ich';
    if (mainEntry.owner === 'partner') return 'Partnerin';
    return 'Unbekannt';
}



function getAccountsForView() {
    // Filter accounts based on currentView owner, or if combined return all? 
    // Originally: Combined returned only shared? No, "combined" view might need to see all?
    // Wait, original logic: Combined -> Shared Accounts.
    // Let's stick to original logic:

    if (currentView === 'combined') {
        return state.accounts.filter(a => a.owner === 'shared').map(a => a.name);
    }

    // For 'main' and 'partner', we show their own accounts AND shared accounts?
    // Original ACCOUNTS.main included 'C24 (Gemeinschaftskonto)' which is shared.
    // So logic: Account Owner matches View OR Account Owner is Shared.

    return state.accounts
        .filter(a => a.owner === currentView || a.owner === 'shared')
        .map(a => a.name);
}

function isSharedAccount(accountName) {
    const acc = state.accounts.find(a => a.name === accountName);
    return acc && acc.owner === 'shared';
}

function createAccountSelect(selectedValue, accounts, attributes = '') {
    // accounts is list of names from getAccountsForView
    const options = accounts.map(acc =>
        `<option value="${acc}" ${selectedValue === acc ? 'selected' : ''}>${acc}</option>`
    ).join('');

    return `
        <div class="form-group">
            <label>Konto</label>
            <select id="account" required ${attributes}>
                ${options}
            </select>
        </div>
    `;
}

function createSplitCheckbox(show, isChecked) {
    if (!show) return '';
    return `
        <div class="form-group checkbox-group" style="flex-direction: row; align-items: center; gap: 10px; margin-top: 10px;">
            <input type="checkbox" id="isSplit" ${isChecked ? 'checked' : ''}>
            <label for="isSplit" style="margin-bottom: 0;">Geteilte Ausgabe (50/50)</label>
        </div>
    `;
}


// Account Management Functions

window.openAccountModal = function () {
    renderAccountMgmtList();
    document.getElementById('accountForm').reset();
    document.getElementById('accId').value = '';
    document.getElementById('accountModal').style.display = 'flex';
}

window.closeAccountModal = function () {
    document.getElementById('accountModal').style.display = 'none';
}

function renderAccountMgmtList() {
    const list = document.getElementById('accountList');
    list.innerHTML = '';

    // Filter accounts based on View:
    // Main View -> Main + Shared
    // Partner View -> Partner + Shared
    // Combined View -> Shared Only (consistent with other logic)
    const filteredAccounts = state.accounts.filter(acc => {
        if (currentView === 'combined') return acc.owner === 'shared';
        return acc.owner === currentView || acc.owner === 'shared';
    });

    filteredAccounts.forEach(acc => {
        const div = document.createElement('div');
        div.className = 'account-mgmt-item';
        div.innerHTML = `
            <div>
                <strong>${acc.name}</strong> 
                <span style="font-size: 0.8rem; color: #888;">(${acc.owner})</span>
                ${acc.iban ? `<div class="iban-display">${acc.iban}</div>` : ''}
            </div>
            <div style="display: flex; gap: 5px;">
                <button class="btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="editAccount('${acc.id}')">Edit</button>
                <button class="btn-danger" style="padding: 4px 8px; font-size: 0.75rem;" onclick="deleteAccount('${acc.id}')">X</button>
            </div>
        `;
        list.appendChild(div);
    });

    // Also update the Owner Select options to match allowed types
    const ownerSelect = document.getElementById('accOwner');
    if (currentView === 'main') {
        ownerSelect.innerHTML = `<option value="main">Ich</option><option value="shared">Gemeinsam</option>`;
    } else if (currentView === 'partner') {
        ownerSelect.innerHTML = `<option value="partner">Partnerin</option><option value="shared">Gemeinsam</option>`;
    } else {
        ownerSelect.innerHTML = `<option value="shared">Gemeinsam</option>`;
    }
}

window.editAccount = function (id) {
    const acc = state.accounts.find(a => a.id === id);
    if (!acc) return;

    document.getElementById('accId').value = acc.id;
    document.getElementById('accName').value = acc.name;
    document.getElementById('accOwner').value = acc.owner;
    document.getElementById('accIban').value = acc.iban || '';
}

window.deleteAccount = async function (id) {
    const acc = state.accounts.find(a => a.id === id);
    if (!acc) return;

    // Check usage
    let count = 0;
    ['fixkosten', 'budget', 'income', 'savings'].forEach(type => {
        count += state[type].filter(e => e.account === acc.name).length;
    });

    if (count > 0) {
        if (!confirm(`Achtung: Es existieren ${count} Einträge für dieses Konto ("${acc.name}").\nDiese werden auf "Unzugeordnet" zurückgesetzt.\n\nWirklich löschen?`)) {
            return;
        }
    } else {
        if (!confirm(`Konto "${acc.name}" wirklich löschen?`)) return;
    }

    try {
        await fetch(`http://localhost:3001/api/accounts/${id}`, { method: 'DELETE' });
        await loadData(); // Reloads accounts and entries
        renderAccountMgmtList();
    } catch (err) {
        console.error(err);
    }
}

document.getElementById('accountForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('accId').value || Date.now().toString();
    const name = document.getElementById('accName').value;
    const owner = document.getElementById('accOwner').value;
    const iban = document.getElementById('accIban').value;

    try {
        await fetch('http://localhost:3001/api/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name, owner, iban })
        });
        await loadData();
        renderAccountMgmtList();
        document.getElementById('accountForm').reset();
        document.getElementById('accId').value = '';
    } catch (err) {
        console.error(err);
    }
});
function createCategorySelect(selectedValue, attributes = '') {
    const categories = [
        'Versicherung',
        'Abo',
        'Verein',
        'Auto',
        'Wohnung'
    ];

    const options = categories.map(cat =>
        `<option value="${cat}" ${selectedValue === cat ? 'selected' : ''}>${cat}</option>`
    ).join('');

    return `
        <div class="form-group">
            <label>Kategorie</label>
            <select id="category" required ${attributes}>
                ${options}
            </select>
        </div>
    `;
}


window.closeModal = function () {
    document.getElementById('entryModal').style.display = 'none';
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const type = document.getElementById('entryType').value;
    const id = document.getElementById('entryId').value || Date.now().toString();

    const entry = { id };
    const inputs = document.getElementById('formFields').querySelectorAll('input, select');
    const isSplitCheckbox = document.getElementById('isSplit');
    const isSplit = isSplitCheckbox ? isSplitCheckbox.checked : false;

    inputs.forEach(input => {
        if (input.id === 'isSplit') return; // Handled separately

        if (input.type === 'checkbox') {
            entry[input.id] = input.checked;
        } else if (input.id === 'amount') {
            entry[input.id] = toCents(input.value);
        } else {
            entry[input.id] = input.value;
        }
    });

    // Owner Assignment (if new entry or updating)
    // If we are in 'combined', default owner to 'main' for safety, but usually we restrict split to non-combined
    // If we are in 'combined', we now treat it as a 'shared' entry creation
    if (!entry.owner) {
        entry.owner = (currentView === 'combined') ? 'shared' : currentView;
    }

    // PaidBy Assignment (Client-side logic)
    // We assume if account is from Main List (and not shared?), PaidBy = Main.
    // If account is from Partner List (and not shared?), PaidBy = Partner.
    // For Shared: We default to WHO created it (Owner). 
    // Actually, "PaidBy" tracks whose money it was. Shared = "Main" (as per DB default) but ignored in calc.
    // Simplifying: 
    // If Account in ACCOUNTS.main -> PaidBy = Main
    // If Account in ACCOUNTS.partner AND NOT in ACCOUNTS.main -> PaidBy = Partner
    const account = entry.account;
    // PaidBy Assignment (Client-side logic)
    // Map account name to owner to determine payer
    const selectedAcc = state.accounts.find(a => a.name === entry.account);
    const accOwner = selectedAcc ? selectedAcc.owner : 'main'; // Fallback

    if (accOwner === 'main') {
        entry.paidBy = 'main';
    } else if (accOwner === 'partner') {
        entry.paidBy = 'partner';
    } else {
        // Shared Account? Default to who submitted it (currentView) or Main?
        // Original logic: "PaidBy tracks whose money it was. Shared = Main (default)".
        // Let's stick to 'main' for Shared unless we want to track who deposited?
        // Actually, if it's shared, paidBy is less relevant for debt calculation (ignored).
        entry.paidBy = 'main';
    }

    // Automatically set isSecurity based on category
    if (type === 'fixkosten' && entry.category === 'Versicherung') {
        entry.isSecurity = true;
    } else {
        entry.isSecurity = false;
    }

    try {
        const response = await fetch('http://localhost:3001/api/entries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, type, data: entry, isSplit })
        });

        if (!response.ok) throw new Error('Failed to save entry');

        // Reload data to ensure sync with server
        await loadData();
        closeModal();
    } catch (err) {
        console.error('Error saving entry:', err);
        alert('Fehler beim Speichern des Eintrags.');
    }
}


window.deleteEntry = async function (type, id) {
    try {
        const response = await fetch(`http://localhost:3001/api/entries/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete entry');

        await loadData();
    } catch (err) {
        console.error('Error deleting entry:', err);
        alert('Fehler beim Löschen des Eintrags.');
    }
}

window.editEntry = function (type, id) {
    showModal(type, id);
}

// Export / Import
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "budget_data.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            state = data;
            saveData();
        } catch (err) {
            alert('Fehler beim Importieren der Datei.');
        }
    };
    reader.readAsText(file);
}
