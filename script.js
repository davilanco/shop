(() => {
  'use strict';

  // ---------- Helpers ----------
  const $ = (selector) => document.querySelector(selector);

  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }[c])
    );

  const money = (n) =>
    new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      maximumFractionDigits: 0,
    }).format(Number(n) || 0);

  // ---------- Cart Storage ----------
  const CART_KEY = 'davilanco_cart_v1';
  let products = [];

  const getCart = () => {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    } catch {
      return [];
    }
  };

  const saveCart = (cart) => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartCount();
  };

  const updateCartCount = () => {
    const el = $('#cartCount');
    if (!el) return;
    el.textContent = getCart().reduce((total, item) => total + item.quantity, 0);
  };

  // ---------- Toast ----------
  const toast = (text) => {
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.style.cssText =
        'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--gold);color:#000;padding:12px 20px;border-radius:25px;z-index:99';
      document.body.append(el);
    }
    el.textContent = text;
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => el.remove(), 2300);
  };

  // ---------- API ----------
  async function api(path, options = {}) {
    const res = await fetch('/api/' + path, {
      credentials: 'same-origin',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    let data = {};
    try {
      data = await res.json();
    } catch {}

    if (!res.ok) throw Error(data.error || 'Request failed');
    return data;
  }

  // Fetch session ONCE and reuse everywhere
  async function getSessionOnce() {
    try {
      const res = await fetch('/api/session', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
  }

  // ---------- Products ----------
  function productCard(p) {
    return `
      <article class="product-card">
        <a href="/product.html?id=${encodeURIComponent(p.id)}">
          <div class="product-image">
            ${
              p.image
                ? `<img loading="lazy" src="${esc(p.image)}" alt="${esc(p.name)}">`
                : '<span class="product-placeholder">✳</span>'
            }
          </div>
        </a>
        <div class="product-info">
          <small class="product-category">${esc(p.category)}</small>
          <h3>
            <a href="/product.html?id=${encodeURIComponent(p.id)}">
              ${esc(p.name)}
            </a>
          </h3>
          <div class="product-bottom">
            <b class="price">${money(p.price)}</b>
            <button class="add-btn" data-add="${esc(p.id)}">＋ Add</button>
          </div>
        </div>
      </article>
    `;
  }

  async function loadProducts() {
    const grid = $('#productGrid');
    if (!grid) return;

    try {
      const data = await api('products');
      products = data.products || [];

      const params = new URLSearchParams(location.search);
      const category = params.get('category');
      const term = (params.get('q') || '').toLowerCase();

      if (category && category !== 'others') {
        products = products.filter((p) => p.category === category);
      }

      if (term) {
        products = products.filter((p) =>
          (p.name + ' ' + p.description + ' ' + p.category)
            .toLowerCase()
            .includes(term)
        );
      }

      const sort = $('#sortProducts')?.value;
      if (sort === 'price-low') products.sort((a, b) => a.price - b.price);
      if (sort === 'price-high') products.sort((a, b) => b.price - a.price);

      grid.innerHTML = products.length
        ? products.map(productCard).join('')
        : '<p class="muted">No products found. Check back soon.</p>';

      if ($('#categoryTitle')) {
        $('#categoryTitle').textContent = (category || 'Category').replace(/-/g, ' ');
      }
    } catch (e) {
      grid.textContent = e.message;
    }
  }

  // ---------- Cart Actions ----------
  function addToCart(product) {
    const cart = getCart();
    const existing = cart.find((item) => item.id === product.id);

    if (existing) {
      existing.quantity = Math.min(99, existing.quantity + 1);
    } else {
      cart.push({
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.image || '',
        quantity: 1,
      });
    }

    saveCart(cart);
    toast('Added to your bag');
  }

  function renderCart() {
    const el = $('#cartView');
    if (!el) return;

    const cart = getCart();

    if (!cart.length) {
      el.innerHTML = `
        <div class="panel">
          <p>Your bag is waiting for something good.</p>
          <a class="btn btn-gold" href="/categories.html">Explore products ↗</a>
        </div>
      `;
      return;
    }

    const subtotal = cart.reduce((sum, x) => sum + x.price * x.quantity, 0);

    el.innerHTML = `
      <div class="checkout-layout">
        <section class="panel">
          ${cart
            .map(
              (x) => `
              <div class="cart-row">
                <img class="cart-thumb" src="${esc(x.image)}" alt="">
                <div>
                  <b>${esc(x.name)}</b>
                  <p class="price">${money(x.price)}</p>
                  <div class="qty-control">
                    <button data-qty="${esc(x.id)}" data-delta="-1">−</button>
                    ${x.quantity}
                    <button data-qty="${esc(x.id)}" data-delta="1">+</button>
                    <button data-remove="${esc(x.id)}">Remove</button>
                  </div>
                </div>
                <b>${money(x.price * x.quantity)}</b>
              </div>
            `
            )
            .join('')}
        </section>
        <aside class="panel">
          <div class="cart-total">
            <span>Subtotal</span>
            <span>${money(subtotal)}</span>
          </div>
          <p class="muted">Delivery charges are confirmed before fulfilment.</p>
          <a class="btn btn-gold" href="/checkout.html">Proceed to checkout ↗</a>
        </aside>
      </div>
    `;
  }

  // ---------- Auth (Login / Register page) ----------
  function auth() {
    const loginForm = $('#loginForm');
    const registerForm = $('#registerForm');
    if (!loginForm || !registerForm) return;

    const referral = new URLSearchParams(location.search).get('ref');
    if (referral && registerForm.elements.referralCode) {
      registerForm.elements.referralCode.value = referral;
    }

    document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll('[data-auth-tab]').forEach((x) =>
          x.classList.toggle('active', x === btn)
        );
        loginForm.hidden = btn.dataset.authTab !== 'login';
        registerForm.hidden = !loginForm.hidden;
      };
    });

    async function send(form, path) {
      const message = $('#authMessage');
      message.textContent = 'Please wait…';
      try {
        await api(path, {
          method: 'POST',
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });
        location.href =
          new URLSearchParams(location.search).get('redirect') || '/dashboard.html';
      } catch (e) {
        message.textContent = e.message;
      }
    }

    loginForm.onsubmit = (e) => {
      e.preventDefault();
      send(loginForm, 'auth/login');
    };

    registerForm.onsubmit = (e) => {
      e.preventDefault();
      send(registerForm, 'auth/register');
    };
  }

  // ---------- Checkout ----------
  function checkout() {
    const form = $('#checkoutForm');
    if (!form) return;

    const cart = getCart();
    const summary = $('#checkoutSummary');

    if (!cart.length) {
      summary.textContent = 'Your bag is empty.';
      form.querySelector('button').disabled = true;
      return;
    }

    const total = cart.reduce((sum, x) => sum + x.price * x.quantity, 0);

    summary.innerHTML = `
      <h2>Order summary</h2>
      ${cart
        .map(
          (x) => `
          <p>${esc(x.name)} × ${x.quantity}
            <b style="float:right">${money(x.price * x.quantity)}</b>
          </p>
        `
        )
        .join('')}
      <div class="cart-total">
        <span>Total</span>
        <span>${money(total)}</span>
      </div>
    `;

    form.onsubmit = async (e) => {
      e.preventDefault();
      const message = $('#checkoutMessage');
      const button = form.querySelector('button');
      button.disabled = true;
      message.textContent = 'Preparing secure payment…';

      try {
        const data = await api('paystack/initialize', {
          method: 'POST',
          body: JSON.stringify({
            customer: Object.fromEntries(new FormData(form)),
            items: cart.map((x) => ({ productId: x.id, quantity: x.quantity })),
          }),
        });
        location.href = data.authorization_url;
      } catch (err) {
        message.textContent = err.message;
        button.disabled = false;
      }
    };
  }

  // ---------- Payment Success ----------
  function payment() {
    if (!location.pathname.endsWith('payment-success.html')) return;

    const ref = new URLSearchParams(location.search).get('reference');
    if (!ref) {
      $('#paymentMessage').textContent = 'Missing payment reference.';
      return;
    }

    api('paystack/verify', {
      method: 'POST',
      body: JSON.stringify({ reference: ref }),
    })
      .then((data) => {
        $('#paymentTitle').textContent = 'Payment confirmed.';
        $('#paymentMessage').textContent = 'Order reference: ' + data.orderId;
        localStorage.removeItem(CART_KEY);
        updateCartCount();
      })
      .catch((e) => {
        $('#paymentTitle').textContent = 'Payment not confirmed.';
        $('#paymentMessage').textContent = e.message;
      });
  }

  // ---------- Nav Auth - uses session already fetched ----------
  function updateNavAuth(sessionData) {
    const account = $('#navAccount');
    const authLink = $('#navAuth');
    const footerAccount = $('#footerAccount');
    if (!authLink) return;

    if (sessionData?.user) {
      // Logged in
      if (account) account.hidden = false;
      if (footerAccount) footerAccount.hidden = false;

      authLink.textContent = 'Sign out';
      authLink.href = '#';
      authLink.onclick = async (e) => {
        e.preventDefault();
        await logout();
        location.href = '/';
      };
    } else {
      // Logged out
      if (account) account.hidden = true;
      if (footerAccount) footerAccount.hidden = true;

      authLink.textContent = 'Sign in / Register';
      authLink.href = '/login.html';
      authLink.onclick = null;
    }
  }

  // ---------- Dashboard - uses SAME session ----------
  function initDashboard(sessionData) {
    const loading = $('#dashboardLoading');
    const content = $('#dashboardContent');
    const message = $('#dashboardMessage');
    if (!loading || !content) return; // not on dashboard page

    // Not logged in -> redirect, no second fetch
    if (!sessionData?.user) {
      loading.textContent = 'Please sign in. Redirecting…';
      location.replace(
        '/login.html?redirect=' + encodeURIComponent('/dashboard.html')
      );
      return;
    }

    const user = sessionData.user;

    // User info
    $('#userName').textContent = user.name;
    $('#userEmail').textContent = user.email;
    $('#userRole').textContent = user.role;

    // Referral
    const referralLink =
      location.origin + '/login.html?ref=' + encodeURIComponent(user.referral_code);

    $('#referralLink').textContent = referralLink;
    $('#referralStats').textContent =
      'Successful referrals: ' + (sessionData.referralCount || 0);

    $('#copyReferral').onclick = async () => {
      await navigator.clipboard.writeText(referralLink);
      message.textContent = 'Referral link copied.';
    };

    // Orders - now uses the strong esc from top
    const orders = sessionData.orders || [];
    $('#orderHistory').innerHTML = orders.length
      ? orders
          .map(
            (order) => `
              <p><b>${esc(order.order_number)}</b> · ${esc(order.status)}</p>
            `
          )
          .join('')
      : '<p class="muted">Your orders will appear here.</p>';

    loading.hidden = true;
    content.hidden = false;

    // Dashboard logout button - same logout() helper
    $('#logoutButton').onclick = async () => {
      await logout();
      location.href = '/login.html';
    };

    // Dashboard small forms
    const forms = [
      ['passwordForm', 'auth/password'],
      ['messageForm', 'messages'],
      ['sellerApplyForm', 'seller/apply'],
    ];

    for (const [formId, apiPath] of forms) {
      const form = $('#' + formId);
      if (!form) continue;

      form.onsubmit = async (e) => {
        e.preventDefault();
        try {
          const response = await fetch('/api/' + apiPath, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.fromEntries(new FormData(form))),
          });
          const result = await response.json();
          if (!response.ok) throw Error(result.error);

          message.textContent = 'Submitted successfully.';
          form.reset();
        } catch (err) {
          message.textContent = err.message;
        }
      };
    }
  }

  // ---------- Init ----------
  async function init() {
    updateCartCount();

    if ($('#year')) {
      $('#year').textContent = new Date().getFullYear();
    }

    // ---------- Testing Warning ----------
function setupTestingWarning() {
  const banner = $('#testingBanner');
  const modal = $('#notifyModal');
  if (!banner || !modal) return;

  // If user don close before, hide banner but still show button? We keep am always for testing
  // If you wan hide after close, uncomment next line:
  // if (localStorage.getItem('davilanco_hide_testing') === '1') banner.hidden = true;

  const openModal = () => { modal.hidden = false; };
  const closeModal = () => { modal.hidden = true; };

  $('#testingNotifyBtn')?.addEventListener('click', openModal);
  $('#notifyCloseBtn')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  $('#testingCloseBtn')?.addEventListener('click', () => {
    banner.hidden = true;
    // localStorage.setItem('davilanco_hide_testing', '1');
  });

  // Subscribe form
  $('#notifyForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#notifyEmail').value.trim();
    const msg = $('#notifyMessage');
    msg.textContent = 'Please wait…';

    try {
      // Save am - use your existing messages API
      await api('messages', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Notify Me Subscriber',
          email: email,
          message: 'Notify me when Davilanco goes live.'
        }),
      });
      msg.textContent = 'Done! We go notify you when we go live. ✅';
      e.target.reset();
      setTimeout(closeModal, 1500);
    } catch (err) {
      // Fallback if API no dey: save for local
      const list = JSON.parse(localStorage.getItem('davilanco_notify_list') || '[]');
      list.push({ email, date: new Date().toISOString() });
      localStorage.setItem('davilanco_notify_list', JSON.stringify(list));
      msg.textContent = 'Saved! We go notify you when we go live. ✅';
    }
  });
}

    // Theme
    document.documentElement.dataset.theme =
      localStorage.getItem('davilanco_theme') || 'dark';

    $('#themeToggle')?.addEventListener('click', () => {
      const theme =
        document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = theme;
      localStorage.setItem('davilanco_theme', theme);
    });

    // Drawer / Menu
    const drawer = $('#navDrawer');
    const backdrop = $('#drawerBackdrop');

    const closeDrawer = () => {
      drawer?.classList.remove('open');
      drawer?.setAttribute('aria-hidden', 'true');
      if (backdrop) backdrop.hidden = true;
      $('#menuToggle')?.setAttribute('aria-expanded', 'false');
    };

    $('#menuToggle')?.addEventListener('click', () => {
      drawer?.classList.add('open');
      drawer?.setAttribute('aria-hidden', 'false');
      if (backdrop) backdrop.hidden = false;
      $('#menuToggle')?.setAttribute('aria-expanded', 'true');
    });

    $('#menuClose')?.addEventListener('click', closeDrawer);
    backdrop?.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
    });

    // Products + Cart
    loadProducts();
    $('#sortProducts')?.addEventListener('change', loadProducts);
    renderCart();

    // Global Clicks: Add / Qty / Remove
    document.addEventListener('click', (e) => {
      const addBtn = e.target.closest('[data-add]');
      if (addBtn) {
        const product = products.find(
          (x) => String(x.id) === addBtn.dataset.add
        );
        if (product) addToCart(product);
      }

      const qtyBtn = e.target.closest('[data-qty]');
      if (qtyBtn) {
        const cart = getCart();
        const item = cart.find((i) => String(i.id) === qtyBtn.dataset.qty);
        if (item) {
          item.quantity += Number(qtyBtn.dataset.delta);
          if (item.quantity < 1) {
            saveCart(cart.filter((y) => y !== item));
          } else {
            saveCart(cart);
          }
          renderCart();
        }
      }

      const removeBtn = e.target.closest('[data-remove]');
      if (removeBtn) {
        saveCart(
          getCart().filter((x) => String(x.id) !== removeBtn.dataset.remove)
        );
        renderCart();
      }
    });

    // Product Detail Page
    const detail = $('#productDetail');
    if (detail) {
      api('products')
        .then((data) => {
          const product = (data.products || []).find(
            (x) =>
              String(x.id) ===
              new URLSearchParams(location.search).get('id')
          );
          if (!product) {
            detail.textContent = 'Product not found.';
            return;
          }

          detail.innerHTML = `
            <div class="product-image">
              ${
                product.image
                  ? `<img src="${esc(product.image)}" alt="${esc(product.name)}">`
                  : '✳'
              }
            </div>
            <div>
              <p class="eyebrow">${esc(product.category)}</p>
              <h1>${esc(product.name)}</h1>
              <p class="price">${money(product.price)}</p>
              <p class="muted">${esc(product.description)}</p>
              <button id="detailAdd" class="btn btn-gold">Add to bag ↗</button>
            </div>
          `;

          $('#detailAdd').onclick = () => addToCart(product);
        })
        .catch((e) => (detail.textContent = e.message));
    }

    auth();
    checkout();
    payment();

    // ONE session fetch for nav + dashboard
    const sessionData = await getSessionOnce();
    updateNavAuth(sessionData);
    initDashboard(sessionData);
  }

  document.addEventListener('DOMContentLoaded', init);
})();