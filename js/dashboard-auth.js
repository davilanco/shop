document.addEventListener('DOMContentLoaded', async () => {
  const $ = (selector) => document.querySelector(selector);

  const loading = $('#dashboardLoading');
  const content = $('#dashboardContent');
  const message = $('#dashboardMessage');

  try {
    // ---------- 1. Check session ----------
    const res = await fetch('/api/session', {
      credentials: 'same-origin',
      cache: 'no-store',
    });

    if (!res.ok) throw Error('Please sign in.');

    const data = await res.json();
    const user = data.user;

    // ---------- 2. Fill user info ----------
    $('#userName').textContent = user.name;
    $('#userEmail').textContent = user.email;
    $('#userRole').textContent = user.role;

    // ---------- 3. Referral link ----------
    const referralLink =
      location.origin + '/login.html?ref=' + encodeURIComponent(user.referral_code);

    $('#referralLink').textContent = referralLink;
    $('#referralStats').textContent = 'Successful referrals: ' + data.referralCount;

    $('#copyReferral').onclick = async () => {
      await navigator.clipboard.writeText(referralLink);
      message.textContent = 'Referral link copied.';
    };

    // ---------- 4. Order history ----------
    const esc = (s) => String(s).replace(/[&<>]/g, '');

    $('#orderHistory').innerHTML = data.orders.length
      ? data.orders
          .map(
            (order) => `
              <p>
                <b>${esc(order.order_number)}</b> · ${esc(order.status)}
              </p>
            `
          )
          .join('')
      : '<p class="muted">Your orders will appear here.</p>';

    // ---------- 5. Show dashboard ----------
    loading.hidden = true;
    content.hidden = false;

    // ---------- 6. Logout ----------
    $('#logoutButton').onclick = async () => {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
      location.href = '/login.html';
    };

    // ---------- 7. All small forms ----------
    // passwordForm, messageForm, sellerApplyForm
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
  } catch (err) {
    // ---------- Not logged in ----------
    loading.textContent = err.message + ' Redirecting…';
    location.replace(
      '/login.html?redirect=' + encodeURIComponent('/dashboard.html')
    );
  }
});