/* calc.js — balances, profit, inventory value, filters (read-only derived data)
   Phase 0 extract: no logic changes.
*/
// ---------- derived calculations ----------
function customerInvoices(cid){ return data.invoices.filter(i=>i.customerId===cid); }
function customerPayments(cid){ return data.payments.filter(p=>p.customerId===cid); }
function customerChecks(cid){ return data.checks.filter(c=>c.customerId===cid); }

// برای هشدار «برگشت بیشتر از فروش قبلی»: مجموع فروخته‌شده و مجموع قبلاً برگشت‌داده‌شده‌ی
// یک کالای مشخص به یک مشتری مشخص
function productSoldQtyToCustomer(cid, productId){
  return customerInvoices(cid).reduce((s,inv)=>
    s + inv.items.filter(it=>it.productId===productId).reduce((a,it)=>a+(it.qty||0),0), 0);
}
function productReturnedQtyByCustomer(cid, productId){
  return customerPayments(cid).filter(p=>p.method==='return').reduce((s,p)=>
    s + (p.returnItems||[]).filter(ri=>ri.productId===productId).reduce((a,ri)=>a+(ri.qty||0),0), 0);
}
function productReturnAvailableQty(cid, productId){
  return Math.max(0, productSoldQtyToCustomer(cid, productId) - productReturnedQtyByCustomer(cid, productId));
}

function customerTotals(cid){
  const invTotal = customerInvoices(cid).reduce((s,i)=>s+i.total,0);
  const payTotal = customerPayments(cid).reduce((s,p)=>s+p.amount,0);
  const checkTotal = customerChecks(cid).reduce((s,c)=>s+c.amount,0);
  const cashOnlyTotal = customerPayments(cid).filter(p=>['cash','card','transfer'].includes(p.method)).reduce((s,p)=>s+p.amount,0);
  const discountTotal = customerPayments(cid).filter(p=>p.method==='discount').reduce((s,p)=>s+p.amount,0);
  const returnTotal = customerPayments(cid).filter(p=>p.method==='return').reduce((s,p)=>s+p.amount,0);
  const c = data.customers.find(x=>x.id===cid);
  const openingBalance = c ? (c.openingBalance||0) : 0;
  const balance = openingBalance + invTotal - payTotal - checkTotal;
  return { invTotal, payTotal, checkTotal, cashOnlyTotal, discountTotal, returnTotal, openingBalance, balance };
}

// تخفیف کلی فاکتور: مبلغ ثابت (پیش‌فرض/قدیمی) یا درصد از جمع جزء فاکتور
function invoiceDiscountAmount(inv){
  if(inv.discountType==='percent'){
    const subtotal = (inv.items||[]).reduce((s,it)=>s+it.qty*it.price-(it.discount||0),0);
    return subtotal*(inv.discount||0)/100;
  }
  return inv.discount||0;
}

function customerProfit(cid){
  // سود فاکتورها (با تخفیف ردیف و تخفیف کلی)
  let s = customerInvoices(cid).reduce((sum,inv)=>{
    const itemsProfit = inv.items.reduce((a,it)=>a + (it.price - (it.buyPrice||0)) * it.qty - (it.discount||0), 0);
    return sum + itemsProfit - invoiceDiscountAmount(inv);
  },0);
  // کسر حاشیه برگشت از فروش: (قیمت برگشت − قیمت خرید) × تعداد — فقط وقتی returnItems ثبت شده
  customerPayments(cid).filter(p=>p.method==='return').forEach(p=>{
    (p.returnItems||[]).forEach(ri=>{
      if(!(ri.qty>0)) return;
      const sold = customerInvoices(cid).flatMap(inv=>inv.items.filter(it=>it.productId===ri.productId));
      const lastSold = sold.length ? sold[sold.length-1] : null;
      const prod = data.products.find(x=>x.id===ri.productId);
      const buy = (lastSold && lastSold.buyPrice!==undefined) ? (lastSold.buyPrice||0) : (prod ? (prod.buy||0) : 0);
      const sell = (ri.price>0) ? ri.price : (lastSold ? (lastSold.price||0) : 0);
      s -= (sell - buy) * ri.qty;
    });
  });
  // کسر تراکنش «تخفیف (کاهش بدهی)» از سود گزارش‌شده
  s -= customerPayments(cid).filter(p=>p.method==='discount').reduce((a,p)=>a+(p.amount||0),0);
  return s;
}

function customerStats(cid){
  const invs = customerInvoices(cid);
  const pays = customerPayments(cid);
  const t = customerTotals(cid);
  const sortedInvs = invs.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
  const lastInvoice = sortedInvs[sortedInvs.length-1];
  const firstInvoice = sortedInvs[0];
  const lastPayment = pays.slice().sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
  return {
    count: invs.length,
    avgInvoice: invs.length ? t.invTotal/invs.length : 0,
    firstInvoiceDate: firstInvoice ? firstInvoice.date : null,
    lastInvoiceDate: lastInvoice ? lastInvoice.date : null,
    lastPaymentDate: lastPayment ? lastPayment.date : null,
    profit: customerProfit(cid),
    daysSinceLast: lastInvoice ? daysAgo(lastInvoice.date) : Infinity,
  };
}

function customerStatus(cid){
  const st = customerStats(cid);
  if(st.count===0) return 'new';
  if(st.daysSinceLast > 60) return 'lost';
  if(st.daysSinceLast > 21) return 'inactive';
  return 'active';
}

function supplierTotals(sid){
  const s = data.suppliers.find(x=>x.id===sid);
  if(!s) return {purchaseTotal:0, payTotal:0, returnTotal:0, balance:0};
  const purchaseTotal = (s.purchases||[]).reduce((a,p)=>a+p.amount,0);
  const returnTotal = (s.purchases||[]).reduce((a,p)=>a+(p.returns||[]).reduce((b,r)=>b+(r.amount||0),0),0);
  const payTotal = (s.payments||[]).reduce((a,p)=>a+p.amount,0);
  const openingBalance = s.openingBalance||0;
  return { purchaseTotal, payTotal, returnTotal, openingBalance, balance: openingBalance + purchaseTotal - payTotal - returnTotal };
}

function inventoryValue(){
  return data.products.reduce((s,p)=>s + (p.stockQty||0)*(p.buy||0), 0);
}

// یک نقطه‌ی واحد برای خوندن اقلام یک خرید: چندقلمی جدید، یا تک‌کالای قدیمی، یا بدون کالا
function purchaseLines(p){
  if(Array.isArray(p.items) && p.items.length) return p.items;
  if(p.productId && p.qty>0) return [{productId:p.productId, name:(data.products.find(x=>x.id===p.productId)||{}).name||'', qty:p.qty}];
  return [];
}
// مقدار قابل‌برگشت (qty) برای یک خرید — سازگار با تک‌قلمی و چندقلمی
function purchaseReturnRemainingQty(p){
  const already = (p.returns||[]).reduce((a,r)=>a+(Number(r.qty)||0),0);
  if(p.productId){
    return Math.max(0, (Number(p.qty)||0) - already);
  }
  const lines = purchaseLines(p);
  if(lines.length){
    const purchased = lines.reduce((s,l)=>s+(Number(l.qty)||0),0);
    return Math.max(0, purchased - already);
  }
  return 0;
}
function purchaseReturnRemainingAmount(p){
  const already = (p.returns||[]).reduce((a,r)=>a+(Number(r.amount)||0),0);
  return Math.max(0, (Number(p.amount)||0) - already);
}
// مقدار قابل‌برگشتِ یک قلمِ مشخص از یک خرید چندقلمی (با احتساب برگشت‌های قبلی همون قلم)
function purchaseLineRemainingQty(p, itemId){
  const line = (p.items||[]).find(it=>it.id===itemId);
  if(!line) return 0;
  const already = (p.returns||[]).reduce((a,r)=>a+((r.items||[]).filter(x=>x.itemId===itemId).reduce((b,x)=>b+(Number(x.qty)||0),0)),0);
  return Math.max(0, (Number(line.qty)||0) - already);
}
// اثر موجودی خرید تامین‌کننده (ایجاد) — فقط روی خطوط دارای productId و qty>0
function lowStockProducts(){
  return data.products.filter(p => (p.minStock||0) > 0 && (p.stockQty||0) <= p.minStock);
}

function isSameMonth(iso, ref){
  const d = new Date(iso), r = ref;
  return d.getFullYear()===r.getFullYear() && d.getMonth()===r.getMonth();
}
function isSameDay(iso, ref){
  const d = new Date(iso);
  return d.toDateString() === ref.toDateString();
}

function globalTotals(){
  const totalSales = data.invoices.reduce((s,i)=>s+i.total,0);
  // همان منطق customerProfit برای همه مشتریان (فاکتور − حاشیه برگشت − تخفیف تراکنشی)
  const totalProfit = data.customers.reduce((s,c)=>s + customerProfit(c.id), 0);
  const totalReceived = data.payments.filter(p=>['cash','card','transfer'].includes(p.method)).reduce((s,p)=>s+p.amount,0);
  const outstandingChecks = data.checks.filter(c=>c.status!=='cleared').reduce((s,c)=>s+c.amount,0);
  const customerDebt = data.customers.reduce((s,c)=>{
    const t = customerTotals(c.id);
    return s + Math.max(t.balance,0);
  },0);
  const supplierDebt = data.suppliers.reduce((s,sp)=>s+supplierTotals(sp.id).balance,0);

  const now = new Date();
  const todaySales = data.invoices.filter(i=>isSameDay(i.date, now)).reduce((s,i)=>s+i.total,0);
  const todayCount = data.invoices.filter(i=>isSameDay(i.date, now)).length;
  const monthSales = data.invoices.filter(i=>isSameMonth(i.date, now)).reduce((s,i)=>s+i.total,0);
  const monthCount = data.invoices.filter(i=>isSameMonth(i.date, now)).length;

  return { totalSales, totalProfit, totalReceived, outstandingChecks, customerDebt, supplierDebt,
    todaySales, todayCount, monthSales, monthCount };
}

function checksDueSoon(){
  const now = new Date();
  return data.checks.filter(c=>{
    if(c.status==='cleared') return false;
    const due = new Date(c.dueDate);
    const diffDays = (due - now)/86400000;
    return diffDays <= 3;
  }).sort((a,b)=> new Date(a.dueDate)-new Date(b.dueDate));
}

function topProducts(limit){
  const map = {};
  data.invoices.forEach(inv=>inv.items.forEach(it=>{
    if(!map[it.productId]) map[it.productId] = {name:it.name, qty:0, revenue:0};
    map[it.productId].qty += it.qty;
    map[it.productId].revenue += it.qty*it.price - (it.discount||0);
  }));
  return Object.values(map).sort((a,b)=>b.qty-a.qty).slice(0, limit||5);
}
function topCustomers(limit){
  return data.customers.map(c=>({ c, t: customerTotals(c.id) }))
    .sort((a,b)=>b.t.invTotal-a.t.invTotal)
    .slice(0, limit||5)
    .filter(x=>x.t.invTotal>0);
}
function debtorList(limit){
  return data.customers.map(c=>({ c, t: customerTotals(c.id) }))
    .filter(x=>x.t.balance>0)
    .sort((a,b)=>b.t.balance-a.t.balance)
    .slice(0, limit||10000);
}
function inactiveCustomers(){
  return data.customers.filter(c=>{
    const status = customerStatus(c.id);
    return status==='inactive' || status==='lost';
  }).map(c=>({c, st:customerStats(c.id)})).sort((a,b)=>b.st.daysSinceLast-a.st.daysSinceLast);
}

