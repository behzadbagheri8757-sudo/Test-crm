/* db.js — IndexedDB, normalizeData, loadData, saveData
   Phase 0 extract: no logic changes. DB_NAME/store/keys unchanged.
*/
// ---------- IndexedDB layer ----------
// Chosen over localStorage because: async (never blocks the UI thread on an
// iPhone), much higher storage quota, and it survives Safari's storage
// eviction rules better for a long-lived, years-of-invoices dataset.
function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains(STORE)){
        db.createObjectStore(STORE, {keyPath:'key'});
      }
    };
    req.onsuccess = (e)=> resolve(e.target.result);
    req.onerror = (e)=> reject(e.target.error);
  });
}
async function getDB(){
  if(!dbInstance) dbInstance = await openDB();
  return dbInstance;
}
async function dbGet(key){
  const db = await getDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = (e)=>reject(e.target.error);
  });
}
async function dbPut(key, value){
  const db = await getDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put({key, value});
    tx.oncomplete = ()=>resolve();
    tx.onerror = (e)=>reject(e.target.error);
  });
}
async function dbDelete(key){
  const db = await getDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = ()=>resolve();
    tx.onerror = (e)=>reject(e.target.error);
  });
}

// normalize / migrate any older data shape into the current schema so old
// backups (or the previous version of this app) keep working
function normalizeData(parsed){
  const d = emptyData();
  if(!parsed || typeof parsed !== 'object') return d;
  // نسخه‌ی ورودی را فقط برای لاگ/عیب‌یابی نگه می‌داریم؛ نبودش یعنی بکاپ قدیمی (نسخه ۱)
  const inputSchemaVersion = parsed.schemaVersion || 1;
  d.invoiceSeq = parsed.invoiceSeq || 1000;
  d.products = (parsed.products||[]).map(p=>({
    id: p.id||uid(),
    name: p.name||'',
    category: p.category||'',
    packageWeight: p.packageWeight||0,
    buy: p.buy||0,
    wholesale: (p.wholesale!==undefined? p.wholesale : p.sell) || 0,
    retail: (p.retail!==undefined? p.retail : p.sell) || 0,
    sell: p.sell || p.retail || 0,
    stockQty: p.stockQty!==undefined ? p.stockQty : 0,
    minStock: p.minStock||0,
    priceHistory: p.priceHistory||[],
    stockLog: p.stockLog||[],
    active: p.active!==false,
  }));
  d.customers = (parsed.customers||[]).map(c=>({
    id: c.id||uid(),
    name: c.name||'',
    ownerName: c.ownerName||'',
    phone: c.phone||'',
    address: c.address||'',
    region: c.region||'',
    route: c.route||'',
    note: c.note||'',
    openingBalance: c.openingBalance||0,
    visits: c.visits||[],
    active: c.active!==false,
  }));
  d.invoices = (parsed.invoices||[]).map(i=>({
    id:i.id||uid(), number:i.number, customerId:i.customerId, date:i.date,
    items:(i.items||[]).map(it=>({
      productId:it.productId, name:it.name, qty:it.qty, price:it.price,
      buyPrice:it.buyPrice||0, discount:it.discount||0, weight:it.weight||0,
    })),
    total:i.total||0, discount:i.discount||0, discountType:i.discountType,
    prevBalance:i.prevBalance, cashPaid:i.cashPaid||0, checkPaid:i.checkPaid||0,
    cardPaid:i.cardPaid||0, transferPaid:i.transferPaid||0,
    newBalance:i.newBalance,
    editHistory:i.editHistory||[],
  }));
  d.payments = (parsed.payments||[]).map(p=>({
    id:p.id||uid(), customerId:p.customerId, date:p.date, amount:p.amount,
    method:p.method||'cash', invoiceId:p.invoiceId, note:p.note||'',
    // برگشت‌های قدیمی این فیلد را ندارند => آرایه خالی => رفتار قبلی (فقط اصلاح حساب) دقیقاً حفظ می‌شود
    returnItems: Array.isArray(p.returnItems) ? p.returnItems.map(ri=>({
      productId: ri.productId, name: ri.name||'', qty: ri.qty||0, price: ri.price||0,
    })) : [],
  }));
  d.checks = (parsed.checks||[]).map(c=>({
    id:c.id||uid(), customerId:c.customerId, amount:c.amount, dueDate:c.dueDate,
    checkNumber:c.checkNumber||'', status:c.status||'pending', invoiceId:c.invoiceId,
  }));
  d.suppliers = (parsed.suppliers||[]).map(s=>({
    id:s.id||uid(), name:s.name||'', phone:s.phone||'',
    openingBalance: s.openingBalance||0,
    purchases:(s.purchases||[]).map(p=>({
      id:p.id||uid(), date:p.date, amount:p.amount, desc:p.desc||'', productId:p.productId||'', qty:p.qty||0,
      items: Array.isArray(p.items) ? p.items.map(it=>({id:it.id||uid(), productId:it.productId||'', name:it.name||'', qty:it.qty||0, unitCost:it.unitCost||0, lineAmount:it.lineAmount||0})) : undefined,
      returns:(p.returns||[]).map(r=>({
        id:r.id||uid(), date:r.date||p.date, qty:r.qty||0, amount:r.amount||0,
        items: Array.isArray(r.items) ? r.items.map(x=>({itemId:x.itemId, productId:x.productId||'', qty:x.qty||0, amount:x.amount||0})) : undefined,
      })),
    })),
    payments:s.payments||[],
  }));
  // بعد از migration و آماده‌سازی کامل داده، همیشه نسخه‌ی فعلی schema خروجی گرفته می‌شود
  d.schemaVersion = CURRENT_SCHEMA_VERSION;
  if(inputSchemaVersion !== CURRENT_SCHEMA_VERSION){
    console.log('normalizeData: migrated data from schemaVersion', inputSchemaVersion, 'to', CURRENT_SCHEMA_VERSION);
  }
  return d;
}

async function loadData(){
  try{
    const record = await dbGet(RECORD_KEY);
    if(record && record.value){
      data = normalizeData(JSON.parse(record.value));
    } else if(window.storage){
      // fallback: recover from an older window.storage-based save, if this
      // file was ever previously run inside a Claude artifact sandbox
      try{
        const legacy = await window.storage.get('baqeri-erp-data', false);
        if(legacy && legacy.value){
          data = normalizeData(JSON.parse(legacy.value));
          await saveData();
        }
      }catch(e){ /* no legacy data — fine */ }
    }
  }catch(e){
    console.error('loadData failed', e);
    showToast('خطا در بارگذاری اطلاعات');
  }
}

async function saveData(){
  try{
    data.schemaVersion = CURRENT_SCHEMA_VERSION;
    await dbPut(RECORD_KEY, JSON.stringify(data));
  }catch(e){
    console.error('save failed', e);
    showToast('⚠️ ذخیره نشد، دوباره تلاش کن');
    return;
  }
  // fire-and-forget: بکاپ خودکار کاملاً جدا از ذخیره‌ی اصلی اجرا می‌شود؛
  // ذخیره‌ی اصلی چند خط بالاتر با موفقیت کامل شده، پس هر خطایی اینجا فقط لاگ می‌شود
  autoBackupTick().catch(e=>console.error('auto backup failed', e));
}

function nextInvoiceNumber(){
  data.invoiceSeq = (data.invoiceSeq||1000) + 1;
  return data.invoiceSeq;
}

