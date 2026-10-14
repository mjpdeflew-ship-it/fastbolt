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
    if (!rows.length) {
      root.innerHTML = `<p class="empty">No products found.</p>`;
      return;
    }
    root.innerHTML = `<p class="meta">Edit a price or availability, then press Save on that product.</p>` + rows.map((p, i) => {
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
    }).join("");
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
