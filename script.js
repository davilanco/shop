// script.js - Davilanco Store Frontend
// Works with: /api/cart, /api/orders, /api/products

const GUEST_CART_KEY = 'davilanco_guest_cart';

let products = [];
let cart = []; // { product_id, product_name, price, image, quantity, stock }
let isLoggedIn = false;
let isSyncing = false;

// ==========================================
// HELPERS
// ==========================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function naira(n) {
  return '₦' + Number(n || 0).toLocaleString('en-NG');
}

function toast(msg, type = 'success') {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:12px 20px;border-radius:8px;z-index:9999;color:#fff;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.2);';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.background = type === 'error' ? '#dc2626' : '#16a34a';
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.display = 'none', 2500);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ==========================================
// GUEST CART (localStorage)
// ==========================================
function getGuestCart() {
  try { return JSON.parse(localStorage.getItem(GUEST_CART_KEY) || '[]'); }
  catch { return []; }
}
function saveGuestCart(items) {
  localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items));
}
function clearGuestCart() {
  localStorage.removeItem(GUEST_CART_KEY);
}

// ==========================================
// PRODUCTS
// ==========================================
async function loadProducts() {
  const grid = $('#product-grid, #products, [data-products]');
  if (!grid) return;

  try {
    const data = await api('/api/products');
    products = data.products || [];
    renderProducts();
  } catch (e) {
    console.error(e);
    grid.innerHTML = '<p>Failed to load products. Please refresh.</p>';
  }
}

function renderProducts() {
  const grid = $('#product-grid, #products, [data-products]');
  if (!grid) return;

  if (!products.length) {
    grid.innerHTML = '<p>No products available yet.</p>';
    return;
  }

  grid.innerHTML = products.map(p => `
    <div class="product-card" data-id="${p.id}">
      <img src="${p.image || '/placeholder.png'}" alt="${p.name}" loading="lazy" />
      <h3>${p.name}</h3>
      <p class="category">${p.category || ''}</p>
      <p class="price">${naira(p.price)}</p>
      <p class="stock">${p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'}</p>
      <button onclick="addToCart('${p.id}', 1)" ${p.stock <= 0 ? 'disabled' : ''}>
        Add to Cart
      </button>
    </div>
  `).join('');
}

// ==========================================
// CART - LOAD (Syncs across devices)
// ==========================================
async function loadCart() {
  // Try DB cart first - if logged in, this is source of truth
  try {
    const data = await api('/api/cart');
    isLoggedIn = true;
    cart = data.items || [];
    // If guest cart still exists (user just logged in elsewhere), merge it once
    const guest = getGuestCart();
    if (guest.length > 0) {
      await mergeGuestCart();
      return; // mergeGuestCart will reload
    }
    renderCart();
    updateCartBadge();
    return;
  } catch (e) {
    // 401 = not logged in, use guest cart
    isLoggedIn = false;
    cart = getGuestCart();
    // Enrich guest cart with latest product info
    cart = cart.map(item => {
      const p = products.find(x => x.id === item.product_id);
      if (p) return { ...item, product_name: p.name, price: p.price, image: p.image, stock: p.stock };
      return item;
    }).filter(i => i.price);
    renderCart();
    updateCartBadge();
  }
}

// Merge guest localStorage cart into DB cart after login
async function mergeGuestCart() {
  const guest = getGuestCart();
  if (!guest.length || !isLoggedIn) return;

  try {
    const data = await api('/api/cart/merge', {
      method: 'POST',
      body: JSON.stringify({ items: guest }),
    });
    clearGuestCart();
    cart = data.items || [];
    renderCart();
    updateCartBadge();
    if (guest.length) toast('Your guest cart was merged with your account');
  } catch (e) {
    console.error('Merge failed', e);
  }
}

// Call this right after login succeeds
async function onLoginSuccess() {
  isLoggedIn = true;
  await mergeGuestCart();
  await loadCart();
}
window.onLoginSuccess = onLoginSuccess;

// ==========================================
// CART - ADD / UPDATE / REMOVE
// ==========================================
async function addToCart(productId, quantity = 1) {
  const product = products.find(p => p.id === productId);
  if (!product && isLoggedIn) {
    // Product list not loaded yet, still try API
  }

  if (isLoggedIn) {
    try {
      isSyncing = true;
      const data = await api('/api/cart', {
        method: 'POST',
        body: JSON.stringify({ product_id: productId, quantity }),
      });
      cart = data.items || [];
      renderCart();
      updateCartBadge();
      toast('Added to cart');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      isSyncing = false;
    }
    return;
  }

  // Guest - localStorage
  const existing = cart.find(i => i.product_id === productId);
  if (existing) {
    existing.quantity += quantity;
  } else {
    if (!product) return toast('Product not found', 'error');
    cart.push({
      product_id: product.id,
      product_name: product.name,
      price: product.price,
      image: product.image,
      stock: product.stock,
      quantity,
    });
  }
  saveGuestCart(cart);
  renderCart();
  updateCartBadge();
  toast('Added to cart - Login to sync across devices');
}
window.addToCart = addToCart;

async function updateQuantity(productId, quantity) {
  quantity = Number(quantity);
  if (quantity <= 0) return removeFromCart(productId);

  if (isLoggedIn) {
    try {
      const data = await api('/api/cart', {
        method: 'PATCH',
        body: JSON.stringify({ product_id: productId, quantity }),
      });
      cart = data.items || [];
    } catch (e) {
      return toast(e.message, 'error');
    }
  } else {
    const item = cart.find(i => i.product_id === productId);
    if (item) item.quantity = quantity;
    saveGuestCart(cart);
  }
  renderCart();
  updateCartBadge();
}
window.updateQuantity = updateQuantity;

async function removeFromCart(productId) {
  if (isLoggedIn) {
    try {
      const data = await api(`/api/cart?product_id=${encodeURIComponent(productId)}`, { method: 'DELETE' });
      cart = data.items || [];
    } catch (e) {
      return toast(e.message, 'error');
    }
  } else {
    cart = cart.filter(i => i.product_id !== productId);
    saveGuestCart(cart);
  }
  renderCart();
  updateCartBadge();
  toast('Item removed');
}
window.removeFromCart = removeFromCart;

async function clearCart() {
  if (isLoggedIn) {
    try { await api('/api/cart/clear', { method: 'DELETE' }); } catch {}
  }
  cart = [];
  clearGuestCart();
  renderCart();
  updateCartBadge();
}
window.clearCart = clearCart;

// ==========================================
// CART - RENDER
// ==========================================
function updateCartBadge() {
  const count = cart.reduce((s, i) => s + Number(i.quantity || 0), 0);
  $$('#cart-count, [data-cart-count], .cart-count').forEach(el => {
    el.textContent = count;
    el.style.display = count > 0 ? 'inline-flex' : 'none';
  });
}

function renderCart() {
  const container = $('#cart-items, #cart-list, [data-cart-items]');
  const totalEl = $('#cart-total, [data-cart-total]');
  const emptyEl = $('#cart-empty');

  const total = cart.reduce((s, i) => s + (Number(i.price) * Number(i.quantity)), 0);
  if (totalEl) totalEl.textContent = naira(total);

  if (!container) return;

  if (!cart.length) {
    container.innerHTML = '<p>Your cart is empty.</p>';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  container.innerHTML = cart.map(item => `
    <div class="cart-item" data-id="${item.product_id}">
      <img src="${item.image || '/placeholder.png'}" alt="${item.product_name || ''}" width="60" />
      <div class="cart-info">
        <h4>${item.product_name || 'Product'}</h4>
        <p>${naira(item.price)} each</p>
      </div>
      <div class="cart-qty">
        <button onclick="updateQuantity('${item.product_id}', ${Number(item.quantity) - 1})">-</button>
        <span>${item.quantity}</span>
        <button onclick="updateQuantity('${item.product_id}', ${Number(item.quantity) + 1})">+</button>
      </div>
      <div class="cart-line-total">${naira(item.price * item.quantity)}</div>
      <button class="remove-btn" onclick="removeFromCart('${item.product_id}')">✕</button>
    </div>
  `).join('');
}

// ==========================================
// CHECKOUT
// ==========================================
async function checkout(event) {
  if (event) event.preventDefault();

  if (!cart.length) return toast('Your cart is empty', 'error');

  if (!isLoggedIn) {
    toast('Please login to checkout - so your cart syncs', 'error');
    // Redirect to login, guest cart is already saved
    window.location.href = '/login.html?next=/checkout.html';
    return;
  }

  const form = $('#checkout-form');
  const formData = form ? new FormData(form) : new FormData();

  const payload = {
    customer_name: formData.get('customer_name') || formData.get('name') || $('#customer_name')?.value || '',
    customer_email: formData.get('customer_email') || formData.get('email') || $('#customer_email')?.value || '',
    customer_phone: formData.get('customer_phone') || formData.get('phone') || $('#customer_phone')?.value || '',
    delivery_address: formData.get('delivery_address') || formData.get('address') || $('#delivery_address')?.value || '',
    delivery_city: formData.get('delivery_city') || formData.get('city') || $('#delivery_city')?.value || '',
    delivery_state: formData.get('delivery_state') || formData.get('state') || $('#delivery_state')?.value || '',
    note: formData.get('note') || $('#note')?.value || '',
    // You should set this from Paystack / Flutterwave after payment
    // For now, generate one - replace with real payment ref
    payment_reference: formData.get('payment_reference') || 'PAY-' + Date.now(),
  };

  if (!payload.customer_name || !payload.customer_email || !payload.customer_phone || !payload.delivery_address || !payload.delivery_city || !payload.delivery_state) {
    return toast('Please fill name, email, phone and full delivery address', 'error');
  }

  const btn = $('#checkout-btn, [data-checkout-btn]');
  if (btn) { btn.disabled = true; btn.textContent = 'Placing order...'; }

  try {
    const data = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    // Order created + cart cleared on server
    cart = [];
    clearGuestCart();
    renderCart();
    updateCartBadge();

    toast(`Order ${data.order_number} placed!`);
    window.location.href = `/order-success.html?order=${data.order_number}`;
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Place Order'; }
  }
}
window.checkout = checkout;

// ==========================================
// LOGIN / LOGOUT HOOKS
// ==========================================
// Call this from your existing login form after successful login
// Example in login.js:
//   await fetch('/api/auth/login', {...})
//   await onLoginSuccess();
//   window.location.href = '/';

document.addEventListener('DOMContentLoaded', async () => {
  await loadProducts();
  await loadCart();

  const checkoutForm = $('#checkout-form');
  if (checkoutForm) {
    checkoutForm.addEventListener('submit', checkout);
  }

  const checkoutBtn = $('#checkout-btn');
  if (checkoutBtn && !checkoutForm) {
    checkoutBtn.addEventListener('click', checkout);
  }
});