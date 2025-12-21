// State management
let state = {
    fixkosten: [],
    budget: [],
    income: [],
    savings: []
};

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

    state.fixkosten.forEach(item => {
        let monthly = item.amount;
        if (item.interval === 'Halbjährlich') monthly = Math.round(item.amount / 6);
        if (item.interval === 'Jährlich') monthly = Math.round(item.amount / 12);

        // Security is now determined by category 'Versicherung'
        if (item.category === 'Versicherung') security += monthly;
        else fixed += monthly;
    });

    state.budget.forEach(item => life += item.amount);
    state.savings.forEach(item => wealth += item.amount);
    state.income.forEach(item => income += item.amount);

    return {
        security,
        fixed,
        life,
        wealth,
        buffer: income - (security + fixed + life + wealth)
    };
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

    state[type].forEach(item => {
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
            <button class="btn-danger" onclick="deleteEntry('${type}', '${item.id}')">DEL</button>
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

    let fields = '';
    if (type === 'fixkosten') {
        fields = `
            ${createField('Bezeichnung', 'name', 'text', item?.name)}
            ${createField('Betrag (€)', 'amount', 'text', item ? fromCents(item.amount) : '')}
            <div class="form-group">
                <label>Intervall</label>
                <select id="interval">
                    <option value="Monatlich" ${item?.interval === 'Monatlich' ? 'selected' : ''}>Monatlich</option>
                    <option value="Halbjährlich" ${item?.interval === 'Halbjährlich' ? 'selected' : ''}>Halbjährlich</option>
                    <option value="Jährlich" ${item?.interval === 'Jährlich' ? 'selected' : ''}>Jährlich</option>
                </select>
                </select>
            </div>
            ${createCategorySelect(item?.category)}
            ${createAccountSelect(item?.account)}
        `;
    } else if (type === 'budget') {
        fields = `
            ${createField('Bezeichnung', 'name', 'text', item?.name)}
            ${createField('Monatlicher Betrag (€)', 'amount', 'text', item ? fromCents(item.amount) : '')}
            ${createAccountSelect(item?.account)}
        `;
    } else if (type === 'income') {
        fields = `
            ${createField('Bezeichnung', 'name', 'text', item?.name)}
            ${createField('Betrag (€)', 'amount', 'text', item ? fromCents(item.amount) : '')}
            ${createAccountSelect(item?.account)}
        `;
    } else if (type === 'savings') {
        fields = `
            ${createField('Bezeichnung', 'name', 'text', item?.name)}
            ${createField('Betrag (€)', 'amount', 'text', item ? fromCents(item.amount) : '')}
            <div class="form-group">
                <label>Typ</label>
                <select id="type">
                    <option value="Cash">Cash</option>
                    <option value="Sparplan">Sparplan</option>
                </select>
            </div>
            ${createAccountSelect(item?.account)}
        `;
    }

    fieldsContainer.innerHTML = fields;
    modal.style.display = 'flex';
}

function createField(label, id, type, value) {
    return `
        <div class="form-group">
            <label>${label}</label>
            <input type="${type}" id="${id}" value="${value || ''}" required>
        </div>
    `;
}

function createAccountSelect(selectedValue) {
    const accounts = [
        'N26 (Hauptkonto)',
        'N26 (Versicherungen)',
        'N26 (Lifestyle)',
        'N26 (Abos)',
        'N26 (Rücklagen)',
        'N26 (Urlaub)',
        'N26 (Auto)',
        'C24 (Mein Konto)',
        'C24 (Gemeinschaftskonto)'
    ];

    const options = accounts.map(acc =>
        `<option value="${acc}" ${selectedValue === acc ? 'selected' : ''}>${acc}</option>`
    ).join('');

    return `
        <div class="form-group">
            <label>Konto</label>
            <select id="account" required>
                ${options}
            </select>
        </div>
    `;
}

function createCategorySelect(selectedValue) {
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
            <select id="category" required>
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

    inputs.forEach(input => {
        if (input.type === 'checkbox') {
            entry[input.id] = input.checked;
        } else if (input.id === 'amount') {
            entry[input.id] = toCents(input.value);
        } else {
            entry[input.id] = input.value;
        }
    });

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
            body: JSON.stringify({ id, type, data: entry })
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
