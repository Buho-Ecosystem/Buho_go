// Real Vue layout checks with seeded merchant records; no wallet settlement is exercised.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.KIOSK_BASE_URL || 'http://127.0.0.1:9100';
const output = process.env.KIOSK_LAYOUT_OUTPUT || 'docs/images/kiosk-pos';
const reportPath = process.env.KIOSK_LAYOUT_REPORT || 'docs/reviews/kiosk-layout.json';
await mkdir(output, {recursive:true});
await mkdir(new URL('../docs/reviews/', import.meta.url), {recursive:true});
const report = {evidence:'Actual Vue UI with seeded local merchant records. This is layout and interaction evidence, not payment settlement verification.', products:1000, orders:10000, layouts:[]};
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:390,height:844}});
await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
// Disable live reload and remote wallet connections to keep the fixture deterministic.
await context.routeWebSocket('**/*', socket => socket.close());
await context.addInitScript(()=>{localStorage.setItem('buhoGO_language','en-US');localStorage.setItem('buho.theme','light');localStorage.setItem('buhoGO_wallet_store',JSON.stringify({wallets:[],activeWalletId:null,biometricsEnabled:false}));});
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const navigate=path=>page.evaluate(target=>document.querySelector('#q-app').__vue_app__.config.globalProperties.$router.push(target),path);
const settleLayout = () => page.evaluate(async () => {
  await document.fonts.ready;
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
});
// A long list learns its full height as its rows mount, so one jump to the end
// can land short of the last row. Jump again, a frame apart, until it is there.
async function scrollUntil(scroller, edge, row) {
  for (let tries = 0; tries < 50 && !(await row.isVisible()); tries += 1) {
    await page.locator(scroller).evaluate((el, end) => { el.scrollTop = end ? el.scrollHeight : 0; }, edge === 'end');
    await settleLayout();
  }
  await row.waitFor();
}
try {
  await page.goto(`${base}/#/kiosk-mode`);
  await page.waitForSelector('#q-app .q-page');
  await page.evaluate(async()=>{
    const {useWalletStore}=await import('/src/stores/wallet.js');
    const {useKioskMerchantStore}=await import('/src/stores/kioskMerchant.js');
    const {emptyKioskMerchant}=await import('/src/utils/kioskMerchant.js');
    const wallet=useWalletStore(),merchant=useKioskMerchantStore();
    wallet.wallets=[{id:'counter',name:'Counter wallet',type:'lnbits'}];wallet.activeWalletId='counter';wallet.kioskWalletId='counter';wallet.kioskEnabled=true;wallet.kioskOwnerAccess=true;
    merchant.data=emptyKioskMerchant('EUR');merchant.initialized=true;merchant.data.setupCompleted=true;merchant.data.categories=['Drinks','Food'];
    merchant.data.products=Array.from({length:1000},(_,i)=>({id:`product-${i}`,name:`Product ${String(i).padStart(4,'0')}`,category:i%2?'Food':'Drinks',priceMinor:100+i,currency:'EUR'}));
    merchant.data.orders=Array.from({length:10000},(_,i)=>({id:`sale-${i}`,createdAt:Date.now()-i*1000,paidAt:Date.now()-i*1000,currency:'EUR',subtotalMinor:100,totalMinor:100,totalSats:1000,baseSats:1000,tipSats:0,roundUpSats:0,status:'paid',walletId:'counter',walletName:'Counter wallet',label:`Sale ${String(i).padStart(5,'0')}`,method:'QR',attempts:[],items:[{id:`item-${i}`,name:'Tea',category:'Drinks',qty:1,unit:'fiat',priceMinor:100,lineMinor:100,lineSats:1000,currency:'EUR'}]}));
    window.__merchant=merchant;
  });
  await navigate('/settings');await navigate('/kiosk-mode?view=products');
  await page.locator('.kiosk-products__product').first().waitFor();
  await settleLayout();
  const productRows=await page.locator('.kiosk-products__product').count();assert(productRows<100,`product rows ${productRows}`);
  await scrollUntil('.kiosk-products__list', 'end', page.getByRole('button',{name:'Edit Product 0999',exact:true}));
  await scrollUntil('.kiosk-products__list', 'start', page.getByRole('button',{name:'Edit Product 0000',exact:true}));
  await page.getByRole('button',{name:'More actions',exact:true}).click();
  await page.locator('.ko-sheet').getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('.ko-sheet').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Edit Product 0000',exact:true}).click();
  await page.locator('.ko-editor').getByRole('textbox',{name:'Name',exact:true}).fill('Product 0000 edited');
  await page.locator('.ko-editor').getByRole('textbox',{name:'Price',exact:true}).fill('1.25');
  await page.locator('.ko-editor').getByRole('button',{name:'Save',exact:true}).click();
  await page.locator('.ko-editor').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Edit Product 0000 edited',exact:true}).waitFor();
  await page.screenshot({path:`${output}/products.png`});
  await navigate('/kiosk-mode?view=sales');
  await page.locator('.ko-sale-row').first().waitFor();
  await page.getByRole('combobox',{name:'Period',exact:true}).selectOption('all');
  await settleLayout();
  const salesRows=await page.locator('.ko-sale-row').count();assert(salesRows<100,`sales rows ${salesRows}`);
  assert.match(await page.locator('.ko-summary').innerText(),/10,?000 paid sales/);
  await scrollUntil('.ko-sales-scroll', 'end', page.getByRole('button',{name:/Sale 09999/}));
  const before=await page.locator('.ko-sales-scroll').evaluate(el=>el.scrollTop);
  await page.getByRole('button',{name:/Sale 09999/}).click();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:/Sale 09999/}).waitFor();
  assert(Math.abs(await page.locator('.ko-sales-scroll').evaluate(el=>el.scrollTop)-before)<150,'receipt back restores position');
  await page.getByRole('button',{name:'Search sales',exact:true}).click();
  await page.getByRole('searchbox',{name:'Search sales',exact:true}).fill('Sale 05000');
  await page.getByRole('button',{name:/Sale 05000/}).waitFor();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:/Sale 09999/}).waitFor();
  assert(Math.abs(await page.locator('.ko-sales-scroll').evaluate(el=>el.scrollTop)-before)<150,'search cancel restores position');
  await scrollUntil('.ko-sales-scroll', 'start', page.getByRole('button',{name:/Sale 00000/}));
  await page.screenshot({path:`${output}/owner-sales.png`});
  await page.locator('.ko-sale-row').first().click();
  await page.locator('.kiosk-receipt').waitFor();
  await page.getByRole('button',{name:'More actions',exact:true}).click();
  await page.locator('.ko-sheet').getByRole('button',{name:'Payment details',exact:true}).click();
  await page.locator('.ko-details').getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('.ko-details').waitFor({state:'hidden'});
  await page.screenshot({path:`${output}/receipt.png`});
  await navigate('/kiosk-mode?view=payouts');
  await page.getByRole('button',{name:'Withdraw now',exact:true}).waitFor();
  await page.screenshot({path:`${output}/transfers.png`});
  await navigate('/kiosk-mode?view=sales');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight+1);assert.equal(overflow,false);
  await page.setViewportSize({width:320,height:568});
  await page.waitForFunction(()=>document.documentElement.scrollHeight<=innerHeight+1);
  const measure = label => page.evaluate(label => {
    const header=document.querySelector('.kiosk-toolbar');
    const scroller=document.querySelector('.ko-sales-scroll');
    return {label, width:innerWidth, height:innerHeight, headerHeight:header?.getBoundingClientRect().height, listHeight:scroller?.getBoundingClientRect().height, mountedSaleRows:document.querySelectorAll('.ko-sale-row').length, horizontalOverflow:document.documentElement.scrollWidth>innerWidth, outerScroll:document.documentElement.scrollHeight>innerHeight+1};
  }, label);
  report.layouts.push(await measure('compact sales'));
  await page.getByRole('button',{name:'Search sales',exact:true}).click();
  await page.getByRole('searchbox',{name:'Search sales',exact:true}).fill('Sale 00001');
  await page.getByRole('searchbox',{name:'Search sales',exact:true}).press('Enter');
  assert.equal(await page.getByRole('searchbox',{name:'Search sales',exact:true}).evaluate(el=>el===document.activeElement),false,'submit dismisses keyboard focus');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.querySelector('#q-app').__vue_app__.config.globalProperties.$q.dark.set(dark), dark);
    const contrast = await page.evaluate(() => {
      const rgb = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = value => rgb(value).map(channel => { const s = channel / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const surface = luminance(getComputedStyle(document.querySelector('.kiosk-owner')).backgroundColor);
      const text = luminance(getComputedStyle(document.querySelector('.ko-sale-row small')).color);
      return (Math.max(surface, text) + .05) / (Math.min(surface, text) + .05);
    });
    assert(contrast >= 4.5, `sales secondary text contrast ${contrast}`);
    report.layouts.push({ label: dark ? 'dark sales contrast' : 'light sales contrast', secondaryTextContrast: Number(contrast.toFixed(2)) });
  }
  await page.evaluate(() => document.querySelector('#q-app').__vue_app__.config.globalProperties.$q.dark.set(false));
  await page.evaluate(async()=>{const{useWalletStore}=await import('/src/stores/wallet.js');useWalletStore().kioskEnabled=false;window.__merchant.data.setupCompleted=false;});
  await navigate('/settings');await navigate('/kiosk-mode');
  await page.getByRole('button',{name:'Set up register',exact:true}).waitFor();
  report.layouts.push(await page.evaluate(()=>({label:'compact welcome',width:innerWidth,height:innerHeight,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,outerScroll:document.documentElement.scrollHeight>innerHeight+1})));
  const clipped=await page.locator('.kiosk-onboarding button').evaluateAll(buttons=>buttons.filter(button=>{const rect=button.getBoundingClientRect();return rect.top<0||rect.bottom>innerHeight+1;}).map(button=>button.textContent));
  assert.deepEqual(clipped,[],'welcome actions fit compact phone');
  for (const locale of ['en-US', 'de', 'es']) {
    await page.evaluate(async locale => {
      const { i18n } = await import('/src/boot/i18n.js');
      if (typeof i18n.global.locale === 'object') i18n.global.locale.value = locale;
      else i18n.global.locale = locale;
    }, locale);
    const layout = await page.evaluate(() => {
      const welcome = document.querySelector('.kiosk-onboarding__welcome');
      const actions = [...document.querySelectorAll('.kiosk-onboarding button')].map(button => button.getBoundingClientRect());
      return { internalScroll: welcome.scrollHeight > welcome.clientHeight + 1, minimumTouchHeight: Math.min(...actions.map(rect => rect.height)), actionsVisible: actions.every(rect => rect.top >= 0 && rect.bottom <= innerHeight + 1) };
    });
    assert.equal(layout.internalScroll, false, `${locale} welcome content fits`);
    assert.equal(layout.actionsVisible, true, `${locale} welcome actions fit`);
    assert(layout.minimumTouchHeight >= 44, `${locale} touch targets`);
    report.layouts.push({ label: `${locale} compact welcome`, ...layout });
  }
  Object.assign(report,{mountedProductRows:productRows,mountedSaleRows:salesRows,moreCloseClickable:true,editorSaveClickable:true,detailsCloseClickable:true,receiptBackRestored:true,searchCancelRestored:true,keyboardDismissedOnSubmit:true,welcomeActionsVisible:true,pageErrors:errors});
  assert(report.layouts.every(layout=>!layout.horizontalOverflow&&!layout.outerScroll),JSON.stringify(report.layouts));
  await writeFile(reportPath, JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  assert.deepEqual(errors,[]);
} catch (error) {
  console.error(await page.evaluate(() => ({ text:document.body.innerText.slice(-1200), list:[...document.querySelectorAll('.ko-sales-scroll')].map(el=>({top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight,rows:[...el.querySelectorAll('.ko-sale-row')].map(row=>row.innerText)})) })));
  await page.screenshot({path:'/private/tmp/buho-kiosk-layout-failure.png'});
  throw error;
} finally {await browser.close();}
