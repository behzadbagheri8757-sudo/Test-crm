/* backup.js — export/import JSON, auto-backup, undo restore, excel export
   Phase 0 extract: no logic changes.
*/
// ---------- backup / restore ----------
async function downloadFile(filename, blobParts, mime){
  const blob = (blobParts instanceof Blob) ? blobParts : new Blob([blobParts], {type:mime});
  // iOS Safari often just previews a blob link instead of saving it — the
  // share sheet's "Save to Files" is the reliable path on iPhone.
  try{
    if(navigator.canShare){
      const file = new File([blob], filename, {type:mime});
      if(navigator.canShare({files:[file]})){
        await navigator.share({files:[file], title:filename});
        return;
      }
    }
  }catch(e){
    // user cancelled the share sheet, or share isn't available — fall back below
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

async function exportBackupJSON(){
  const stamp = todayISO();
  await downloadFile(`baqeri-backup-${stamp}.json`, JSON.stringify(data, null, 2), 'application/json');
  showToast('فایل بکاپ آماده شد');
}

function validateBackupShape(parsed){
  if(!parsed || typeof parsed !== 'object') return false;
  const arrays = ['products','customers','invoices','payments','checks','suppliers'];
  return arrays.every(k => parsed[k]===undefined || Array.isArray(parsed[k]));
}

async function importBackupJSON(file){
  try{
    const text = await file.text();
    const parsed = JSON.parse(text);
    if(!validateBackupShape(parsed)){
      showToast('این فایل، فایل بکاپ معتبری نیست');
      return;
    }
    // safety net: keep a snapshot of what's about to be overwritten
    await dbPut(PRERESTORE_KEY, JSON.stringify(data));
    data = normalizeData(parsed);
    await saveData();
    render();
    showToast('اطلاعات با موفقیت بازیابی شد');
  }catch(e){
    console.error(e);
    showToast('فایل بکاپ معتبر نیست یا خراب است');
  }
}

async function undoLastRestore(){
  try{
    const snap = await dbGet(PRERESTORE_KEY);
    if(!snap || !snap.value){ showToast('نسخه‌ی قبل از بازیابی موجود نیست'); return; }
    data = normalizeData(JSON.parse(snap.value));
    await saveData();
    render();
    showToast('به حالت قبل از بازیابی برگشت');
  }catch(e){
    console.error(e);
    showToast('بازگرداندن ممکن نشد');
  }
}

// ---------- بکاپ خودکار ساده (fire-and-forget، هیچ‌وقت نباید جلوی ذخیره‌ی اصلی را بگیرد) ----------
async function getAutoBackupList(){
  const rec = await dbGet(AUTO_BACKUP_LIST_KEY);
  return (rec && rec.value) ? JSON.parse(rec.value) : [];
}

async function autoBackupTick(){
  const list = await getAutoBackupList();
  const last = list.length ? list[list.length-1].ts : 0;
  if(Date.now() - last < AUTO_BACKUP_INTERVAL_MS) return; // هنوز زوده، لازم نیست نسخه‌ی جدید بگیریم
  const ts = Date.now();
  const key = AUTO_BACKUP_PREFIX + ts;
  await dbPut(key, JSON.stringify(data));
  list.push({key, ts});
  while(list.length > AUTO_BACKUP_MAX){
    const old = list.shift();
    try{ await dbDelete(old.key); }catch(e){ /* نبود یا حذف نشد، مهم نیست */ }
  }
  await dbPut(AUTO_BACKUP_LIST_KEY, JSON.stringify(list));
}

async function restoreFromAutoBackup(key){
  if(!confirm('مطمئنی؟ اطلاعات فعلی با این نسخه‌ی بکاپ خودکار جایگزین می‌شه.')) return;
  try{
    const snap = await dbGet(key);
    if(!snap || !snap.value){ showToast('این نسخه‌ی بکاپ پیدا نشد'); return; }
    // مثل بازیابی از فایل: قبل از جایگزینی، وضعیت فعلی هم نگه داشته می‌شود
    await dbPut(PRERESTORE_KEY, JSON.stringify(data));
    data = normalizeData(JSON.parse(snap.value));
    await saveData();
    render();
    showToast('از بکاپ خودکار بازیابی شد');
  }catch(e){
    console.error(e);
    showToast('بازیابی از بکاپ خودکار ممکن نشد');
  }
}

function exportExcel(){
  if(typeof XLSX === 'undefined'){
    showToast('کتابخانه اکسل لود نشد؛ برای این خروجی به اینترنت نیاز است');
    return;
  }
  const wb = XLSX.utils.book_new();

  const custRows = data.customers.map(c=>{
    const t = customerTotals(c.id);
    return {
      'نام فروشگاه': c.name, 'صاحب فروشگاه': c.ownerName||'', 'شماره تماس': c.phone||'',
      'منطقه': c.region||'', 'مسیر': c.route||'',
      'جمع فاکتورها': t.invTotal, 'مانده حساب': t.balance,
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(custRows.length?custRows:[{'نام فروشگاه':''}]), 'مشتریان');

  const invRows = [];
  data.invoices.forEach(i=>{
    const cust = data.customers.find(c=>c.id===i.customerId);
    i.items.forEach(it=>{
      invRows.push({
        'شماره فاکتور': i.number||'', 'تاریخ': i.date, 'مشتری': cust?cust.name:'',
        'کالا': it.name, 'تعداد': it.qty, 'قیمت واحد': it.price, 'جمع': it.qty*it.price - (it.discount||0),
      });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invRows.length?invRows:[{'شماره فاکتور':''}]), 'فاکتورها');

  const prodRows = data.products.map(p=>({
    'نام کالا': p.name, 'دسته‌بندی': p.category||'', 'قیمت خرید': p.buy,
    'قیمت عمده': p.wholesale, 'قیمت مصرف‌کننده': p.retail, 'موجودی': p.stockQty,
    'ارزش ریالی موجودی': (p.stockQty||0)*(p.buy||0),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prodRows.length?prodRows:[{'نام کالا':''}]), 'کالاها');

  const supRows = data.suppliers.map(s=>{
    const t = supplierTotals(s.id);
    return { 'تامین‌کننده': s.name, 'جمع خرید': t.purchaseTotal, 'جمع پرداخت': t.payTotal, 'بدهی': t.balance };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(supRows.length?supRows:[{'تامین‌کننده':''}]), 'تامین‌کننده‌ها');

  const wbArray = XLSX.write(wb, {bookType:'xlsx', type:'array'});
  const blob = new Blob([wbArray], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  downloadFile(`baqeri-report-${todayISO()}.xlsx`, blob).then(()=>{
    showToast('فایل اکسل آماده شد');
  });
}

