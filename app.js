// State management
let state = {
    fixkosten: [],
    budget: [],
    income: [],
    savings: []
};

// Partner Mode State
let currentView = 'main'; // 'main', 'partner', 'combined'

const ACCOUNTS = {
    main: [
        'N26 (Hauptkonto)',
        'N26 (Versicherungen)',
        'N26 (Lifestyle)',
        'N26 (Abos)',
        'N26 (Rücklagen)',
        'N26 (Urlaub)',
        'N26 (Auto)',
        'C24 (Mein Konto)',
        'C24 (Gemeinschaftskonto)'
    ],
    partner: [
        'C24 (Gemeinschaftskonto)',
        'C24 (Persönliches Konto)',
        'Postbank Konto'
    ]
};

const SHARED_ACCOUNTS = [
    'C24 (Gemeinschaftskonto)'
];


// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    initEventListeners();
});

async function loadData() {
    try {
        const response = await fetch('http://localhost:3001/api/entries');
        if (!response.ok) throw new Error('Failed to load data');
        state = await response.json();
        updateDashboard();
    } catch (err) {
        console.error('Error loading data:', err);
        // Fallback to empty state isn't strictly necessary as state is initialized empty
    }
}

// saveData is removed as we now save per-action via API calls


function initEventListeners() {
    document.getElementById('entryForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('exportBtn').addEventListener('click', exportData);
    document.getElementById('importBtn').addEventListener('change', importData);
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
        // Filter out splits that belong to a 'shared' master entry to avoid double counting
        const sharedMasterIds = new Set(list.filter(i => i.owner === 'shared').map(i => i.id));
        return list.filter(item => {
            if (item.linkedId && sharedMasterIds.has(item.linkedId)) return false;
            return true;
        });
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
            const isSharedAccount = SHARED_ACCOUNTS.includes(entry.account);
            if (isSharedAccount) return;

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
                td.textContent = fromCents(item[field]) + ' €';
            } else if (field === 'isSecurity') {
                td.textContent = item[field] ? 'Ja' : 'Nein';
            } else {
                td.textContent = item[field];
            }
            tr.appendChild(td);
        });

        const actionsTd = document.createElement('td');
        actionsTd.innerHTML = `
            <button class="btn-secondary" onclick="editEntry('${type}', '${item.id}')">Edit</button>
            ${item.linkedId
                ? `<button class="btn-danger" style="opacity: 0.3; cursor: not-allowed;" title="Teil einer geteilten Ausgabe. Haupteintrag unter: ${getMainEntryLocation(type, item.linkedId)}">DEL</button>`
                : `<button class="btn-danger" onclick="deleteEntry('${type}', '${item.id}')">DEL</button>`
            }
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
    const isSplitChecked = item?.isShared && !isLinked; // If it's shared but NOT linked, it's the main entry -> Checked

    // Read-Only mode for linked entries
    const readOnly = !!isLinked;

    const readOnlyAttr = readOnly ? 'disabled' : '';

    if (readOnly) {
        title.textContent = 'Eintrag (automatisch verwaltet)';
    }

    let fields = '';

    // If read-only, we might want to show a notice
    // If read-only, we might want to show a notice
    const location = isLinked ? getMainEntryLocation(type, item.linkedId) : '';
    const notice = readOnly ? `<p style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 15px;">Dieser Eintrag wird automatisch durch den Haupteintrag verwaltet (zu finden unter: ${location}).</p>` : '';

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
    if (currentView === 'partner') return ACCOUNTS.partner;
    if (currentView === 'main') return ACCOUNTS.main;
    if (currentView === 'combined') return SHARED_ACCOUNTS;
    // Default fallback
    return [...new Set([...ACCOUNTS.main, ...ACCOUNTS.partner])];
}

function createAccountSelect(selectedValue, accounts, attributes = '') {
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
    if (ACCOUNTS.main.includes(account)) {
        entry.paidBy = 'main';
    } else {
        entry.paidBy = 'partner';
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
