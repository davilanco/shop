(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

  const esc = (value) => String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]
  );

  const money = (value) =>
    '₦' + Number(value || 0).toLocaleString();

  async function api(endpoint, options = {}) {
    const response = await fetch('/api/' + endpoint.replace(/^\/+/, ''), {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error('The server returned an unreadable response.');
    }

    if (!response.ok) {
      throw new Error(data.error || 'Request failed.');
    }

    return data;
  }

  const post = (endpoint, data) => api(endpoint, {
    method: 'POST',
    body: JSON.stringify(data)
  });

  const patch = (endpoint, data) => api(endpoint, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });

  function message(text, isError = false) {
    const element = $('#adminMessage');
    if (!element) return;

    element.textContent = text;
    element.classList.toggle('error', isError);
  }

  function setMessage(element, text, isError = false) {
    if (!element) return;

    element.textContent = text;
    element.style.color = isError ? '#e05252' : '';
  }

  async function requireAdmin() {
    const result = await api('auth/me');

    if (result.role !== 'admin') {
      location.replace('/login.html');
      return false;
    }

    return true;
  }

  async function logout() {
    try {
      await post('auth/logout', {});
    } finally {
      location.replace('/login.html');
    }
  }

  async function loadSection(elementId, sectionName, callback) {
    const element = $('#' + elementId);
    if (!element) return;

    element.textContent = 'Loading…';

    try {
      await callback();
    } catch (error) {
      console.error(sectionName + ' loading failed:', error);
      element.textContent =
        sectionName + ' could not load: ' +
        (error.message || 'Unknown error.');
    }
  }

  // ==========================================
  // ANALYTICS
  // ==========================================

  async function loadAnalytics() {
    const data = await api('analytics');

    $('#adminStats').innerHTML = Object.entries(data.stats || {})
      .map(([key, value]) =>
        '<div class="admin-stat">' +
          '<b>' + Number(value).toLocaleString() + '</b>' +
          '<span>' + esc(key.replace(/_/g, ' ')) + '</span>' +
        '</div>'
      )
      .join('') || 'No statistics available.';
  }

  // ==========================================
  // ALIEXPRESS CONNECTION
  // ==========================================

  async function loadAeConnection() {
    const data = await api('aliexpress/status');

    $('#aeConnectionStatus').textContent = data.connected
      ? 'Connected · access token expires ' +
        (data.access_expires_at || 'unknown')
      : 'Not connected';
  }

  // ==========================================
  // ALIEXPRESS SUPPLIER ORDERS
  // ==========================================

  async function loadAeSupplierOrders() {
    const data = await api('aliexpress/supplier-orders');
    const orders = data.orders || [];

    $('#aeSupplierOrders').innerHTML = orders.map((order) => {
      const awaiting = order.status === 'awaiting_admin_approval';
      const approved = order.status === 'approved_for_submission';
      const paymentNotRequested = order.payment_status === 'not_requested';

      return `
        <article class="message-item">
          <b>Supplier review: ${esc(order.out_order_id || order.id)}</b>
          <p>Local order: ${esc(order.order_number || order.local_order_id)}</p>
          <p>Order total: ${money(order.total)}</p>
          <p>Order status: <b>${esc(order.status)}</b></p>
          <p>Payment status: <b>${esc(order.payment_status)}</b></p>

          ${
            awaiting
              ? `
                <button
                  type="button"
                  data-supplier-decision="${esc(order.id)}"
                  data-decision="approve">
                  Approve order review
                </button>

                <button
                  type="button"
                  data-supplier-decision="${esc(order.id)}"
                  data-decision="reject">
                  Reject
                </button>
              `
              : ''
          }

          ${
            approved && paymentNotRequested
              ? `
                <button
                  type="button"
                  data-supplier-decision="${esc(order.id)}"
                  data-decision="approve_payment">
                  Approve supplier payment separately
                </button>
              `
              : ''
          }
        </article>
      `;
    }).join('') || 'No supplier orders awaiting review.';
  }

  // ==========================================
  // ORDERS
  // ==========================================

  async function loadOrders() {
    const data = await api('orders');

    $('#adminOrders').innerHTML =
      '<table class="admin-table">' +
        '<tr>' +
          '<th>Order</th>' +
          '<th>Customer</th>' +
          '<th>Total</th>' +
          '<th>Payment</th>' +
          '<th>Status</th>' +
          '<th>Update</th>' +
        '</tr>' +

        (data.orders || []).map((order) => `
          <tr>
            <td>${esc(order.order_number)}</td>
            <td>${esc(order.customer_email)}</td>
            <td>${money(order.total)}</td>
            <td>${esc(order.payment_status)}</td>
            <td>${esc(order.status)}</td>
            <td>
              <select data-order-status="${esc(order.id)}">
                <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="approved" ${order.status === 'approved' ? 'selected' : ''}>Approved</option>
                <option value="shipping" ${order.status === 'shipping' ? 'selected' : ''}>Shipping</option>
                <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Delivered</option>
                <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
              </select>

              <button type="button" data-save-order="${esc(order.id)}">
                Save
              </button>

              ${
                order.payment_status === 'paid'
                  ? `
                    <button type="button" data-ae-prepare="${esc(order.id)}">
                      Queue supplier review
                    </button>
                  `
                  : ''
              }
            </td>
          </tr>
        `).join('') +
      '</table>' ||
      'No orders found.';
  }

  // ==========================================
  // SELLER APPLICATIONS
  // ==========================================

  async function loadSellerApplications() {
    const data = await api('seller/applications');

    $('#sellerApplications').innerHTML =
      (data.applications || []).map((application) => `
        <article class="message-item">
          <b>${esc(application.business_name)}</b>
          <p>Applicant: ${esc(application.user_name || application.user_email)}</p>
          <p>Email: ${esc(application.user_email)}</p>
          <p>Details: ${esc(application.details)}</p>
          <p>Status: ${esc(application.status)}</p>

          ${
            application.document_url
              ? `<p><a href="${esc(application.document_url)}" target="_blank" rel="noopener noreferrer">View submitted document</a></p>`
              : ''
          }

          ${
            application.status === 'pending'
              ? `
                <button
                  type="button"
                  data-application="${esc(application.id)}"
                  data-status="approved">
                  Approve
                </button>

                <button
                  type="button"
                  data-application="${esc(application.id)}"
                  data-status="rejected">
                  Reject
                </button>
              `
              : ''
          }
        </article>
      `).join('') || 'No seller applications found.';
  }

  // ==========================================
  // PRODUCTS
  // ==========================================

  async function loadProducts() {
    const data = await api('products');

    $('#adminProducts').innerHTML =
      (data.products || []).map((product) => `
        <article class="message-item">
          <b>${esc(product.name)}</b>
          <p>${money(product.price)} · Stock: ${Number(product.stock || 0)}</p>
          <p>Status: <b>${esc(product.status)}</b></p>

          <div class="stock-editor" style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">
            <select data-stock-action="${esc(product.id)}">
              <option value="set">Set stock</option>
              <option value="increase">Increase</option>
              <option value="reduce">Reduce</option>
            </select>

            <input
              data-stock-quantity="${esc(product.id)}"
              type="number"
              min="0"
              step="1"
              placeholder="Quantity"
            >

            <button type="button" data-save-stock="${esc(product.id)}">
              Save stock
            </button>
          </div>

          ${
            product.status === 'pending'
              ? `
                <button
                  type="button"
                  data-product-status="${esc(product.id)}"
                  data-status="active">
                  Approve
                </button>

                <button
                  type="button"
                  data-product-status="${esc(product.id)}"
                  data-status="rejected">
                  Reject
                </button>
              `
              : ''
          }

          <button
            type="button"
            data-delete-product="${esc(product.id)}">
            Delete product
          </button>
        </article>
      `).join('') || 'No products found.';
  }

  // ==========================================
  // USERS
  // ==========================================

  async function loadUsers() {
    const data = await api('users');

    $('#adminUsers').innerHTML =
      '<table class="admin-table">' +
        '<tr><th>Name</th><th>Email</th><th>Role</th><th>Change role</th></tr>' +

        (data.users || []).map((user) => `
          <tr>
            <td>${esc(user.name)}</td>
            <td>${esc(user.email)}</td>
            <td>${esc(user.role)}</td>
            <td>
              <select data-user-role="${esc(user.id)}">
                <option value="customer" ${user.role === 'customer' ? 'selected' : ''}>Customer</option>
                <option value="seller" ${user.role === 'seller' ? 'selected' : ''}>Seller</option>
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
              </select>

              <button type="button" data-save-user="${esc(user.id)}">
                Save
              </button>
            </td>
          </tr>
        `).join('') +
      '</table>' ||
      'No users found.';
  }

  // ==========================================
  // CUSTOMER MESSAGES
  // ==========================================

  async function loadMessages() {
    const data = await api('messages');

    $('#adminMessages').innerHTML =
      (data.messages || []).map((item) => `
        <article class="message-item">
          <b>${esc(item.name)} · ${esc(item.email)}</b>
          <p>${esc(item.body)}</p>
          <small>${esc(item.created_at)}</small>
        </article>
      `).join('') || 'No customer messages.';
  }

  // ==========================================
  // LOAD ALL DASHBOARD SECTIONS
  // ==========================================

  async function load() {
    const tasks = [
      loadSection('aeConnectionStatus', 'AliExpress connection', loadAeConnection),
      loadSection('aeSupplierOrders', 'AliExpress supplier approvals', loadAeSupplierOrders),
      loadSection('adminStats', 'Analytics', loadAnalytics),
      loadSection('adminOrders', 'Orders', loadOrders),
      loadSection('sellerApplications', 'Seller applications', loadSellerApplications),
      loadSection('adminProducts', 'Products', loadProducts),
      loadSection('adminUsers', 'Users', loadUsers),
      loadSection('adminMessages', 'Customer messages', loadMessages)
    ];

    await Promise.allSettled(tasks);
  }

  // ==========================================
  // CREATE PRODUCT
  // ==========================================

  async function createProduct(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"], button:not([type])');

    const formData = new FormData(form);

    const product = {
      name: formData.get('name'),
      price: Number(formData.get('price')),
      category: formData.get('category'),
      image: formData.get('image'),
      description: formData.get('description'),
      stock: Number(formData.get('stock'))
    };

    try {
      if (button) button.disabled = true;

      await post('products', product);

      message('Product created successfully.');
      form.reset();

      await loadSection('adminProducts', 'Products', loadProducts);
      await loadSection('adminStats', 'Analytics', loadAnalytics);

    } catch (error) {
      message(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  // ==========================================
  // ALIEXPRESS PRODUCT SEARCH
  // ==========================================

  async function searchAliExpress(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);
    const output = $('#aeSearchResults');
    const status = $('#aeSearchMessage');

    output.innerHTML = '';
    setMessage(status, 'Searching AliExpress…');

    try {
      const result = await post('aliexpress/search', {
        keyWord: data.get('keyWord'),
        currency: data.get('currency'),
        countryCode: data.get('countryCode'),
        local: data.get('local')
      });

      output.innerHTML = (result.products || []).map((product) => `
        <article class="ae-result">
          <img src="${esc(product.image)}" alt="">
          <div>
            <b>${esc(product.title)}</b>
            <p>Product ID: ${esc(product.product_id)}</p>
            <p>Price: ${esc(product.price)}</p>
            <small>Orders: ${esc(product.orders)}</small>
          </div>

          <button
            type="button"
            data-ae-import="${esc(product.product_id)}"
            data-ae-url="${esc(product.product_url || '')}">
            Import product
          </button>
        </article>
      `).join('') || 'No products found.';

      setMessage(status, 'Search completed.');

    } catch (error) {
      setMessage(status, error.message, true);
    }
  }

  // ==========================================
  // EVENT DELEGATION
  // ==========================================

  async function handleClick(event) {
    const button = event.target.closest('button');
    if (!button) return;

    try {
      // Logout
      if (
        button.id === 'logoutNav' ||
        button.id === 'logoutButton'
      ) {
        await logout();
        return;
      }

      // Save order status
      if (button.dataset.saveOrder) {
        const id = button.dataset.saveOrder;
        const select = document.querySelector(
          `[data-order-status="${CSS.escape(id)}"]`
        );

        if (!select) return;

        button.disabled = true;

        await patch('orders/status', {
          orderId: id,
          status: select.value
        });

        message('Order status updated.');
        await loadOrders();
        return;
      }

      // Queue supplier review
      if (button.dataset.aePrepare) {
        if (!confirm('Queue this paid order for supplier review? No supplier order or payment will be submitted.')) {
          return;
        }

        button.disabled = true;

        await post('aliexpress/prepare-supplier-order', {
          order_id: button.dataset.aePrepare
        });

        message('Order queued for admin supplier review. No supplier order was placed.');
        await loadAeSupplierOrders();
        return;
      }

      // Supplier order decisions
      if (button.dataset.supplierDecision) {
        const decision = button.dataset.decision;

        const prompts = {
          approve: 'Approve this supplier order for submission review? This will NOT place the order.',
          reject: 'Reject this supplier order review?',
          approve_payment: 'Separately approve supplier payment? This will NOT make a payment.'
        };

        if (!confirm(prompts[decision] || 'Continue?')) return;

        button.disabled = true;

        await post('aliexpress/supplier-order-decision', {
          supplier_order_id: button.dataset.supplierDecision,
          decision
        });

        message('Supplier review decision recorded. No supplier order or payment was submitted.');
        await loadAeSupplierOrders();
        return;
      }

      // Seller application decisions
      if (button.dataset.application) {
        const id = button.dataset.application;
        const status = button.dataset.status;

        if (!confirm(
          status === 'approved'
            ? 'Approve this seller application and change the applicant role to seller?'
            : 'Reject this seller application?'
        )) return;

        button.disabled = true;

        await patch('seller/applications', {
          applicationId: id,
          status
        });

        message('Seller application reviewed.');
        await Promise.all([
          loadSellerApplications(),
          loadUsers()
        ]);
        return;
      }

      // Product status
      if (button.dataset.productStatus) {
        const productId = button.dataset.productStatus;
        const status = button.dataset.status;

        if (!confirm('Change this product status to ' + status + '?')) return;

        button.disabled = true;

        await patch('products/status', {
          productId,
          status
        });

        message('Product status updated.');
        await loadProducts();
        return;
      }

      // Stock adjustment
      if (button.dataset.saveStock) {
        const id = button.dataset.saveStock;

        const action = document.querySelector(
          `[data-stock-action="${CSS.escape(id)}"]`
        );

        const quantityInput = document.querySelector(
          `[data-stock-quantity="${CSS.escape(id)}"]`
        );

        const quantity = Number(quantityInput?.value);

        if (
          !action ||
          !Number.isSafeInteger(quantity) ||
          quantity < 0
        ) {
          throw new Error('Enter a valid non-negative stock quantity.');
        }

        button.disabled = true;

        await patch('products/stock', {
          productId: id,
          adjustment: action.value,
          quantity
        });

        message('Product stock updated.');
        await loadProducts();
        return;
      }

      // Delete product
      if (button.dataset.deleteProduct) {
        if (!confirm('Permanently delete this product?')) return;

        button.disabled = true;

        await fetch('/api/products/' + encodeURIComponent(button.dataset.deleteProduct), {
          method: 'DELETE',
          credentials: 'same-origin'
        }).then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Delete failed.');
          return data;
        });

        message('Product deleted.');
        await loadProducts();
        return;
      }

      // Change user role
      if (button.dataset.saveUser) {
        const id = button.dataset.saveUser;

        const select = document.querySelector(
          `[data-user-role="${CSS.escape(id)}"]`
        );

        if (!select) return;

        button.disabled = true;

        await patch('users/role', {
          userId: id,
          role: select.value
        });

        message('User role updated.');
        await loadUsers();
        return;
      }

      // Import AliExpress product
      if (button.dataset.aeImport) {
        const sellingPrice = prompt('Enter the selling price in NGN:');

        if (sellingPrice === null) return;

        const price = Number(sellingPrice);

        if (!Number.isSafeInteger(price) || price < 1) {
          throw new Error('Enter a valid selling price.');
        }

        button.disabled = true;

        await post('aliexpress/import', {
          product_id: button.dataset.aeImport,
          selling_price: price,
          product_url: button.dataset.aeUrl || undefined
        });

        message('AliExpress product imported as pending. Admin approval is still required.');
        await loadProducts();
        return;
      }

    } catch (error) {
      message(error.message || 'The operation failed.', true);
      button.disabled = false;
    }
  }

  // ==========================================
  // THEME + MENU (self-contained; no script.js)
  // ==========================================

  function initChrome() {
    const root = document.documentElement;
    root.dataset.theme = localStorage.getItem('davilanco_theme') || 'dark';

    const themeToggle = $('#themeToggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
        root.dataset.theme = theme;
        localStorage.setItem('davilanco_theme', theme);
      });
    }

    const drawer = $('#navDrawer');
    const backdrop = $('#drawerBackdrop');
    const menuToggle = $('#menuToggle');
    const menuClose = $('#menuClose');

    const closeDrawer = () => {
      if (drawer) {
        drawer.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
      }
      if (backdrop) backdrop.hidden = true;
      if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
    };

    const openDrawer = () => {
      if (drawer) {
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
      }
      if (backdrop) backdrop.hidden = false;
      if (menuToggle) menuToggle.setAttribute('aria-expanded', 'true');
    };

    if (menuToggle) menuToggle.addEventListener('click', openDrawer);
    if (menuClose) menuClose.addEventListener('click', closeDrawer);
    if (backdrop) backdrop.addEventListener('click', closeDrawer);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDrawer();
    });

    // Admin is already verified as admin — show admin nav link.
    const navAdmin = $('#navAdmin');
    if (navAdmin) navAdmin.hidden = false;
  }

  // ==========================================
  // START
  // ==========================================

  async function start() {
    initChrome();

    try {
      const allowed = await requireAdmin();
      if (!allowed) return;

      const productForm = $('#productForm');
      if (productForm) {
        productForm.addEventListener('submit', createProduct);
      }

      const searchForm = $('#aeSearchForm');
      if (searchForm) {
        searchForm.addEventListener('submit', searchAliExpress);
      }

      document.addEventListener('click', handleClick);

      await load();

    } catch (error) {
      console.error('Admin dashboard initialization failed:', error);
      message(error.message || 'Unable to load the admin dashboard.', true);

      if (error.message.includes('sign in')) {
        location.replace('/login.html');
      }
    }
  }

  document.addEventListener('DOMContentLoaded', start);

})();