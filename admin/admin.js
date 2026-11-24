  async function load() {
    // Each section loads independently.
    // A failure in one section will not stop the others.

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

    const tasks = [];

    // AliExpress connection status
    tasks.push(loadSection(
      'aeConnectionStatus',
      'AliExpress connection',
      async () => {
        const ae = await api('aliexpress/status');

        $('#aeConnectionStatus').textContent = ae.connected
          ? 'Connected · access token expires ' +
            (ae.access_expires_at || 'unknown')
          : 'Not connected';
      }
    ));

    // AliExpress supplier orders
    tasks.push(loadSection(
      'aeSupplierOrders',
      'AliExpress supplier approvals',
      async () => {
        await loadAeSupplierOrders();
      }
    ));

    // Analytics
    tasks.push(loadSection(
      'adminStats',
      'Analytics',
      async () => {
        const d = await api('analytics');

        $('#adminStats').innerHTML = Object.entries(d.stats || {})
          .map(([k, v]) =>
            '<div class="admin-stat"><b>' +
            Number(v).toLocaleString() +
            '</b><span>' +
            esc(k.replace(/_/g, ' ')) +
            '</span></div>'
          )
          .join('') || 'No statistics available.';
      }
    ));

    // Orders
    tasks.push(loadSection(
      'adminOrders',
      'Orders',
      async () => {
        const o = await api('orders');

        $('#adminOrders').innerHTML =
          '<table class="admin-table"><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Update</th></tr>' +
          (o.orders || []).map((x) =>
            '<tr><td>' + esc(x.order_number) +
            '</td><td>' + esc(x.customer_email) +
            '</td><td>₦' + Number(x.total).toLocaleString() +
            '</td><td>' + esc(x.status) +
            '</td><td>' +
            '<select data-order="' + x.id + '">' +
            '<option>pending</option><option>approved</option>' +
            '<option>shipping</option><option>delivered</option>' +
            '<option>cancelled</option></select>' +
            '<button data-save-order="' + x.id + '">Save</button>' +
            (x.payment_status === 'paid'
              ? '<button data-ae-prepare="' + x.id +
                '">Queue supplier review</button>'
              : '') +
            '</td></tr>'
          ).join('') +
          '</table>' || 'No orders found.';
      }
    ));

    // Seller applications
    tasks.push(loadSection(
      'sellerApplications',
      'Seller applications',
      async () => {
        const a = await api('seller/applications');

        $('#sellerApplications').innerHTML =
          (a.applications || []).map((x) =>
            '<p>' + esc(x.business_name) +
            ' — ' + esc(x.user_email) +
            ' <button data-application="' + x.id +
            '" data-status="approved">Approve</button>' +
            ' <button data-application="' + x.id +
            '" data-status="rejected">Reject</button></p>'
          ).join('') || 'No pending applications.';
      }
    ));

    // Products
    tasks.push(loadSection(
      'adminProducts',
      'Products',
      async () => {
        const p = await api('products');

        $('#adminProducts').innerHTML =
          (p.products || []).map((x) =>
            '<p>' +
            esc(x.name) +
            ' · ₦' + Number(x.price).toLocaleString() +
            ' · Stock: <b>' + Number(x.stock || 0) + '</b>' +

            '<br><div class="stock-editor" style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">' +

            '<select data-stock-action="' + x.id + '">' +
            '<option value="set">Set stock</option>' +
            '<option value="increase">Increase</option>' +
            '<option value="reduce">Reduce</option>' +
            '</select>' +

            '<input data-stock-quantity="' + x.id +
            '" type="number" min="1">' +

            '<button data-save-stock="' + x.id +
            '">Save stock</button>' +

            '</div>' +

            ' · <b>' + esc(x.status) + '</b>' +

            (x.status === 'pending'
              ? ' <button data-product-status="' + esc(x.id) +
                '" data-status="active">Approve</button>' +
                ' <button data-product-status="' + esc(x.id) +
                '" data-status="rejected">Reject</button>'
              : '') +

            ' <button data-delete-product="' +
            esc(x.id) + '">Delete</button></p>'
          ).join('') || 'No products yet.';
      }
    ));

    // Users
    tasks.push(loadSection(
      'adminUsers',
      'Users',
      async () => {
        const users = await api('users');

        $('#adminUsers').innerHTML =
          '<table class="admin-table"><tr><th>Name</th><th>Email</th><th>Role</th><th>Change role</th></tr>' +
          (users.users || []).map((x) =>
            '<tr><td>' + esc(x.name) +
            '</td><td>' + esc(x.email) +
            '</td><td>' + esc(x.role) +
            '</td><td>' +

            '<select data-user-role="' + x.id + '">' +
            '<option value="customer" ' +
            (x.role === 'customer' ? 'selected' : '') +
            '>Customer</option>' +

            '<option value="seller" ' +
            (x.role === 'seller' ? 'selected' : '') +
            '>Seller</option>' +

            '<option value="admin" ' +
            (x.role === 'admin' ? 'selected' : '') +
            '>Admin</option>' +

            '</select>' +

            '<button data-save-user="' + x.id +
            '">Save</button></td></tr>'
          ).join('') +
          '</table>' || 'No users found.';
      }
    ));

    // Customer messages
    tasks.push(loadSection(
      'adminMessages',
      'Customer messages',
      async () => {
        const messages = await api('messages');

        $('#adminMessages').innerHTML =
          (messages.messages || []).map((x) =>
            '<article class="message-item">' +
            '<b>' + esc(x.name) + ' · ' +
            esc(x.email) + '</b>' +
            '<p>' + esc(x.body) + '</p>' +
            '<small>' + esc(x.created_at) + '</small>' +
            '</article>'
          ).join('') || 'No customer messages.';
      }
    ));

    // Wait for all sections without allowing one failure
    // to interrupt another.
    await Promise.allSettled(tasks);
  }