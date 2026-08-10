/* ui.js — shared UI helpers (toast, modal/sheet, formatting)
   Phase 0 extract: no logic changes.
*/
// ---------- small utilities ----------
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function faToEnDigits(str){
  if(str===null || str===undefined) return '';
  const map = {'۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
               '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
               '٫':'.','،':''};
  return String(str).replace(/[۰-۹٠-٩٫،]/g, ch=>map[ch]!==undefined?map[ch]:ch);
}
function numVal(el){
  if(!el) return 0;
  return parseFloat(faToEnDigits(el.value))||0;
}
function esc(s){
  return String(s===undefined||s===null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function toman(n){ return (Math.round(n||0)).toLocaleString('fa-IR'); }
function balanceStatusWord(balance){
  if(balance>0) return 'بدهکار';
  if(balance<0) return 'بستانکار';
  return 'تسویه شده';
}
function balanceStatusText(balance, amountText){
  return balance===0 ? balanceStatusWord(balance) : (balanceStatusWord(balance)+': '+amountText);
}
function todayISO(){ return new Date().toISOString().slice(0,10); }
function nowHHMM(){ const d=new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function faDate(iso){
  if(!iso) return '—';
  try{ return new Date(iso).toLocaleDateString('fa-IR'); }catch(e){ return iso; }
}
function daysAgo(iso){
  if(!iso) return Infinity;
  const d = new Date(iso);
  if(isNaN(d)) return Infinity;
  return Math.floor((Date.now()-d.getTime())/86400000);
}
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(()=>t.classList.remove('show'), 2000);
}


// ---------- modals ----------
function closeModal(){
  const root = document.getElementById('modalRoot');
  root.innerHTML = '';
  if(window.scrollX) window.scrollTo(0, window.scrollY);
}

function openSheet(html){
  const root = document.getElementById('modalRoot');
  // مطمئن شو هر Modal قبلی کاملاً پاک شده (نه فقط مخفی) قبل از ساختن Modal جدید،
  // و یک reflow اجباری بین پاک‌شدن و رندر جدید انجام بده تا ظاهر (گوشه‌های گرد و غیره) بعد از باز/بسته‌شدن‌های مکرر خراب نشه
  closeModal();
  void root.offsetHeight;
  root.innerHTML = `
    <div class="overlay" id="overlay">
      <div class="sheet" style="position:relative;">
        <button class="close-x" id="closeX">×</button>
        ${html}
      </div>
    </div>`;
  document.getElementById('overlay').addEventListener('click', (e)=>{ if(e.target.id==='overlay') closeModal(); });
  document.getElementById('closeX').addEventListener('click', closeModal);
}

