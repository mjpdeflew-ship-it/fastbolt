import { CFG, api, session, logout } from "./api.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[ch]));
const money = value => `${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP`;
const get = id => document.getElementById(id);
let currentTab = "products";
let productRows = [];

function show(html) {
  const overlay = get("ov");
  const drawer = get("dr");
  if (!overlay || !drawer) throw new Error("Admin panel could not find the storefront drawer.");
  drawer.innerHTML = html;
  overlay.classList.add("open");
}

function isAdmin(auth) {
  // UI check only; Supabase RLS must enforce the same rule server-side.
  const meta = auth?.user?.app_metadata || {};
  return meta.role === "admin" || (Array.isArray(meta.roles) && meta.roles.includes("admin"));
}

function shell(content) {
  return `<button class="x" data-admin="close" aria-label="Close admin">×</button>
    <h2>BoltHouse Admin</h2>${content}`;
}

function tabs() {
  return `<div class="fr" style="flex-wrap:wrap">
    <button class="chip ${currentTab === "products" ? "on" : ""}" data-admin="products">Products</button>
    <button class="chip ${currentTab === "orders" ? "on" : ""}" data-admin="orders">Orders</button>
    <button class="chip" data-admin="logout">Sign out</button>
  </div>`;
}

export async function start() {
  const auth = session();
  if (!auth) {
    show(shell(`<p>Please sign in first.</p><button class="go" data-admin="close">Close</button>`));
    return;
  }
  if (!isAdmin(auth)) {
    show(shell(`<p role="alert">This account is not marked as an administrator. Sign in with your admin account.</p>
      <button class="go" data-admin="logout">Sign out</button>`));
    return;
  }
  currentTab = "products";
  show(shell(`<p class="meta">Signed in as ${esc(auth.user?.email || "admin")}</p>
    ${tabs()}
    <div id="admin-error" role="alert" style="color:var(--acc);overflow-wrap:anywhere"></div>
    <div id="admin-content"><p class="empty">Loading products…</p></div>`));
  await loadProducts();
}

async function loadProducts() {
  currentTab = "products";
  const root = get("admin-content");
  const err = get("admin-error");
  if (!root || !err) return;
  root.innerHTML = `<p class="empty">Loading products…</p>`;
  err.textContent = "";
  try {
    const rows = await api("products?select=category,type,size,length,price,in_stock&order=category,type,size,length", { method: "GET" });
    if (!Array.isArray(rows)) throw new Error("Unexpected products response.");
    productRows = rows;
    root.innerHTML = `<button class="go" data-admin="show-add-product" style="margin:8px 0">+ Add product</button>
      <div id="add-product-form" hidden style="border:1px solid var(--line);border-radius:10px;padding:12px;margin:8px 0">
        <h3 style="margin:0 0 8px">Add a product</h3>
        <div class="f">
          <label for="new-category">Category</label>
          <select id="new-category"><option value="bolt">Bolts</option><option value="screw">Screws</option><option value="nut">Nuts</option><option value="washer">Washers</option></select>
          <label for="new-type">Product type</label>
          <input id="new-type" maxlength="80" placeholder="e.g. Hex Bolt" required>
          <label for="new-size">Metric size (number only)</label>
          <input id="new-size" type="number" min="1" max="1000" step="1" placeholder="e.g. 8" required>
          <label for="new-length">Length in mm (leave empty for nuts/washers)</label>
          <input id="new-length" type="number" min="1" max="10000" step="1" placeholder="e.g. 30">
          <label for="new-price">Price per piece (EGP)</label>
          <input id="new-price" type="number" min="0" max="100000000" step="0.01" placeholder="e.g. 5.00" required>
          <label style="display:flex;align-items:center;gap:8px"><input id="new-stock" type="checkbox" checked> In stock</label>
          <button class="go" data-admin="create-product">Save new product</button>
        </div>
      </div>
      <p class="meta">Edit a price or availability, then press Save on that product.</p>` + (rows.length ? rows.map((p, i) => {
      const label = `${p.type || p.category} M${p.size}${p.length == null ? "" : " × " + p.length + " mm"}`;
      return `<section class="it" style="display:block;margin:8px 0">
        <b>${esc(label)}</b>
        <div class="meta">${esc(p.category)} · ${p.length == null ? "No length" : esc(p.length + " mm")}</div>
        <div class="fr" style="align-items:center;flex-wrap:wrap;margin-top:8px">
          <label for="price-${i}" class="meta">Price (EGP)</label>
          <input id="price-${i}" data-product-price="${i}" type="number" min="0" max="100000000" step="0.01" value="${esc(p.price)}" style="width:125px" aria-label="Price in EGP for ${esc(label)}">
          <label style="display:flex;align-items:center;gap:6px;font-size:14px"><input data-product-stock="${i}" type="checkbox" ${p.in_stock ? "checked" : ""}> In stock</label>
          <button class="chip" data-admin="save-product" data-index="${i}">Save</button>
        </div>
      </section>`;
    }).join("") : `<p class="empty">No products found yet. Use “Add product” above to create your first item.</p>`);
  } catch (error) {
    root.innerHTML = `<p class="empty">Products could not be loaded. Check that the products table exists and allows admins to read it.</p>`;
    err.textContent = error?.message || "Unable to load products.";
  }
}

async function saveProduct(button, index) {
  const p = productRows[index];
  const err = get("admin-error");
  if (!p || !err) return;
  const priceInput = get(`price-${index}`);
  const stockInput = document.querySelector(`[data-product-stock="${index}"]`);
  const price = Number(priceInput?.value);
  if (!Number.isFinite(price) || price < 0 || price > 100000000) {
    err.textContent = "Enter a valid non-negative price.";
    priceInput?.focus();
    return;
  }
  const filter = [
    `category=eq.${encodeURIComponent(p.category)}`,
    `type=eq.${encodeURIComponent(p.type)}`,
    `size=eq.${encodeURIComponent(p.size)}`,
    p.length == null ? "length=is.null" : `length=eq.${encodeURIComponent(p.length)}`
  ].join("&");
  button.disabled = true;
  button.textContent = "Saving…";
  err.textContent = "";
  try {
    await api(`products?${filter}`, {
      method: "PATCH",
      body: { price, in_stock: Boolean(stockInput?.checked) },
      prefer: "return=minimal"
    });
    p.price = price;
    p.in_stock = Boolean(stockInput?.checked);
    button.textContent = "Saved ✓";
    if (window.BH?.reload) await window.BH.reload();
  } catch (error) {
    err.textContent = `Could not save product: ${error?.message || "Unknown error"}. If this is a permission error, apply the admin products policy in Supabase.`;
    button.textContent = "Retry";
  } finally {
    button.disabled = false;
  }
}

async function createProduct(button) {
  const err = get("admin-error");
  const root = get("admin-content");
  const category = get("new-category")?.value;
  const type = get("new-type")?.value.trim();
  const size = Number(get("new-size")?.value);
  const lengthRaw = get("new-length")?.value.trim();
  const price = Number(get("new-price")?.value);
  const in_stock = Boolean(get("new-stock")?.checked);
  const length = lengthRaw === "" ? null : Number(lengthRaw);
  if (!["bolt", "screw", "nut", "washer"].includes(category)) {
    err.textContent = "Choose a valid category."; return;
  }
  if (!type || type.length > 80) { err.textContent = "Enter the product type."; get("new-type")?.focus(); return; }
  if (!Number.isSafeInteger(size) || size < 1 || size > 1000) { err.textContent = "Enter a valid metric size, for example 8."; get("new-size")?.focus(); return; }
  if (length !== null && (!Number.isSafeInteger(length) || length < 1 || length > 10000)) { err.textContent = "Length must be a positive whole number in millimetres, or leave it empty."; get("new-length")?.focus(); return; }
  if (!Number.isFinite(price) || price < 0 || price > 100000000) { err.textContent = "Enter a valid price in EGP."; get("new-price")?.focus(); return; }
  button.disabled = true;
  button.textContent = "Adding…";
  err.textContent = "";
  try {
    await api("products", {
      method: "POST",
      body: { category, type, size, length, price, in_stock },
      prefer: "return=minimal"
    });
    await loadProducts();
    const e = get("admin-error");
    if (e) e.textContent = "Product added successfully.";
  } catch (error) {
    err.textContent = `Could not add product: ${error?.message || "Unknown error"}. If you see 401/403, the admin INSERT policy is missing in Supabase.`;
    button.disabled = false;
    button.textContent = "Retry adding product";
  }
}

async function loadOrders() {
  currentTab = "orders";
  const root = get("admin-content");
  const err = get("admin-error");
  if (!root || !err) return;
  root.innerHTML = `<p class="empty">Loading orders…</p>`;
  err.textContent = "";
  try {
    const orders = await api("orders?select=ref,name,phone,address,items,total,created_at&order=created_at.desc", { method: "GET" });
    if (!Array.isArray(orders)) throw new Error("Unexpected orders response.");
    if (!orders.length) {
      root.innerHTML = `<p class="empty">No orders found.</p>`;
      return;
    }
    root.innerHTML = orders.map(order => {
      const lines = Array.isArray(order.items) ? order.items.map(item =>
        `<li>${esc(item.qty)} × ${esc(item.name)}${Number.isFinite(Number(item.price)) ? ` — ${money(Number(item.qty) * Number(item.price))}` : ""}</li>`
      ).join("") : `<li>Items are stored in an unsupported format.</li>`;
      const date = order.created_at ? new Date(order.created_at).toLocaleString() : "Date unavailable";
      return `<section class="it" style="display:block;margin:8px 0">
        <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap"><b>${esc(order.ref || "Order")}</b><b>${money(order.total)}</b></div>
        <div class="meta">${esc(date)}</div>
        <p><b>${esc(order.name)}</b><br>${esc(order.phone)}<br>${esc(order.address)}</p>
        <ul>${lines}</ul>
      </section>`;
    }).join("");
  } catch (error) {
    root.innerHTML = `<p class="empty">Orders could not be loaded. Check the orders table and its RLS policies.</p>`;
    err.textContent = error?.message || "Unable to load orders.";
  }
}

let listenerAdded = false;
function attachListener() {
  if (listenerAdded) return;
  listenerAdded = true;
  document.addEventListener("click", async event => {
    const button = event.target.closest("button[data-admin]");
    if (!button) return;
    const action = button.dataset.admin;
    if (action === "close") {
      get("ov")?.classList.remove("open");
    } else if (action === "products") {
      await loadProducts();
    } else if (action === "orders") {
      await loadOrders();
    } else if (action === "refresh") {
      button.disabled = true;
      try { currentTab === "products" ? await loadProducts() : await loadOrders(); }
      finally { button.disabled = false; }
    } else if (action === "show-add-product") {
      const form = get("add-product-form");
      if (form) form.hidden = !form.hidden;
    } else if (action === "create-product") {
      await createProduct(button);
    } else if (action === "save-product") {
      await saveProduct(button, Number(button.dataset.index));
    } else if (action === "logout") {
      button.disabled = true;
      try { await logout(); }
      catch { /* Local session is cleared even if remote logout fails. */ }
      get("ov")?.classList.remove("open");
    }
  });
}

attachListener();
