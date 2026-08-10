/* stock.js — inventory apply/revert effects (invoice, purchase, return)
   Phase 0 extract: no logic changes.
*/
function applyPurchaseStockEffects(purchase, supplierName){
  const lines = purchaseLines(purchase);
  const date = purchase.date || todayISO();
  lines.forEach(it=>{
    if(!it.productId || !(it.qty>0)) return;
    const prod = data.products.find(x=>x.id===it.productId);
    if(prod){
      prod.stockQty = (prod.stockQty||0) + it.qty;
      prod.stockLog = prod.stockLog||[];
      prod.stockLog.push({id:uid(), date, type:'in', qty:it.qty, note:'خرید از '+(supplierName||''), purchaseId:purchase.id});
    }
  });
}
// خنثی‌سازی اثر موجودی خرید (حذف/قبل از ویرایش) — بدون double-apply روی دادهٔ قدیمی
function revertPurchaseStockEffects(purchase){
  const lines = purchaseLines(purchase);
  lines.forEach(it=>{
    if(!it.productId || !(it.qty>0)) return;
    const prod = data.products.find(x=>x.id===it.productId);
    if(prod){
      prod.stockQty = (prod.stockQty||0) - it.qty;
      prod.stockLog = (prod.stockLog||[]).filter(l=>{
        if(l.purchaseId) return l.purchaseId !== purchase.id;
        // legacy: بدون purchaseId — یک لاگ هم‌خوان با qty/type/note را حذف کن
        return !(l.type==='in' && l.qty===it.qty && l.note && String(l.note).indexOf('خرید از')===0);
      });
    }
  });
}

// ---------- برگشت فروش = ورود کالا به انبار (فقط برای برگشت‌های جدید که کالا مشخص کرده‌اند) ----------
function applyReturnStockEffects(returnItems, date, payment){
  returnItems.forEach(ri=>{
    const prod = data.products.find(p=>p.id===ri.productId);
    if(prod){
      prod.stockQty = (prod.stockQty||0) + (ri.qty||0);
      prod.stockLog = prod.stockLog||[];
      prod.stockLog.push({id:uid(), date, type:'return', qty:ri.qty||0, note:'برگشت از فروش', paymentId:payment.id});
    }
  });
}

// ---------- shared invoice stock/payment effects (used by both create + edit, so the two flows can't drift apart) ----------
function applyInvoiceStockEffects(items, date, inv, isNewInvoice){
  // sale = خروج کالا: deduct stock, log it against this invoice
  items.forEach(it=>{
    const prod = data.products.find(p=>p.id===it.productId);
    if(prod){
      // قیمت فاکتور (چه پیش‌فرض، چه دستیِ توافقی با یک مشتری خاص) فقط متعلق به همین فاکتور است؛
      // قیمت رسمی محصول (retail/sell) دیگر هرگز از روی قیمت فاکتور تغییر نمی‌کند —
      // تغییر قیمت رسمی کالا فقط از فرم «ویرایش کالا» انجام می‌شود.
      prod.stockQty = (prod.stockQty||0) - it.qty;
      prod.stockLog = prod.stockLog||[];
      prod.stockLog.push({id:uid(), date, type:'sale', qty:-it.qty, note:'فروش (فاکتور #'+inv.number+')', invoiceId:inv.id});
    }
  });
}
function revertInvoiceStockEffects(inv){
  // undo exactly what applyInvoiceStockEffects did for this invoice's (old) items
  (inv.items||[]).forEach(it=>{
    const prod = data.products.find(p=>p.id===it.productId);
    if(prod){
      prod.stockQty = (prod.stockQty||0) + it.qty;
      prod.stockLog = (prod.stockLog||[]).filter(l=>{
        if(l.invoiceId) return l.invoiceId !== inv.id;
        // legacy entries (created before invoiceId was tracked) — match by tag+qty instead
        return !(l.type==='sale' && l.qty===-it.qty && l.note && l.note.includes('فاکتور #'+inv.number+')'));
      });
    }
  });
}
