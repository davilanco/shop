import{json,sha256,hashPassword,verifyPassword,randomToken,cookieHeader,clearCookie,requireUser,body}from'../lib/auth.js';
const fail=e=>json({error:e.message||'Request failed'},e.status||500),uid=()=>crypto.randomUUID(),amount=n=>Number.isFinite(Number(n))&&Number(n)>0?Math.round(Number(n)):0;
async function session(userId,env){let t=randomToken(),expires=new Date(Date.now()+7*864e5).toISOString().replace('T',' ').slice(0,19);await env.DB.prepare('INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)').bind(uid(),userId,await sha256(t),expires).run();return json({ok:true},200,{'Set-Cookie':cookieHeader(t)})}

const AE_CALLBACK='https://shop.davilanco.com/api/aliexpress/callback';
const aeBytesToB64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
const aeB64ToBytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function aeSignature(path,params,secret){
 const text=path+Object.keys(params).filter(k=>k!=='sign'&&params[k]!==undefined&&params[k]!==null).sort().map(k=>k+String(params[k])).join('');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text));
 return [...new Uint8Array(sig)].map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
}
async function aeTokenRequest(path,params,env){
 if(!env.ALIEXPRESS_APP_KEY||!env.ALIEXPRESS_APP_SECRET)throw Object.assign(Error('AliExpress app credentials are not configured.'),{status:503});
 const all={...params,app_key:env.ALIEXPRESS_APP_KEY,timestamp:String(Date.now()),sign_method:'sha256'};
 all.sign=await aeSignature(path,all,env.ALIEXPRESS_APP_SECRET);
 const response=await fetch('https://api-sg.aliexpress.com'+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams(all)});
 const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{throw Object.assign(Error('AliExpress returned an unreadable token response.'),{status:502})}
 if(!response.ok)throw Object.assign(Error('AliExpress token request failed ('+response.status+').'),{status:502});
 for(let i=0;i<3&&typeof data==='string';i++){try{data=JSON.parse(data)}catch{break}}
 const unwrap=x=>{for(let i=0;i<4&&x&&typeof x==='object';i++){if(x.access_token||x.refresh_token)return x;const k=Object.keys(x).find(k=>/response|result|body|data/i.test(k));if(!k)break;let v=x[k];if(typeof v==='string'){try{v=JSON.parse(v)}catch{break}}x=v}return x};
 data=unwrap(data);
 if(!data||typeof data!=='object'||data.error||data.error_description||data.code&&String(data.code)!=='0'&&!data.access_token)throw Object.assign(Error('AliExpress authorization failed. Check app status and API permissions.'),{status:502});
 if(!data.access_token||!data.refresh_token)throw Object.assign(Error('AliExpress did not return both authorization tokens.'),{status:502});
 return data;
}
async function aeEncryptionKey(env){
 if(!env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY)throw Object.assign(Error('Token encryption key is not configured.'),{status:503});
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY));
 return crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function aeEncrypt(value,env){
 const iv=crypto.getRandomValues(new Uint8Array(12)),key=await aeEncryptionKey(env);
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value));
 return aeBytesToB64(iv)+'.'+aeBytesToB64(encrypted);
}
function aeExpiry(data,absoluteKey,secondsKey){
 const absolute=Number(data[absoluteKey]);
 if(Number.isFinite(absolute)&&absolute>0)return new Date(absolute<1e12?absolute*1000:absolute).toISOString();
 const seconds=Number(data[secondsKey]);
 if(Number.isFinite(seconds)&&seconds>0)return new Date(Date.now()+seconds*1000).toISOString();
 return null;
}
async function aeSaveTokens(data,env){
 const access=await aeEncrypt(data.access_token,env),refresh=await aeEncrypt(data.refresh_token,env);
 const accessExpiry=aeExpiry(data,'expire_time','expires_in'),refreshExpiry=aeExpiry(data,'refresh_token_valid_time','refresh_expires_in');
 await env.DB.prepare("INSERT INTO aliexpress_credentials(id,access_token_encrypted,refresh_token_encrypted,access_expires_at,refresh_expires_at,updated_at) VALUES('primary',?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET access_token_encrypted=excluded.access_token_encrypted,refresh_token_encrypted=excluded.refresh_token_encrypted,access_expires_at=excluded.access_expires_at,refresh_expires_at=excluded.refresh_expires_at,updated_at=CURRENT_TIMESTAMP").bind(access,refresh,accessExpiry,refreshExpiry).run();
}

async function handler({request,env}){try{let u=new URL(request.url),p=u.pathname.replace(/^\/api\/?/,''),m=request.method;
if(p==='session'&&m==='GET'){let user=await requireUser(request,env),[orders,refs]=await Promise.all([env.DB.prepare('SELECT order_number,status,total,created_at FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 30').bind(user.id).all(),env.DB.prepare('SELECT COUNT(*) n FROM users WHERE referred_by=?').bind(user.id).first()]);return json({user,orders:orders.results,referralCount:refs.n})}
if(p==='auth/register'&&m==='POST'){let b=await body(request),name=String(b.name||'').trim(),email=String(b.email||'').trim().toLowerCase(),pw=String(b.password||'');if(name.length<2||name.length>100||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||pw.length<10||!/[0-9]/.test(pw)||!/[\W_]/.test(pw))return json({error:'Use a valid name/email and a password of 10+ characters with a number and symbol.'},400);if(await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first())return json({error:'An account with this email already exists.'},409);let h=await hashPassword(pw),ref=b.referralCode?await env.DB.prepare('SELECT id FROM users WHERE referral_code=?').bind(String(b.referralCode).slice(0,32)).first():null,id=uid(),code=randomToken(7).toUpperCase();await env.DB.prepare('INSERT INTO users(id,name,email,password_salt,password_hash,role,referral_code,referred_by) VALUES(?,?,?,?,?,?,?,?)').bind(id,name,email,h.salt,h.hash,'customer',code,ref?.id||null).run();return session(id,env)}
if(p==='auth/login'&&m==='POST'){let b=await body(request),u=await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(String(b.email||'').trim().toLowerCase()).first();if(!u||!await verifyPassword(String(b.password||''),u.password_salt,u.password_hash))return json({error:'Email or password is incorrect.'},401);return session(u.id,env)}
if(p==='auth/logout'&&m==='POST'){let t=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('davilanco_session='))?.split('=').slice(1).join('=');if(t)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(t)).run();return json({ok:true},200,{'Set-Cookie':clearCookie()})}
if(p==='auth/password'&&m==='POST'){let user=await requireUser(request,env),b=await body(request),old=await env.DB.prepare('SELECT password_salt,password_hash FROM users WHERE id=?').bind(user.id).first();if(!await verifyPassword(String(b.currentPassword||''),old.password_salt,old.password_hash))return json({error:'Current password is incorrect.'},400);if(String(b.newPassword||'').length<10)return json({error:'New password must contain at least 10 characters.'},400);let h=await hashPassword(b.newPassword);await env.DB.batch([env.DB.prepare('UPDATE users SET password_salt=?,password_hash=? WHERE id=?').bind(h.salt,h.hash,user.id),env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id)]);return json({ok:true})}
if(p==='products'&&m==='GET'){let user=null;try{user=await requireUser(request,env)}catch{}let mine=u.searchParams.get('mine')==='1'&&user&&['seller','admin'].includes(user.role),q=mine?env.DB.prepare('SELECT * FROM products WHERE seller_id=? ORDER BY created_at DESC').bind(user.id):env.DB.prepare("SELECT id,name,description,price,image,category,stock,status FROM products WHERE status='active' AND stock>0 ORDER BY created_at DESC");return json({products:(await q.all()).results})}
if(p==='products'&&m==='POST'){let user=await requireUser(request,env,['seller','admin']),b=await body(request),name=String(b.name||'').trim(),price=amount(b.price);if(!name||name.length>160||!price)return json({error:'Product name and valid price required.'},400);let id=uid(),status=user.role==='admin'?'active':'pending';await env.DB.prepare('INSERT INTO products(id,seller_id,name,description,price,image,category,stock,status) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,user.id,name,String(b.description||'').slice(0,3000),price,String(b.image||'').slice(0,1000),['locally-made','imported','others'].includes(b.category)?b.category:'others',Math.max(0,Number(b.stock)||0),status).run();return json({ok:true,id,status},201)}
if(p.startsWith('products/')&&m==='DELETE'){await requireUser(request,env,['admin']);await env.DB.prepare('DELETE FROM products WHERE id=?').bind(p.split('/')[1]).run();return json({ok:true})}
if(p==='orders'&&m==='GET'){let user=await requireUser(request,env,['seller','admin']),r=user.role==='admin'?await env.DB.prepare('SELECT o.*,u.email customer_email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 100').all():await env.DB.prepare('SELECT DISTINCT o.* FROM orders o JOIN order_items i ON i.order_id=o.id JOIN products p ON p.id=i.product_id WHERE p.seller_id=? ORDER BY o.created_at DESC').bind(user.id).all();return json({orders:r.results})}
if(p==='orders/status'&&m==='PATCH'){let actor=await requireUser(request,env,['admin','seller']),b=await body(request);if(!['approved','shipping','delivered','cancelled'].includes(b.status))return json({error:'Invalid status.'},400);if(actor.role==='seller'){let owns=await env.DB.prepare('SELECT 1 FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=? AND p.seller_id=? LIMIT 1').bind(b.orderId,actor.id).first();if(!owns)return json({error:'You cannot update this order.'},403)}await env.DB.prepare('UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(b.status,b.orderId).run();return json({ok:true})}
if(p==='users'&&m==='GET'){await requireUser(request,env,['admin']);let r=await env.DB.prepare('SELECT id,name,email,role,created_at FROM users ORDER BY created_at DESC LIMIT 200').all();return json({users:r.results})}
if(p==='users/role'&&m==='PATCH'){await requireUser(request,env,['admin']);let b=await body(request);if(!['customer','seller','admin'].includes(b.role)||!b.userId)return json({error:'Valid user and role required.'},400);await env.DB.prepare('UPDATE users SET role=? WHERE id=?').bind(b.role,b.userId).run();return json({ok:true})}
if(p==='messages'&&m==='GET'){await requireUser(request,env,['admin']);let r=await env.DB.prepare('SELECT m.id,m.body,m.created_at,u.name,u.email FROM messages m JOIN users u ON u.id=m.sender_id ORDER BY m.created_at DESC LIMIT 100').all();return json({messages:r.results})}
if(p==='analytics'&&m==='GET'){await requireUser(request,env,['admin']);let names=['users','products','orders'];let stats={};for(let n of names)stats[n]=(await env.DB.prepare('SELECT COUNT(*) n FROM '+n).first()).n;stats.revenue_ngn=(await env.DB.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE payment_status='paid'").first()).n;return json({stats})}
if(p==='seller/apply'&&m==='POST'){let user=await requireUser(request,env),b=await body(request);if(user.role!=='customer')return json({error:'This account cannot apply.'},400);await env.DB.prepare('INSERT INTO seller_applications(id,user_id,business_name,details,document_url,status) VALUES(?,?,?,?,?,?)').bind(uid(),user.id,String(b.businessName||'').slice(0,120),String(b.details||'').slice(0,2000),String(b.documentUrl||'').slice(0,1000),'pending').run();return json({ok:true},201)}
if(p==='seller/applications'&&m==='GET'){await requireUser(request,env,['admin']);return json({applications:(await env.DB.prepare("SELECT a.*,u.email user_email FROM seller_applications a JOIN users u ON u.id=a.user_id WHERE a.status='pending'").all()).results})}
if(p==='seller/applications'&&m==='PATCH'){await requireUser(request,env,['admin']);let b=await body(request),a=await env.DB.prepare('SELECT user_id FROM seller_applications WHERE id=?').bind(b.applicationId).first();if(!a||!['approved','rejected'].includes(b.status))return json({error:'Invalid application decision.'},400);await env.DB.prepare('UPDATE seller_applications SET status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?').bind(b.status,b.applicationId).run();if(b.status==='approved')await env.DB.prepare("UPDATE users SET role='seller' WHERE id=?").bind(a.user_id).run();return json({ok:true})}
if(p==='messages'&&m==='POST'){let user=await requireUser(request,env),b=await body(request),msg=String(b.body||'').trim();if(!msg||msg.length>2000)return json({error:'Message must be 1–2000 characters.'},400);await env.DB.prepare('INSERT INTO messages(id,sender_id,body) VALUES(?,?,?)').bind(uid(),user.id,msg).run();return json({ok:true})}
if(p==='paystack/initialize'&&m==='POST'){let user=await requireUser(request,env);if(!env.PAYSTACK_SECRET_KEY)return json({error:'Payments are not configured.'},503);let b=await body(request),items=Array.isArray(b.items)?b.items:[],total=0,lines=[];if(!items.length||items.length>30)return json({error:'Your bag is empty or too large.'},400);for(let x of items){let p=await env.DB.prepare("SELECT id,name,price,stock FROM products WHERE id=? AND status='active'").bind(x.productId).first(),qty=Math.max(1,Math.min(20,Math.floor(Number(x.quantity)||1)));if(!p||p.stock<qty)return json({error:'Product unavailable or insufficient stock.'},409);total+=p.price*qty;lines.push({...p,qty})}let c=b.customer||{};if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c.email||''))||!c.name||!c.phone||!c.address)return json({error:'Complete delivery details.'},400);let ref='DVL-'+crypto.randomUUID(),oid=uid();await env.DB.prepare("INSERT INTO orders(id,user_id,order_number,total,status,payment_status,payment_reference,customer_name,customer_email,customer_phone,delivery_address,delivery_city,delivery_state,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(oid,user.id,ref,total,'pending','pending',ref,String(c.name).slice(0,100),String(c.email).slice(0,200),String(c.phone).slice(0,40),String(c.address).slice(0,500),String(c.city||'').slice(0,100),String(c.state||'').slice(0,100),String(c.note||'').slice(0,500)).run();for(let x of lines)await env.DB.prepare('INSERT INTO order_items(id,order_id,product_id,product_name,unit_price,quantity) VALUES(?,?,?,?,?,?)').bind(uid(),oid,x.id,x.name,x.price,x.qty).run();let r=await fetch('https://api.paystack.co/transaction/initialize',{method:'POST',headers:{Authorization:'Bearer '+env.PAYSTACK_SECRET_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:c.email,amount:total*100,reference:ref,callback_url:new URL('/payment-success.html',u.origin).href,metadata:{order_id:oid}})}),d=await r.json();if(!r.ok||!d.status){await env.DB.prepare("UPDATE orders SET payment_status='failed' WHERE id=?").bind(oid).run();return json({error:'Could not initialize payment.'},502)}return json({authorization_url:d.data.authorization_url,reference:ref})}
if(p==='paystack/verify'&&m==='POST'){let user=await requireUser(request,env);if(!env.PAYSTACK_SECRET_KEY)return json({error:'Payments are not configured.'},503);let b=await body(request),ref=String(b.reference||'');if(!/^DVL-[0-9a-f-]{36}$/i.test(ref))return json({error:'Invalid reference.'},400);let o=await env.DB.prepare('SELECT * FROM orders WHERE payment_reference=? AND user_id=?').bind(ref,user.id).first();if(!o)return json({error:'Order not found.'},404);let r=await fetch('https://api.paystack.co/transaction/verify/'+encodeURIComponent(ref),{headers:{Authorization:'Bearer '+env.PAYSTACK_SECRET_KEY}}),d=await r.json();if(!r.ok||!d.status||d.data.status!=='success'||d.data.amount!==o.total*100)return json({error:'Payment is not verified as successful.'},402);await env.DB.prepare("UPDATE orders SET payment_status='paid',status='approved',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(o.id).run();return json({ok:true,orderId:o.order_number})}

if(p==='aliexpress/connect'&&m==='GET'){
 const actor=await requireUser(request,env,['admin']);
 if(!env.ALIEXPRESS_APP_KEY||!env.ALIEXPRESS_APP_SECRET||!env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY)return json({error:'AliExpress app credentials or token encryption key are not configured.'},503);
 const state=randomToken(32),hash=await sha256(state),expires=new Date(Date.now()+10*60*1000).toISOString().replace('T',' ').slice(0,19);
 await env.DB.prepare('INSERT INTO aliexpress_oauth_states(state_hash,actor_user_id,expires_at) VALUES(?,?,?)').bind(hash,actor.id,expires).run();
 const auth=new URL('https://api-sg.aliexpress.com/oauth/authorize');auth.searchParams.set('response_type','code');auth.searchParams.set('force_auth','true');auth.searchParams.set('redirect_uri',AE_CALLBACK);auth.searchParams.set('client_id',env.ALIEXPRESS_APP_KEY);auth.searchParams.set('state',state);
 return Response.redirect(auth.toString(),302);
}
if(p==='aliexpress/callback'&&m==='GET'){
 const state=u.searchParams.get('state')||'',code=u.searchParams.get('code')||'';
 if(!/^[A-Za-z0-9_-]{32,}$/.test(state)||!code||code.length>2048)return json({error:'Invalid AliExpress authorization callback.'},400);
 const actor=await requireUser(request,env,['admin']),hash=await sha256(state);
 const saved=await env.DB.prepare("SELECT actor_user_id FROM aliexpress_oauth_states WHERE state_hash=? AND expires_at>datetime('now')").bind(hash).first();
 if(!saved||saved.actor_user_id!==actor.id)return json({error:'Authorization state expired or does not match this admin session. Please reconnect.'},400);
 const consumed=await env.DB.prepare("DELETE FROM aliexpress_oauth_states WHERE state_hash=? AND actor_user_id=? AND expires_at>datetime('now')").bind(hash,actor.id).run();
 if(!consumed.meta?.changes)return json({error:'Authorization state has already been used. Please reconnect.'},400);
 const tokens=await aeTokenRequest('/auth/token/create',{code},env);
 await aeSaveTokens(tokens,env);
 return Response.redirect(new URL('/admin/?aliexpress=connected',u.origin).toString(),303);
}
if(p==='aliexpress/status'&&m==='GET'){
 await requireUser(request,env,['admin']);
 const c=await env.DB.prepare("SELECT access_expires_at,refresh_expires_at,updated_at FROM aliexpress_credentials WHERE id='primary'").first();
 return json({connected:!!c,access_expires_at:c?.access_expires_at||null,refresh_expires_at:c?.refresh_expires_at||null,updated_at:c?.updated_at||null});
}

if(p==='ae-place-order'&&m==='POST'){await requireUser(request,env,['admin']);return json({error:'AliExpress ordering is disabled until a verified partner API and approval workflow are configured.'},503)}
if(p==='ae-tracking'&&m==='GET'){await requireUser(request,env,['admin','seller']);return json({tracking:[],message:'Tracking provider not configured.'})}
if(p==='ae-webhook'&&m==='POST'){if(!env.AE_WEBHOOK_SECRET)return json({error:'Webhook not configured.'},503);if(request.headers.get('x-davilanco-webhook-secret')!==env.AE_WEBHOOK_SECRET)return json({error:'Unauthorized webhook.'},401);return json({received:true})}
return json({error:'API endpoint not found.'},404)}catch(e){return fail(e)}}
export const onRequest=handler;