(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;'
    }[c]));

  async function api(p,o={}){
 let r=await fetch('/api/'+p,{
  credentials:'same-origin',
  headers:{'Content-Type':'application/json'},
  ...o
 });

 let d;
 try {
  d=await r.json();
 } catch {
  throw Error('Server returned an invalid response. HTTP '+r.status);
 }

 if(!r.ok){
  let message=d.error||'Request failed';

  if(d.aliexpress_error_code){
   message+='\nAliExpress error code: '+d.aliexpress_error_code;
  }

  if(d.aliexpress_sub_code){
   message+='\nAliExpress sub-code: '+d.aliexpress_sub_code;
  }

  if(d.aliexpress_request_id){
   message+='\nAliExpress request ID: '+d.aliexpress_request_id;
  }

  throw Error(message);
 }

 return d;
        }

async function setupNavDrawerAndRole(){
  const drawer=document.getElementById('navDrawer');
  const back=document.getElementById('drawerBackdrop');
  const openBtn=document.getElementById('menuToggle');
  const closeBtn=document.getElementById('menuClose');
  const close=()=>{drawer?.classList.remove('open');drawer?.setAttribute('aria-hidden','true');if(back)back.hidden=true;openBtn?.setAttribute('aria-expanded','false')};
  const open=()=>{drawer?.classList.add('open');drawer?.setAttribute('aria-hidden','false');if(back)back.hidden=false;openBtn?.setAttribute('aria-expanded','true')};
  openBtn?.addEventListener('click',open);
  closeBtn?.addEventListener('click',close);
  back?.addEventListener('click',close);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});

  document.getElementById('logoutNav')?.addEventListener('click',async()=>{
    await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});
    location.href='/login.html';
  });

  try{
    const r=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'});
    if(!r.ok)return;
    const {user:u}=await r.json();
    const navSeller=document.getElementById('navSeller');
    const navAdmin=document.getElementById('navAdmin');
    if(navSeller)navSeller.hidden=!['seller','admin'].includes(u.role);
    if(navAdmin)navAdmin.hidden=u.role!=='admin';
  }catch{}
}
  
  async function loadAeSupplierOrders() {
    if (!$('#aeSupplierOrders')) return;
    try {
      let d = await api('aliexpress/supplier-orders');
      $('#aeSupplierOrders').innerHTML =
        '<table class="admin-table"><tr><th>Local order</th><th>Supplier status</th><th>Payment status</th><th>Actions</th></tr>' +
        (d.orders || []).map((x) =>
          '<tr><td>' + esc(x.order_number) + '</td><td>' + esc(x.status) + '</td><td>' + esc(x.payment_status) + '</td><td>' +
          (x.status === 'awaiting_admin_approval'
            ? '<button data-ae-decision="approve" data-ae-id="' + esc(x.id) + '">Approve order</button> <button data-ae-decision="reject" data-ae-id="' + esc(x.id) + '">Reject</button>'
            : '') +
          (x.status === 'approved_for_submission' && x.payment_status === 'not_requested'
            ? '<button data-ae-decision="approve_payment" data-ae-id="' + esc(x.id) + '">Approve payment separately</button>'
            : '') +
          '</td></tr>'
        ).join('') +
        '</table>' || 'No supplier orders.';
    } catch (e) {
      $('#aeSupplierOrders').textContent = e.message;
    }
  }

  async function load() {
    try {
      try {
        let ae = await api('aliexpress/status');
        $('#aeConnectionStatus').textContent = ae.connected
          ? 'Connected · access token expires ' + (ae.access_expires_at || 'unknown')
          : 'Not connected';
        await loadAeSupplierOrders();
      } catch (aeError) {
        $('#aeConnectionStatus').textContent = 'Connection status unavailable: ' + aeError.message;
      }

      let d = await api('analytics');
      $('#adminStats').innerHTML = Object.entries(d.stats)
        .map(([k, v]) => '<div class="admin-stat"><b>' + Number(v).toLocaleString() + '</b><span>' + esc(k.replace(/_/g, ' ')) + '</span></div>')
        .join('');

      let o = await api('orders');
      $('#adminOrders').innerHTML =
        '<table class="admin-table"><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Update</th></tr>' +
        (o.orders || []).map((x) =>
          '<tr><td>' + esc(x.order_number) + '</td><td>' + esc(x.customer_email) + '</td><td>₦' + Number(x.total).toLocaleString() + '</td><td>' + esc(x.status) + '</td><td>' +
          '<select data-order="' + x.id + '"><option>pending</option><option>approved</option><option>shipping</option><option>delivered</option><option>cancelled</option></select>' +
          '<button data-save-order="' + x.id + '">Save</button>' +
          (x.payment_status === 'paid' ? '<button data-ae-prepare="' + x.id + '">Queue supplier review</button>' : '') +
          '</td></tr>'
        ).join('') +
        '</table>';

      let a = await api('seller/applications');
      $('#sellerApplications').innerHTML = (a.applications || [])
        .map((x) => '<p>' + esc(x.business_name) + ' — ' + esc(x.user_email) + ' <button data-application="' + x.id + '" data-status="approved">Approve</button> <button data-application="' + x.id + '" data-status="rejected">Reject</button></p>')
        .join('') || 'No pending applications.';

      let p = await api('products');
      $('#adminProducts').innerHTML = (p.products || [])
        .map((x) =>
          '<p>' +
          esc(x.name) +
          ' · ₦' + Number(x.price).toLocaleString() +
          ' · Stock: <b>' + Number(x.stock || 0) + '</b>' +
          '<br><div class="stock-editor" style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">' +
          '<select data-stock-action="' + esc(x.id) + '">' +
          '<option value="set">Set stock</option>' +
          '<option value="increase">Increase</option>' +
      '<option value="reduce">Reduce</option>' +
       '</select>' +
      '<input type="number" min="0" max="100000000" step="1" placeholder="Quantity" data-stock-quantity="' + esc(x.id) + '" style="width:110px">' +
      '<button type="button" data-save-stock="' + esc(x.id) + '">Save stock</button>' +
     '</div>' +
' · <b>' + esc(x.status) + '</b>' +
           (x.status === 'pending'
            ? ' <button data-product-status="' + esc(x.id) + '" data-status="active">Approve</button>' +
              ' <button data-product-status="' + esc(x.id) + '" data-status="rejected">Reject</button>'
            : '') +
          ' <button data-delete-product="' + esc(x.id) + '">Delete</button></p>'
        )
        .join('') || 'No products yet.';

      let users = await api('users');
      $('#adminUsers').innerHTML =
        '<table class="admin-table"><tr><th>Name</th><th>Email</th><th>Role</th><th>Change role</th></tr>' +
        (users.users || []).map((x) =>
          '<tr><td>' + esc(x.name) + '</td><td>' + esc(x.email) + '</td><td>' + esc(x.role) + '</td><td>' +
          '<select data-user-role="' + x.id + '">' +
          '<option value="customer" ' + (x.role === 'customer' ? 'selected' : '') + '>Customer</option>' +
          '<option value="seller" ' + (x.role === 'seller' ? 'selected' : '') + '>Seller</option>' +
          '<option value="admin" ' + (x.role === 'admin' ? 'selected' : '') + '>Admin</option>' +
          '</select><button data-save-user="' + x.id + '">Save</button></td></tr>'
        ).join('') +
        '</table>';

      let messages = await api('messages');
      $('#adminMessages').innerHTML = (messages.messages || [])
        .map((x) => '<article class="message-item"><b>' + esc(x.name) + ' · ' + esc(x.email) + '</b><p>' + esc(x.body) + '</p><small>' + esc(x.created_at) + '</small></article>')
        .join('') || 'No customer messages.';
    } catch (e) {
      $('#adminMessage').textContent = e.message;
      if (e.message.includes('permissions') || e.message.includes('sign in')) {
        location.href = '/login.html';
      }
    }
  }

  document.querySelector('#aeSearchForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    let msg = $('#aeSearchMessage');
    let box = $('#aeSearchResults');
    msg.textContent = 'Searching AliExpress…';
    box.innerHTML = '';
    try {
      let d = await api('aliexpress/search', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))
      });
      msg.textContent = (d.totalCount || 0) + ' supplier results';
      box.innerHTML = (d.products || [])
        .map((x) =>
          '<article class="ae-result"><img src="' + esc(x.image) + '" alt=""><div><b>' + esc(x.title) + '</b><p>' + esc(x.price) + ' ' + esc(x.orders) + '</p><small>' + esc(x.product_id) + '</small></div><button data-ae-import="' + esc(x.product_id) + '" data-ae-url="' + esc(x.product_url) + '">Import pending</button></article>'
        ).join('') || 'No products found.';
    } catch (x) {
      msg.textContent = x.message;
    }
  });

  document.addEventListener('click', async (e) => {
    try {
      let aeDetails = e.target.closest('[data-ae-details]');
      if (aeDetails) {
        let d = await api('aliexpress/details', {
          method: 'POST',
          body: JSON.stringify({
            product_id: aeDetails.dataset.aeDetails,
            ship_to_country: 'NG',
            target_currency: 'USD',
            target_language: 'en'
          })
        });
        let p = d.product || {};
        let skus = p.ae_item_sku_info_dtos || [];
        if (!skus.length) {
          $('#aeSearchMessage').textContent = 'Product details loaded, but no selectable SKU was returned.';
          return;
        }
        let choices = skus
          .map((s, i) => i + ': ' + String(s.sku_id) + ' · ' + String(s.offer_sale_price || s.sku_price || 'price unavailable') + ' · stock ' + String(s.sku_available_stock || 0))
          .join('\n');
        let selected = prompt('Choose SKU by list number for a freight quote:\n' + choices, '0');
        if (selected !== null) {
          let sku = skus[Number(selected)];
          if (!sku) {
            $('#aeSearchMessage').textContent = 'Invalid SKU selection.';
            return;
          }
          let q = await api('aliexpress/freight', {
            method: 'POST',
            body: JSON.stringify({
              queryDeliveryReq: {
                quantity: 1,
                shipToCountry: 'NG',
                productId: aeDetails.dataset.aeDetails,
                selectedSkuId: String(sku.sku_id),
                language: 'en',
                currency: 'USD',
                locale: 'en_US'
              }
            })
          });
          $('#aeSearchMessage').textContent = 'Freight quote response: ' + JSON.stringify(q.quote).slice(0, 1800);
        }
      }

      let aeImport = e.target.closest('[data-ae-import]');
      if (aeImport) {
        let price = prompt('Enter your selling price in NGN. The imported product will remain pending until approved:');
        if (price && Number(price) > 0) {
          await api('aliexpress/import', {
            method: 'POST',
            body: JSON.stringify({
              product_id: aeImport.dataset.aeImport,
              product_url: aeImport.dataset.aeUrl,
              selling_price: price
            })
          });
          $('#aeSearchMessage').textContent = 'Imported successfully. Product is pending admin approval.';
          load();
        }
      }

      let aePrepare = e.target.closest('[data-ae-prepare]');
      if (aePrepare) {
        await api('aliexpress/supplier-orders/prepare', {
          method: 'POST',
          body: JSON.stringify({ order_id: aePrepare.dataset.aePrepare })
        });
        await loadAeSupplierOrders();
        $('#adminMessage').textContent = 'Order queued for supplier review. No supplier order was submitted.';
      }

      let aeDecision = e.target.closest('[data-ae-decision]');
      if (aeDecision) {
        let note = prompt('Optional note for the approval record:') || '';
        await api('aliexpress/supplier-orders/decision', {
          method: 'POST',
          body: JSON.stringify({
            supplier_order_id: aeDecision.dataset.aeId,
            decision: aeDecision.dataset.aeDecision,
            note
          })
        });
        await loadAeSupplierOrders();
        $('#adminMessage').textContent = 'Decision recorded. No supplier order or payment was executed.';
      }

      let a = e.target.closest('[data-save-order]');
      if (a) {
        await api('orders/status', {
          method: 'PATCH',
          body: JSON.stringify({
            orderId: a.dataset.saveOrder,
            status: document.querySelector('[data-order="' + a.dataset.saveOrder + '"]').value
          })
        });
        load();
      }

      let b = e.target.closest('[data-application]');
      if (b) {
        await api('seller/applications', {
          method: 'PATCH',
          body: JSON.stringify({ applicationId: b.dataset.application, status: b.dataset.status })
        });
        load();
      }

      let u = e.target.closest('[data-save-user]');
      if (u) {
        let role = document.querySelector('[data-user-role="' + u.dataset.saveUser + '"]').value;
        await api('users/role', {
          method: 'PATCH',
          body: JSON.stringify({ userId: u.dataset.saveUser, role })
        });
        load();
      }

            let stockSave = e.target.closest('[data-save-stock]');
      if (stockSave) {
        const productId = stockSave.dataset.saveStock;
        const adjustment = document.querySelector(
          '[data-stock-action="' + productId + '"]'
        ).value;

        const quantityInput = document.querySelector(
          '[data-stock-quantity="' + productId + '"]'
        );

        const quantity = Number(quantityInput.value);
        const min = adjustment === 'set' ? 0 : 1;

        if (
          quantityInput.value.trim() === '' ||
          !Number.isSafeInteger(quantity) ||
          quantity < min ||
          quantity > 100000000
        ) {
          throw Error(
            adjustment === 'set'
              ? 'Enter a valid stock quantity.'
              : 'Enter a whole-number adjustment greater than zero.'
          );
        }

        await api('products/stock', {
          method: 'PATCH',
          body: JSON.stringify({
            productId,
            adjustment,
            quantity
          })
        });

        $('#adminMessage').textContent = 'Stock updated successfully.';
        await load();
        return;
      }
      
      let ps = e.target.closest('[data-product-status]');
      if (ps) {
        await api('products/status', {
          method: 'PATCH',
          body: JSON.stringify({
            productId: ps.dataset.productStatus,
            status: ps.dataset.status
          })
        });
        load();
        return;
      }

      let c = e.target.closest('[data-delete-product]');
      if (c && confirm('Delete product?')) {
        await api('products/' + c.dataset.deleteProduct, { method: 'DELETE' });
        load();
      }
    } catch (x) {
      $('#adminMessage').textContent = x.message;
    }
  });

  $('#productForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('products', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))
      });
      e.currentTarget.reset();
      load();
    } catch (x) {
      $('#adminMessage').textContent = x.message;
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
  setupNavDrawerAndRole();
  load();
});
})();
