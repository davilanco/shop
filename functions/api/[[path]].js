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
 const response=await fetch('https://api-sg.aliexpress.com/rest'+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams(all)});
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


async function aeDecrypt(value,env){
 const [ivPart,dataPart]=String(value||'').split('.');
 if(!ivPart||!dataPart)throw Error('Stored AliExpress token cannot be decrypted.');
 const key=await aeEncryptionKey(env);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:aeB64ToBytes(ivPart)},key,aeB64ToBytes(dataPart));
 return new TextDecoder().decode(plain);
}
async function aeRefreshIfNeeded(env){
 const current=await env.DB.prepare("SELECT access_token_encrypted,refresh_token_encrypted,access_expires_at,refresh_expires_at FROM aliexpress_credentials WHERE id='primary'").first();
 if(!current)return null;
 const accessExpiry=Date.parse(current.access_expires_at||'');
 if(Number.isFinite(accessExpiry)&&accessExpiry>Date.now()+30*60*1000)return current;
 const refreshExpiry=Date.parse(current.refresh_expires_at||'');
 if(!Number.isFinite(refreshExpiry)||refreshExpiry<=Date.now())throw Object.assign(Error('AliExpress refresh authorization has expired. Reconnect the account.'),{status:409});
 const refreshToken=await aeDecrypt(current.refresh_token_encrypted,env);
 const rotated=await aeTokenRequest('/auth/token/refresh',{refresh_token:refreshToken},env);
 const access=await aeEncrypt(rotated.access_token,env),refresh=await aeEncrypt(rotated.refresh_token,env);
 const result=await env.DB.prepare("UPDATE aliexpress_credentials SET access_token_encrypted=?,refresh_token_encrypted=?,access_expires_at=?,refresh_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE id='primary' AND refresh_token_encrypted=?").bind(access,refresh,aeExpiry(rotated,'expire_time','expires_in'),aeExpiry(rotated,'refresh_token_valid_time','refresh_expires_in'),current.refresh_token_encrypted).run();
 if(!result.meta?.changes){
  const latest=await env.DB.prepare("SELECT access_expires_at FROM aliexpress_credentials WHERE id='primary'").first();
  if(!latest||Date.parse(latest.access_expires_at||'')<=Date.now())throw Object.assign(Error('AliExpress token refresh collided with another request. Please retry.'),{status:409});
 }
 return await env.DB.prepare("SELECT access_token_encrypted,refresh_token_encrypted,access_expires_at,refresh_expires_at FROM aliexpress_credentials WHERE id='primary'").first();
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
 let c=await env.DB.prepare("SELECT access_expires_at,refresh_expires_at,updated_at FROM aliexpress_credentials WHERE id='primary'").first();if(c){await aeRefreshIfNeeded(env);c=await env.DB.prepare("SELECT access_expires_at,refresh_expires_at,updated_at FROM aliexpress_credentials WHERE id='primary'").first();}
 return json({connected:!!c,access_expires_at:c?.access_expires_at||null,refresh_expires_at:c?.refresh_expires_at||null,updated_at:c?.updated_at||null});
}


async function aeSyncCall(method,business,env){
 const current=await aeRefreshIfNeeded(env);
 if(!current)throw Object.assign(Error('Connect AliExpress before using supplier tools.'),{status:409});
 const token=await aeDecrypt(current.access_token_encrypted,env);
 const params={...business,app_key:env.ALIEXPRESS_APP_KEY,method,session:token,timestamp:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),sign_method:'sha256',format:'json',v:'2.0'};
 const text=Object.keys(params).filter(k=>params[k]!==undefined&&params[k]!==null).sort().map(k=>k+String(typeof params[k]==='object'?JSON.stringify(params[k]):params[k])).join('');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.ALIEXPRESS_APP_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text));
 params.sign=[...new Uint8Array(sig)].map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
 const response=await fetch('https://api-sg.aliexpress.com/sync',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams(Object.entries(params).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):String(v)]))});
 const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{throw Object.assign(Error('AliExpress returned an unreadable API response.'),{status:502})}
 if(!response.ok)throw Object.assign(Error('AliExpress API request failed ('+response.status+').'),{status:502});
 const root=data?.[method.replace(/\./g,'_')+'_response']||data?.[method+'_response']||data;
 if(root?.code&&String(root.code)!=='0'||root?.error_response)throw Object.assign(Error(String(root.msg||root.message||root.sub_msg||'AliExpress rejected the request.')), {status:502});
 return root;
}
const aeData=x=>x?.data||x?.result||x;
const aeProducts=x=>{let d=aeData(x);let a=d?.products||d?.product_list||d?.selection_search_product||d?.product||[];if(!Array.isArray(a)&&a&&typeof a==='object')a=Object.values(a);return Array.isArray(a)?a:[]};
const aeProductId=x=>String(x?.itemId??x?.productId??x?.product_id??x?.item_id??'');
const aeProductTitle=x=>String(x?.title??x?.product_title??x?.subject??'AliExpress product').slice(0,160);
const aeProductImage=x=>String(x?.itemMainPic??x?.imageUrl??x?.image_url??x?.product_main_image_url??x?.image??'').slice(0,1000);
if(p==='aliexpress/search'&&m==='POST'){
 await requireUser(request,env,['admin']);let b=await body(request),keyword=String(b.keyWord||'').trim().slice(0,120),pageSize=Math.max(1,Math.min(50,Number(b.pageSize)||20)),pageIndex=Math.max(1,Number(b.pageIndex)||1);
 const result=await aeSyncCall('aliexpress.ds.text.search',{local:String(b.local||'en').slice(0,10),countryCode:String(b.countryCode||'NG').slice(0,2).toUpperCase(),currency:String(b.currency||'USD').slice(0,3).toUpperCase(),...(keyword?{keyWord:keyword}:{}),...(b.categoryId?{categoryId:String(b.categoryId)}:{}),...(b.sortBy?{sortBy:String(b.sortBy)}:{}),pageSize,pageIndex,...(b.selectionName?{selectionName:String(b.selectionName)}:{})},env);
 const d=aeData(result),items=aeProducts(result);return json({products:items.map(x=>({product_id:aeProductId(x),title:aeProductTitle(x),image:aeProductImage(x),product_url:String(x.itemUrl||x.productDetailUrl||x.product_url||''),price:x.targetSalePrice||x.salePrice||x.price||x.minPrice||'',orders:x.orders||x.lastest_volume||0,raw:x})).filter(x=>x.product_id),pageIndex:d?.pageIndex||pageIndex,pageSize:d?.pageSize||pageSize,totalCount:d?.totalCount||items.length});
}
if(p==='aliexpress/details'&&m==='POST'){
 await requireUser(request,env,['admin']);let b=await body(request),productId=String(b.product_id||'').trim();if(!/^\d{5,30}$/.test(productId))return json({error:'Enter a valid AliExpress product ID.'},400);
 const result=await aeSyncCall('aliexpress.ds.product.get',{ship_to_country:String(b.ship_to_country||'NG').toUpperCase(),product_id:productId,...(b.target_currency?{target_currency:String(b.target_currency)}:{}),target_language:String(b.target_language||'en'),...(b.province_code?{province_code:String(b.province_code)}:{}),...(b.city_code?{city_code:String(b.city_code)}:{})},env);
 return json({product:aeData(result)});
}
if(p==='aliexpress/freight'&&m==='POST'){
 await requireUser(request,env,['admin']);let b=await body(request),req=b.queryDeliveryReq||{};if(!req.productId||!req.selectedSkuId)return json({error:'Product and SKU are required for a freight quote.'},400);
 const result=await aeSyncCall('aliexpress.ds.freight.query',{queryDeliveryReq:{quantity:Math.max(1,Math.min(99,Number(req.quantity)||1)),shipToCountry:String(req.shipToCountry||'NG').toUpperCase(),productId:String(req.productId),...(req.provinceCode?{province:String(req.province||''),provinceCode:String(req.provinceCode)}:{}),...(req.cityCode?{cityCode:String(req.cityCode)}:{}),selectedSkuId:String(req.selectedSkuId),language:String(req.language||'en'),currency:String(req.currency||'USD')}},env);
 return json({quote:aeData(result)});
}
if(p==='aliexpress/import'&&m==='POST'){
 const actor=await requireUser(request,env,['admin']);let b=await body(request),productId=String(b.product_id||''),sellingPrice=amount(b.selling_price);if(!/^\d{5,30}$/.test(productId)||!sellingPrice)return json({error:'Valid AliExpress product ID and selling price in NGN are required.'},400);
 const result=await aeSyncCall('aliexpress.ds.product.get',{ship_to_country:'NG',product_id:productId,target_currency:'USD',target_language:'en'},env),d=aeData(result),base=d?.ae商品基础信息||d?.aeProductBaseInfo||d?.product||d?.base_info||d;
 const title=aeProductTitle({title:base?.subject||base?.title||base?.product_title||d?.title}),image=String(d?.ae_multimedia_info_dto?.image_urls||'').split(';')[0]||aeProductImage({imageUrl:base?.imageUrl||base?.product_main_image_url||d?.imageUrl}),description=String(base?.detail||base?.mobile_detail||base?.description||'Imported from AliExpress.').slice(0,3000);
 const id=uid(),skuList=d?.ae商品SKU信息||d?.aeSkuInfo||d?.sku_info||d?.skus||[];
 const skuRows=Array.isArray(skuList)?skuList:[];
 await env.DB.prepare("INSERT INTO products(id,seller_id,name,description,price,image,category,stock,status) VALUES(?,?,?,?,?,'','imported',0,'pending')").bind(id,actor.id,title,description,sellingPrice).run();
 await env.DB.prepare("UPDATE products SET image=? WHERE id=?").bind(image,id).run();
 await env.DB.prepare("INSERT INTO aliexpress_products(product_id,ae_product_id,product_url,supplier_name,supplier_status,source_currency,source_price,source_payload,last_synced_at) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(id,productId,String(b.product_url||''),'AliExpress','active','USD',Number(base?.min_price||base?.price||0)||null,JSON.stringify(d).slice(0,50000)).run();
 for(const s of skuRows){const skuId=String(s.sku_id??s.skuId??s.id??'');if(!skuId)continue;await env.DB.prepare("INSERT OR IGNORE INTO aliexpress_product_skus(id,product_id,ae_sku_id,sku_attributes,supplier_price,supplier_currency,available_stock,is_available,raw_payload) VALUES(?,?,?,?,?,?,?,?,?)").bind(uid(),id,skuId,JSON.stringify(s.ae_sku_property_dtos||s.sku_attr||[]),Number(s.offer_sale_price||s.sku_price||s.price||0)||null,String(s.currency||'USD'),Math.max(0,Number(s.sku_available_stock||s.stock||s.inventory||0)),Number(s.sku_available_stock||s.stock||s.inventory||0)>0?1:0,JSON.stringify(s).slice(0,10000)).run();}
 return json({ok:true,product_id:id,status:'pending',sku_count:skuRows.length,message:'Imported product submitted for admin approval.'},201);
}
if(p==='aliexpress/supplier-orders'&&m==='GET'){
 await requireUser(request,env,['admin']);const rows=await env.DB.prepare("SELECT so.*,o.order_number,o.total AS local_total,o.payment_status AS local_payment_status FROM aliexpress_supplier_orders so JOIN orders o ON o.id=so.local_order_id ORDER BY so.created_at DESC LIMIT 100").all();return json({orders:rows.results});
}
if(p==='aliexpress/supplier-orders/prepare'&&m==='POST'){
 const actor=await requireUser(request,env,['admin']);let b=await body(request),local=await env.DB.prepare("SELECT * FROM orders WHERE id=? AND payment_status='paid'").bind(String(b.order_id||'')).first();if(!local)return json({error:'Only a successfully paid local order can enter supplier review.'},409);
 const exists=await env.DB.prepare('SELECT id FROM aliexpress_supplier_orders WHERE local_order_id=?').bind(local.id).first();if(exists)return json({error:'This local order already has a supplier-order review record.'},409);
 const items=await env.DB.prepare('SELECT oi.*,ap.ae_product_id,sku.ae_sku_id FROM order_items oi JOIN aliexpress_products ap ON ap.product_id=oi.product_id LEFT JOIN aliexpress_product_skus sku ON sku.product_id=oi.product_id WHERE oi.order_id=?').bind(local.id).all();
 if(!items.results.length||items.results.some(x=>!x.ae_product_id||!x.ae_sku_id))return json({error:'Every item must be linked to an AliExpress product and SKU before supplier review.'},409);
 const id=uid(),out='DVL-'+crypto.randomUUID();await env.DB.prepare("INSERT INTO aliexpress_supplier_orders(id,local_order_id,out_order_id,status,payment_status,order_request_json) VALUES(?,?,?,'awaiting_admin_approval','not_requested',?)").bind(id,local.id,out,JSON.stringify({items:items.results.map(x=>({ae_product_id:x.ae_product_id,ae_sku_id:x.ae_sku_id,quantity:x.quantity}))})).run();
 for(const x of items.results)await env.DB.prepare("INSERT INTO aliexpress_supplier_order_items(id,supplier_order_id,local_order_item_id,ae_product_id,ae_sku_id,quantity,supplier_unit_price,supplier_currency) VALUES(?,?,?,?,?,?,?,?)").bind(uid(),id,x.id,x.ae_product_id,x.ae_sku_id,x.quantity,x.unit_price,'NGN').run();
 await env.DB.prepare("INSERT INTO aliexpress_approval_events(id,supplier_order_id,actor_user_id,event_type,note) VALUES(?,?,?,'prepared','Queued for admin review; no supplier order or payment was submitted.')").bind(uid(),id,actor.id).run();return json({ok:true,id,status:'awaiting_admin_approval',payment_status:'not_requested'},201);
}
if(p==='aliexpress/supplier-orders/decision'&&m==='POST'){
 const actor=await requireUser(request,env,['admin']);let b=await body(request),id=String(b.supplier_order_id||''),decision=String(b.decision||''),note=String(b.note||'').slice(0,500);
 const row=await env.DB.prepare('SELECT * FROM aliexpress_supplier_orders WHERE id=?').bind(id).first();if(!row)return json({error:'Supplier order review record not found.'},404);
 if(decision==='approve'&&row.status==='awaiting_admin_approval'){await env.DB.prepare("UPDATE aliexpress_supplier_orders SET status='approved_for_submission',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='awaiting_admin_approval'").bind(id).run();}
 else if(decision==='reject'&&row.status==='awaiting_admin_approval'){await env.DB.prepare("UPDATE aliexpress_supplier_orders SET status='rejected',error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='awaiting_admin_approval'").bind(note||'Rejected by admin.',id).run();}
 else if(decision==='approve_payment'&&row.status==='approved_for_submission'&&row.payment_status==='not_requested'){await env.DB.prepare("UPDATE aliexpress_supplier_orders SET payment_status='approved_for_payment',payment_approved_by=?,payment_approved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='approved_for_submission' AND payment_status='not_requested'").bind(actor.id,id).run();}
 else return json({error:'This decision is not valid for the supplier order current state.'},409);
 await env.DB.prepare("INSERT INTO aliexpress_approval_events(id,supplier_order_id,actor_user_id,event_type,note) VALUES(?,?,?,?,?)").bind(uid(),id,actor.id,decision==='approve'?'order_approved':decision==='reject'?'order_rejected':'payment_approved',note).run();
 return json({ok:true,decision,warning:'No supplier order was placed and no supplier payment was made.'});
}

if(p==='ae-place-order'&&m==='POST'){await requireUser(request,env,['admin']);return json({error:'AliExpress ordering is disabled until a verified partner API and approval workflow are configured.'},503)}
if(p==='ae-tracking'&&m==='GET'){await requireUser(request,env,['admin','seller']);return json({tracking:[],message:'Tracking provider not configured.'})}
if(p==='ae-webhook'&&m==='POST'){if(!env.AE_WEBHOOK_SECRET)return json({error:'Webhook not configured.'},503);if(request.headers.get('x-davilanco-webhook-secret')!==env.AE_WEBHOOK_SECRET)return json({error:'Unauthorized webhook.'},401);return json({received:true})}
return json({error:'API endpoint not found.'},404)}catch(e){return fail(e)}}
export const onRequest=handler;