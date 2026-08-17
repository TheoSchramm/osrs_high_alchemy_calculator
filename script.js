const runePriceInput = document.getElementById('runePrice');
const nameInput = document.getElementById('itemName');
const vendorInput = document.getElementById('vendorPrice');
const alchInput = document.getElementById('alchPrice');
const qtyInput = document.getElementById('quantity');
const addButton = document.getElementById('addItem');
const tableBody = document.querySelector('#itemsTable tbody');
const totalProfitEl = document.getElementById('totalProfit');
const totalXPEl = document.getElementById('totalXP');
const totalTimeEl = document.getElementById('totalTime');

let items = JSON.parse(localStorage.getItem('alchItems')) || [];
let runePrice = parseFloat(localStorage.getItem('runePrice')) ?? 200;
runePriceInput.value = runePrice;

// Give old saved items an ID if missing
items.forEach(i => {
  if (!i.id) i.id = crypto.randomUUID();
});

function cleanNumber(str) {
  return parseFloat(String(str).replace(/,/g, '').replace(/\./g, '')) || 0;
}

function formatNumber(num) {
  return num.toLocaleString('en-US');
}

function saveData() {
  localStorage.setItem('alchItems', JSON.stringify(items));
  localStorage.setItem('runePrice', runePrice);
}

let itemMapping = null;

async function getItemMapping() {
  if (!itemMapping) {
    const res = await fetch("https://prices.runescape.wiki/api/v1/osrs/mapping");
    itemMapping = await res.json();
  }
  return itemMapping;
}

async function getItemDataByName(name) {
  const items = await getItemMapping();
  const match = items.find(i => i.name.toLowerCase() === name.toLowerCase());
  if (!match) return null;

  const priceRes = await fetch(`https://prices.runescape.wiki/api/v1/osrs/latest?id=${match.id}`);
  const priceJson = await priceRes.json();
  const price = priceJson.data[match.id] || {};

  return {
    id: match.id,
    name: match.name,
    highAlch: match.highalch,
    lowAlch: match.lowalch,
    icon: `https://static.runelite.net/cache/item/icon/${encodeURIComponent(match.id)}.png`,
    gePrice: {
      high: price.high ?? null,
      low: price.low ?? null
    }
  };
}

/* ===========================
   SORTING LOGIC
=========================== */

let sortField = null;
let sortDirection = 1;

document.querySelectorAll("#itemsTable thead th").forEach(th => {

  const field = th.getAttribute("data-field");
  if (!field) return;

  th.style.cursor = "pointer";
  th.addEventListener("click", () => {

    // Same logic you already use
    if (sortField === field) {
      sortDirection *= -1;
    } else {
      sortField = field;
      sortDirection = 1;
    }

    updateSortIndicators(); // ← ADD THIS
    updateTable();
  });
});

/* ===========================
   UPDATE TABLE (STABLE DOM)
=========================== */

async function updateTable() {

  /* ---- Sort items ---- */
  if (sortField) {
    items.sort((a, b) => {
      if (sortField === "profit") {
        const pa = (a.alch - a.vendor - runePrice) * a.quantity;
        const pb = (b.alch - b.vendor - runePrice) * b.quantity;
        return (pa - pb) * sortDirection;
      }
      if (sortField === "spentItems") {
        return ((a.vendor * a.quantity) - (b.vendor * b.quantity)) * sortDirection;
      }
      if (sortField === "spentRunes") {
        return ((a.quantity * runePrice) - (b.quantity * runePrice)) * sortDirection;
      }

      if (typeof a[sortField] === "number") {
        return (a[sortField] - b[sortField]) * sortDirection;
      }

      return a[sortField].toString().localeCompare(
        b[sortField].toString(),
        undefined,
        { sensitivity: "base" }
      ) * sortDirection;
    });
  }

  let rows = [];
  let totalProfit = 0;
  let totalCasts = 0;

  for (let item of items) {
    const runeGold = item.quantity * runePrice;
    const profit = (item.alch - item.vendor - runePrice) * item.quantity;

    totalProfit += profit;
    totalCasts += item.quantity;

    /* Reuse row by permanent ID */
    let tr = tableBody.querySelector(`tr[data-id="${item.id}"]`);

    /* Create new row if not found */
    if (!tr) {
      tr = document.createElement("tr");
      tr.setAttribute("data-id", item.id);

      tr.innerHTML = `
        <td>
          <div style="display:flex;align-items:center;    justify-content: center;
    align-items: center;gap:6px;">
            
          <img class="item-icon">
            <span class="emphasis" contenteditable="true"></span>
          </div>
        </td>
        
        <td contenteditable="true" data-field="vendor"></td>
        <td contenteditable="true" data-field="alch"></td>
        <td contenteditable="true" data-field="quantity"></td>
        <td class="spentItems"></td>
        <td class="spentRunes"></td>
        <td class="profit"></td>
      
        <td style="white-space:nowrap;">
          <button class="refresh-btn" title="Refresh item"> 
            <img src=assets/again.png class="icon"> 
          </button>
          
          <button class="delete-btn" title="Delete item"> 
            <img src=assets/trash_bin.png class="icon">
          </button>

      </td>
      `;

      /* Editable events */
      tr.querySelectorAll('[contenteditable]').forEach(td => {
        td.addEventListener("blur", async (e) => {
          const field = e.target.getAttribute("data-field");
          const value = e.target.innerText.trim();

          if (["vendor", "alch", "quantity"].includes(field)) {
            item[field] = cleanNumber(value);
          } else if (field === "name") {
            item.name = value;
            const data = await getItemDataByName(value);
            if (data) {
              item.icon = data.icon;
              item.alch = data.highAlch || item.alch;
              item.vendor = data.gePrice.low || item.vendor;
            }
          }

          saveData();
          updateTable();
        });

        td.addEventListener("keydown", e => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.target.blur();
          }
        });
      });

      tr.querySelector(".refresh-btn").addEventListener("click", async () => {
        if (!confirm(`Are you sure you want to refresh data for "${item.name}"?`)) {
          return; // user canceled
        }

        const data = await getItemDataByName(item.name);
        if (data) {
          item.icon = data.icon;
          item.alch = data.highAlch || item.alch;
          item.vendor = data.gePrice.low || item.vendor;
          saveData();
          updateTable();
        }
      });

      tr.querySelector(".delete-btn").addEventListener("click", () => {
        if (!confirm(`Are you sure you want to delete "${item.name}"?`)) {
          return; // user canceled
        }

        items = items.filter(i => i.id !== item.id);
        saveData();
        updateTable();
      });
    }

    /* Update UI fields */
    tr.querySelector(".item-icon").src = item.icon || "";
    tr.querySelector("span.emphasis").innerText = item.name;

    tr.querySelector('[data-field="vendor"]').innerText = formatNumber(item.vendor);
    tr.querySelector('[data-field="alch"]').innerText = formatNumber(item.alch);
    tr.querySelector('[data-field="quantity"]').innerText = formatNumber(item.quantity);

    tr.querySelector(".spentItems").innerText = formatNumber(item.vendor * item.quantity);
    tr.querySelector(".spentRunes").innerText = formatNumber(runeGold);
    tr.querySelector(".profit").innerText = formatNumber(profit);

    rows.push(tr);
  }

  /* Rebuild tbody with sorted rows */
  tableBody.innerHTML = "";
  rows.forEach(r => tableBody.appendChild(r));

  /* Update totals */
  const totalXP = totalCasts * 65;
  const hours = totalCasts / 1200;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);

  totalProfitEl.textContent = formatNumber(totalProfit) + "gp";
  totalXPEl.textContent = formatNumber(totalXP) + "xp";
  totalTimeEl.textContent = `${h}h ${m}m`;
}

/* ===========================
   ADD ITEM
=========================== */

addButton.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name) return;

  const vendorManual = cleanNumber(vendorInput.value);
  const alchManual = cleanNumber(alchInput.value);
  const quantity = cleanNumber(qtyInput.value) || 1;

  const data = await getItemDataByName(name);

  const newItem = {
    id: crypto.randomUUID(),
    name: data?.name || name,
    vendor: data?.gePrice?.low || vendorManual || 0,
    alch: data?.highAlch || alchManual || 0,
    quantity,
    icon: data?.icon || null
  };

  items.push(newItem);

  nameInput.value = vendorInput.value = alchInput.value = '';
  qtyInput.value = 1;

  saveData();
  updateTable();
});

/* ===========================
   RUNE PRICE CHANGE
=========================== */

runePriceInput.addEventListener('input', () => {
  runePrice = parseFloat(runePriceInput.value) || 0;
  saveData();
  updateTable();
});
function updateSortIndicators() {
  document.querySelectorAll("#itemsTable thead th").forEach(th => {
    th.classList.remove("sorted-asc", "sorted-desc", "emphasis");

    const field = th.getAttribute("data-field");
    if (!field) return;

    if (field === sortField) {
      th.classList.add(sortDirection === 1 ? "sorted-asc" : "sorted-desc");
      th.classList.add("emphasis")
    }
  });
}

updateTable();


