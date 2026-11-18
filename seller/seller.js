(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);

  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );

  // ---------- API ----------
  async function api(path, options = {}) {
    const res = await fetch('/api/' + path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json();
    if (!res.ok) throw Error(data.error || 'Request failed');
    return data;
  }

  //--- Nav Drawer and roll---
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
  
  // ---------- Load seller dashboard ----------
  async function load() {
    try {
      // My products
      const productsData = await api('products?mine=1');
      $('#sellerProducts').innerHTML = (productsData.products || [])
        .map(
          (p) =>
            `<p>${esc(p.name)} · ₦${Number(p.price).toLocaleString()} · ${esc(p.status)}</p>`
        )
        .join('') || 'No listings yet.';

      // My orders
      const ordersData = await api('orders?mine=1');
      $('#sellerOrders').innerHTML = (ordersData.orders || [])
        .map(
          (o) => `
            <p>${esc(o.order_number)} · ${esc(o.status)}
              <select data-seller-order="${o.id}">
                <option value="approved">Approved</option>
                <option value="shipping">Shipping</option>
                <option value="delivered">Delivered</option>
              </select>
              <button data-seller-save="${o.id}">Update</button>
            </p>`
        )
        .join('') || 'No orders yet.';
    } catch (e) {
      $('#sellerMessage').textContent = e.message;
      if (e.message.includes('sign in') || e.message.includes('permissions')) {
        location.href = '/login.html';
      }
    }
  }

  // ---------- Update order status ----------
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-seller-save]');
    if (!btn) return;

    try {
      const select = document.querySelector(
        `[data-seller-order="${btn.dataset.sellerSave}"]`
      );
      const status = select.value;

      await api('orders/status', {
        method: 'PATCH',
        body: JSON.stringify({ orderId: btn.dataset.sellerSave, status }),
      });

      $('#sellerMessage').textContent = 'Order updated.';
      load();
    } catch (err) {
      $('#sellerMessage').textContent = err.message;
    }
  });

  // ---------- Add product ----------
  $('#sellerProductForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('products', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      e.currentTarget.reset();
      $('#sellerMessage').textContent = 'Product submitted for review.';
      load();
    } catch (err) {
      $('#sellerMessage').textContent = err.message;
    }
  };

  // ✅ NEW - BEST LINE TO CALL AM
  document.addEventListener('DOMContentLoaded', () => {
  setupNavDrawerAndRole();
  load();
});
  })();