import { CFG, api, session, logout } from "./api.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[ch]));
const money = value => `${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP`;
const get = id => document.getElementById(id);

function show(html) {
  const overlay = get("ov");
  const drawer = get("dr");
  if (!overlay || !drawer) throw new Error("Admin panel could not find the storefront drawer.");
  drawer.innerHTML = html;
  overlay.classList.add("open");
}

function isAdmin(auth) {
  // This is only a convenient UI gate; Supabase RLS must enforce the same rule server-side.
  const meta = auth?.user?.app_metadata || {};
  return meta.role === "admin" || (Array.isArray(meta.roles) && meta.roles.includes("admin"));
}

function shell(content) {
  return `<button class="x" data-admin="close" aria-label="Close admin">×</button>
    <h2>BoltHouse Admin</h2>${content}`;
}

export async function start() {
  const auth = session();
  if (!auth) {
    show(shell(`<p>Please sign in first.</p><button class="go" data-admin="close">Close</button>`));
    return;
  }
  if (!isAdmin(auth)) {
    show(shell(`<p role="alert">This account is not marked as an administrator. Ask the project owner to grant the admin role securely in Supabase.</p>
      <button class="go" data-admin="logout">Sign out</button>`));
    return;
  }
  show(shell(`<p class="meta">Signed in as ${esc(auth.user?.email || "admin")}</p>
    <div id="admin-error" role="alert" style="color:var(--acc)"></div>
    <div class="fr"><button class="chip" data-admin="refresh">Refresh orders</button><button class="chip" data-admin="logout">Sign out</button></div>
    <div id="admin-orders"><p class="empty">Loading orders…</p></div>`));
  await loadOrders();
}

async function loadOrders() {
  const root = get("admin-orders");
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
    } else if (action === "refresh") {
      button.disabled = true;
      try { await loadOrders(); }
      finally { button.disabled = false; }
    } else if (action === "logout") {
      button.disabled = true;
      try { await logout(); }
      catch { /* Local session is cleared even if the remote logout endpoint fails. */ }
      get("ov")?.classList.remove("open");
    }
  });
}

attachListener();
