/** Browser regression using public test words. Run with the local Quasar dev server on port 9000. */
import { chromium } from '@playwright/test';
// Published BIP-39 all-zero test vector, sealed with a fixed test-only AES key.
// Never substitute real recovery words or credentials here.
const AUDIT_DEVICE_KEY = 'DRQbIikwNz5FTFNaYWhvdn2Ei5KZoKeutbzDytHY3+Y=';
const AUDIT_SEED_ENVELOPE = 'AQIDBAUGBwgJCgsM5oeZavUf7bRrnLvfrRnjlmYhzZU1ngV33uyJHLa6BRi0XiXABbXW2piRbwX6+3otDTRGQaMsYbx7QIHyaSfxKE7Qpac/6BPd+mj7Cl3m4ODzaCnB384XShC+E5DD5KnMaTm2DzlNtXmT8dL23g==';
const identityMeta = () => ({
 version:1, backupConfirmed:false, fingerprint:'2be1176e1790b6ca', nostrAccountIndex:0,
 nostrPubkeyHex:'e8bcf3823669444d0b49ad45d65088635d9fd8500a75b5f20b59abefa56a144f',
 nostrNpub:'npub1az708q3kd9zy6z6f44zav5ygvdwelkzspf6mtusttx47lft2z38sghk0w7',
 nostrKnownAccounts:[{i:0},{i:1}], nip05Handles:[], nostrAccountNip05:{}, connectedSites:[], pointerDirty:false,
});
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const out=new URL('../output/backup-wos', import.meta.url).pathname;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)||new URL(r.request().url()).hostname.endsWith('iconify.design')?r.continue():r.abort());
await page.routeWebSocket('**',ws=>ws.close());
await page.addInitScript(()=>{
 window.__AUDIT__={theme:'light'};
 localStorage.setItem('buho-theme-mode','light');
 localStorage.setItem('buhoGO_wallet_store',JSON.stringify({
  wallets:[{id:'spark-personal-1',name:'Personal',type:'spark',balance:0,metadata:{},connectionData:{accountNumber:1,walletGroupId:'test'}},
    {id:'spark-business-1',name:'Business',type:'spark',balance:0,metadata:{},connectionData:{accountNumber:2,walletGroupId:'test'}}],
  activeWalletId:'spark-personal-1', preferredFiatCurrency:'USD', defaultDisplayCurrency:'sats', denominationCurrency:'sats',
  exchangeRates:{USD:95000},exchangeRatesAvailable:true,exchangeRatesLastUpdate:Date.now(),hasBackedUp:false,biometricsEnabled:false,
 }));
});
await page.addInitScript(({key,seed,meta})=>{
 const data=JSON.parse(localStorage.getItem('buhoGO_wallet_store'));data.hasBackedUp=false;data.biometricsEnabled=false;
 for(const w of data.wallets){w.metadata.hasBackedUp=false;w.connectionData.encryptedMnemonic=seed;}
 data.wallets.push({id:'arkade-test',name:'Arkade',type:'arkade',metadata:{hasBackedUp:false},connectionData:{encryptedMnemonic:seed}});
 localStorage.setItem('buhoGO_wallet_store',JSON.stringify(data));localStorage.setItem('buhoGO_device_key',key);localStorage.setItem('buhoGO_identity_seed_v1',seed);localStorage.setItem('buhoGO_identity_v1',JSON.stringify(meta));
},{key:AUDIT_DEVICE_KEY,seed:AUDIT_SEED_ENVELOPE,meta:identityMeta()});
async function shot(name){await page.waitForTimeout(400);await page.screenshot({path:out+'/'+name+'.png'});}
async function route(path){await page.evaluate(p=>window.__audit.app.config.globalProperties.$router.push(p),path);await page.waitForTimeout(500);}
async function writeAndCheck(prefix) {
 const next = page.locator('.recovery-primary');
 assert.equal(await next.isDisabled(), true, 'acknowledgement gates reveal');
 await page.locator('.recovery-acknowledgement').click();
 assert.equal(await page.getByRole('switch').isChecked(), true, 'the whole consent row is tappable');
 await page.getByRole('switch').focus(); await page.getByRole('switch').press('Space');
 assert.equal(await next.isDisabled(), true, 'keyboard unchecking disables Next');
 await page.getByRole('switch').press('Space');
 await next.click();
 await page.locator('.recovery-words').waitFor();
 assert.equal(await page.locator('.recovery-words li').count(), 12);
 assert.equal(await page.locator('.recovery-words li').filter({hasText:'abandon'}).count(), 11, 'words appear after the acknowledged reveal');
 if (prefix) await shot(prefix + '-words');
 await next.click();
 await page.locator('.word-chip').first().waitFor();
 assert.equal(await next.isDisabled(), true, 'all words must match');
 if (prefix) await shot(prefix + '-check');
 await page.locator('.word-chip:not([disabled])').filter({hasText:/^about$/}).click();
 await page.getByText('Check word 1 on your paper and try again.',{exact:true}).waitFor();
 assert.equal(await next.isDisabled(), true);
 for(let i=0;i<11;i++) await page.locator('.word-chip:not([disabled])').filter({hasText:/^abandon$/}).first().click();
 await page.locator('.word-chip:not([disabled])').filter({hasText:/^about$/}).click();
 assert.equal(await next.isDisabled(), false);
}
async function choose(subject) {
 await page.locator('.backup-choices').waitFor();
 await page.locator('.backup-choices .backup-choice').filter({hasText:subject}).click();
 await page.locator('.recovery-body--prepare').waitFor();
 // The flow opens straight from the page, so let the dialog's entrance settle before measuring it.
 await page.waitForFunction(()=>[...document.querySelectorAll('.q-dialog__inner')].every(el=>![...el.classList].some(c=>c.includes('enter-active'))));
}
async function expectSecurityPage() {
 await page.locator('.security-page .backup-choices-list').waitFor();
 assert.equal(await page.evaluate(()=>window.location.hash), '#/security');
}
async function finish() {
 await page.locator('.recovery-primary').click();
 await page.locator('.backup-success').waitFor();
 assert.equal(await page.locator('.recovery-words, .word-chip').count(),0,'success clears the words');
 assert.equal(await page.locator('.backup-success p').count(),0,'success shows only the large title and visual');
}
try {
 await page.goto('http://127.0.0.1:9000/#/wallet');
 await page.locator('.backup-shortcut').waitFor({timeout:60000});
 assert.equal(await page.locator('.backup-banner-wrapper').count(),0);
 // Clipboard offer strip: native reads cannot run in the browser, so the strip is offered text directly.
 await page.evaluate(()=>{
  const find=(vnode)=>{ if(!vnode) return null; if(vnode.component){ if(vnode.component.type.name==='ClipboardSuggestion') return vnode.component; return find(vnode.component.subTree); } if(Array.isArray(vnode.children)){ for(const c of vnode.children){ const hit=find(c); if(hit) return hit; } } return null; };
  let owner=document.querySelector('.q-page').__vueParentComponent; while(owner && owner.type.name!=='WalletPage') owner=owner.parent;
  const strip=find(owner.subTree); if(!strip) throw new Error('ClipboardSuggestion missing'); strip.proxy.offer('alice@example.com');
 });
 await page.locator('.clipboard-strip').waitFor();
 assert.equal(await page.locator('.clipboard-strip-value').innerText(),'alice@example.com');
 await shot('00-clipboard-offer-light');
 await page.getByRole('button',{name:'Use',exact:true}).click();
 await page.locator('.clipboard-strip').waitFor({state:'detached'});
 await page.locator('.send-sheet-dialog textarea').waitFor();
 assert.equal(await page.locator('.send-sheet-dialog textarea').inputValue(),'alice@example.com','Use lands the text in the Send field');
 await shot('00-clipboard-offer-send');
 await page.keyboard.press('Escape');
 await page.locator('.send-sheet-dialog').waitFor({state:'detached'});
 await route('/identity');
 assert.equal(await page.locator('.id-card-status').count(),0,'identity card has no backup reminder before backup');
 assert.equal(await page.locator('.id-card-stage').getByRole('button',{name:/backup/i}).count(),0);
 assert.equal(await page.locator('.id-row').filter({hasText:'Identity backup'}).count(),0,'profile has no backup row');
 assert.equal(await page.locator('.ladder-step').filter({hasText:'Back up your card'}).count(),0,'setup ladder has no backup step');
 // The menu door is the permanent way in; the keyring is the reminder.
 await route('/wallet');
 await page.getByRole('button',{name:/^Menu/}).click();
 await page.locator('.menu-door').filter({hasText:/security/i}).waitFor();
 assert.equal(await page.locator('.menu-door').count(),6);
 await shot('00-menu-light');
 await page.locator('.menu-door').filter({hasText:/security/i}).click();
 await expectSecurityPage();
 await route('/wallet');
 await page.locator('.backup-shortcut').click();
 await expectSecurityPage();
 await page.getByRole('button',{name:/^Bitcoin Backup/}).first().waitFor();
 assert.equal(await page.getByRole('button',{name:/^Identity backup/}).count(),1);
 assert.equal(await page.getByRole('button',{name:/^Restore from backup/}).count(),1);
 await shot('01-security-light');
 await choose('Spark');
 assert.equal(await page.locator('.recovery-card .backup-coverage-item').count(),0);
 assert.ok((await page.locator('.recovery-card').boundingBox()).height >= 800, 'preparation is a full phone screen');
 await page.evaluate(()=>document.fonts.ready);
 assert.match(await page.locator('.recovery-intro').evaluate(el=>getComputedStyle(el).fontFamily), /Manrope/);
 assert.equal(await page.evaluate(()=>document.fonts.check('700 23px Manrope')),true);
 await shot('02-wallet-prepare-light');
 await page.locator('.recovery-acknowledgement').click();
 await shot('02-wallet-prepare-accepted-light');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await choose('Spark');
 await writeAndCheck('03-wallet');
 // Failure must retain the check and roll back optimistic store flags.
 await page.evaluate(()=>{window.__originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='buhoGO_wallet_store')throw new Error('Simulated full disk');return window.__originalStorageSet.call(this,k,v);};});
 await page.locator('.recovery-primary').click();
 await page.locator('.recovery-error').waitFor();
 assert.equal(await page.evaluate(()=>window.__audit.app.config.globalProperties.$pinia._s.get('wallet').hasBackedUp),false);
 await page.evaluate(()=>{Storage.prototype.setItem=window.__originalStorageSet;});
 await finish();
 await shot('04-wallet-success-light');
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.locator('.backup-choices').waitFor();
 assert.equal(await page.locator('.backup-choice').filter({hasText:'Spark'}).getByText('Words checked',{exact:true}).count(),1);
 assert.equal(await page.locator('.backup-choice').filter({hasText:'Identity backup'}).getByText('Not checked yet',{exact:true}).count(),1);
 await choose('Arkade');
 await writeAndCheck(); await finish();
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await choose('Identity backup');
 await shot('05-identity-prepare-light');
 await writeAndCheck(); await finish();
 await shot('06-identity-success-light');
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.locator('.backup-choices').waitFor();
 assert.equal(await page.locator('.backup-choice').filter({hasText:'Identity backup'}).getByText('Words checked',{exact:true}).count(),1);
 // Every set checked: the reminder leaves the home screen entirely.
 await route('/wallet');
 assert.equal(await page.locator('.backup-shortcut').count(),0,'keyring hides once every backup is checked');
 // Settings carries no backup rows any more; Screen Privacy sits in Preferences.
 await route('/settings');
 assert.equal(await page.locator('.settings-attention-strip').count(),0);
 assert.equal(await page.getByRole('button',{name:/^Backups/}).count(),0);
 assert.equal(await page.getByText('Screen Privacy',{exact:true}).count(),1);
 await shot('02-settings-light');
 // The hub bar has a fourth tab for Security, and it is the active one on the page.
 assert.equal(await page.getByRole('tab').count(),4);
 await page.getByRole('tab',{name:'Security',exact:true}).click();
 await expectSecurityPage();
 assert.equal(await page.locator('.hub-nav-tab-active').getAttribute('aria-label'),'Security');
 assert.equal(await page.locator('.hub-nav-tab-active .backup-keyring-glyph').count(),1,'security tab wears the keyring');
 // Exercise optional Android presentation with a mocked transport; no Google writes.
 await route('/security');
 assert.equal(await page.getByRole('button',{name:/^Google Drive backup/}).count(),0,'Drive is not advertised on web');
 await page.evaluate(()=>{
  const cloud=window.__audit.app.config.globalProperties.$pinia._s.get('cloudBackup');
  cloud.checkAvailability=async()=>true;
  cloud.refresh=async()=>{cloud.signedIn=true;cloud.signedInEmail='test@example.invalid';};
  cloud.backup=async()=>{throw new Error('Simulated offline transport');};
  let owner=document.querySelector('.q-page').__vueParentComponent;
  while(owner && !Object.hasOwn(owner.data,'showCloudBackup')) owner=owner.parent;
  if(!owner) throw new Error('Security page missing');
  owner.proxy.showCloudBackup=true;
 });
 await page.locator('.cb-menu-row').filter({hasText:'Back up now'}).click();
 await page.locator('.cb-contents').waitFor();
 assert.equal(await page.locator('.cb-contents > div').count(),2);
 await page.locator('.cb-primary').click();
 await page.getByText('Google Drive backup did not finish. Check your connection and try again.',{exact:true}).waitFor();
 await shot('13-google-optional-retry');
 const beforeCloud=await page.evaluate(()=>window.__audit.app.config.globalProperties.$pinia._s.get('identity').backupConfirmed);
 await page.evaluate(()=>{window.__audit.app.config.globalProperties.$pinia._s.get('cloudBackup').backup=async()=>{};});
 await page.locator('.cb-primary').click();
 await page.getByRole('heading',{name:'Backup uploaded',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.__audit.app.config.globalProperties.$pinia._s.get('identity').backupConfirmed),beforeCloud);
 await page.locator('.cb-primary').click();
 await route('/identity');
 assert.equal(await page.locator('.id-row').filter({hasText:'Identity backup'}).count(),0);
 await page.evaluate(()=>{window.__clipboard='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__clipboard=value;}}});});
 await page.getByRole('button',{name:/^Copy public key/}).click();
 assert.equal(await page.evaluate(()=>window.__clipboard),await page.evaluate(()=>window.__audit.app.config.globalProperties.$pinia._s.get('identity').nostrNpub));
 assert.equal(await page.locator('.id-row').filter({hasText:/^Keys/}).count(),0);
 await shot('10-profile-public-key');
 await route('/identity/identities');
 await page.getByRole('button',{name:'Private key',exact:true}).click();
 await page.locator('.private-key-sheet').waitFor();
 assert.equal(await page.locator('.private-key-sheet').innerText().then(t=>t.includes('nsec1')),false);
 await shot('11-private-key');
 await page.getByRole('button',{name:'Copy private key',exact:true}).click();
 await page.getByText('Private key copied',{exact:true}).waitFor();
 assert.match(await page.evaluate(()=>window.__clipboard),/^nsec1/);
 assert.equal(await page.locator('.private-key-sheet').innerText().then(t=>t.includes('nsec1')),false);
 const activeSecret=await page.evaluate(()=>window.__clipboard);
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.getByRole('button',{name:'Private key for Identity 2',exact:true}).click();
 await page.getByRole('button',{name:'Copy private key',exact:true}).click();
 await page.getByText('Private key copied',{exact:true}).waitFor();
 assert.notEqual(await page.evaluate(()=>window.__clipboard),activeSecret);
 assert.equal(await page.evaluate(()=>window.__audit.app.config.globalProperties.$pinia._s.get('identity').nostrAccountIndex),0);
 await page.getByRole('button',{name:'Done',exact:true}).click();
 assert.equal(await page.locator('.words-group').count(),0);
 // The optional photo picker must replace, then return to, identity setup.
 await page.evaluate(()=>{
  let owner=document.querySelector('.q-page').__vueParentComponent;
  while(owner && !Object.hasOwn(owner.data,'showProfileSetup')) owner=owner.parent;
  owner.proxy.showProfileSetup=true;
 });
 await page.locator('.profile-setup-sheet .setup-avatar').click();
 await page.locator('.picker-sheet').waitFor();
 assert.equal(await page.locator('.profile-setup-sheet').count(),0);
 await page.locator('.picker-sheet').getByText('Cancel',{exact:true}).click();
 await page.locator('.profile-setup-sheet').waitFor();
 assert.equal(await page.locator('.picker-sheet').count(),0);
 await page.locator('.profile-setup-sheet').getByRole('button',{name:'Close',exact:true}).click();

 await route('/identity/words');
 await expectSecurityPage();
 await shot('07-security-all-checked');
 await page.locator('.backup-choice').filter({hasText:'Identity backup'}).click();
 await page.locator('.recovery-acknowledgement').click();
 await page.locator('.recovery-primary').click();
 await page.locator('.recovery-words').waitFor();
 assert.equal(await page.locator('.word-chip').count(),0,'view mode has no verification');
 // Simulate backgrounding; secrets and check grid must disappear.
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.locator('.recovery-body--prepare').waitFor();
 assert.equal(await page.locator('.recovery-words').count(),0);
 assert.equal(await page.getByRole('switch').isChecked(),false);
 await page.evaluate(()=>{delete document.hidden;});
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await route('/identity/advanced');
 assert.equal(await page.getByRole('button',{name:'Show secret key',exact:true}).count(),0);
 assert.equal(await page.locator('.secret-value').count(),0);
 // Identity restore: choose a subject, enter words, then explicit replacement confirmation.
 await route('/security');
 await page.getByRole('button',{name:/^Restore from backup/}).click();
 await page.locator('.restore-sheet').waitFor();
 await shot('07-restore-choice');
 await page.locator('.restore-sheet .id-row').filter({hasText:/^Identity/}).click();
 await page.locator('.restore-dialog').waitFor();
 await page.getByRole('combobox',{name:'Word 1',exact:true}).fill('abandon');
 assert.equal(await page.getByText('Replace your current profile?',{exact:true}).count(),0);
 const testWords=Array(11).fill('abandon').concat('about');
 for(let i=0;i<12;i++) await page.getByRole('combobox',{name:`Word ${i+1}`,exact:true}).fill(testWords[i]);
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByText('Replace your current profile?',{exact:true}).waitFor();
 await shot('07-restore-confirmation');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 // Legacy update recovery links must land on Security as well.
 await route('/settings?section=backup');
 await expectSecurityPage();
 // The same flow supports a 24-word phrase with repeated words.
 await route('/wallet');
 await page.evaluate(()=>{
   const wallet=window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
   window.__getMnemonic=wallet.getMnemonicForWallet;
   wallet.getMnemonicForWallet=async()=>Array(23).fill('abandon').concat('art').join(' ');
   for(const w of wallet.wallets.filter(w=>w.type==='spark')) w.metadata.hasBackedUp=false;
   wallet.hasBackedUp=false;
 });
 await page.locator('.backup-shortcut').click(); await choose('Spark');
 await page.locator('.recovery-acknowledgement').click(); await page.locator('.recovery-primary').click();
 await page.locator('.recovery-words').waitFor();
 assert.equal(await page.locator('.recovery-words li').count(),24);
 await page.locator('.recovery-primary').click();
 await page.locator('.word-chip').first().waitFor();
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.locator('.recovery-body--prepare').waitFor();
 assert.equal(await page.locator('.word-chip').count(),0,'backgrounding removes verification words');
 await page.evaluate(()=>{delete document.hidden;});
 await page.locator('.recovery-acknowledgement').click(); await page.locator('.recovery-primary').click();
 await page.locator('.recovery-words').waitFor();
 await page.locator('.recovery-primary').click();
 for(let i=0;i<23;i++) await page.locator('.word-chip:not([disabled])').filter({hasText:/^abandon$/}).first().click();
 await page.locator('.word-chip:not([disabled])').filter({hasText:/^art$/}).click();
 await finish(); await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.locator('.backup-choices').waitFor();
 await page.evaluate(()=>{window.__audit.app.config.globalProperties.$pinia._s.get('wallet').getMnemonicForWallet=window.__getMnemonic;});
 // Narrow, translated screens, including the exact German reference copy.
 for(const locale of ['en-US','de','es']) {
  await route('/wallet');
  await page.evaluate(l=>{document.querySelector('.q-page').__vueParentComponent.proxy.$i18n.locale=l;window.__audit.setDark(true);},locale);
  await page.setViewportSize({width:320,height:700});
  await page.evaluate(()=>{const wallet=window.__audit.app.config.globalProperties.$pinia._s.get('wallet');for(const w of wallet.wallets.filter(w=>w.type==='spark'))w.metadata.hasBackedUp=false;wallet.hasBackedUp=false;});
  await page.locator('.backup-shortcut').click();
  await expectSecurityPage(); await shot('08-security-'+locale+'-320');
  await choose('Spark'); await shot('09-prepare-'+locale+'-320');
  if (locale === 'de') await page.getByText('Lass uns deine Wiederherstellungsphrase sichern.',{exact:true}).waitFor();
  assert.equal(await page.locator('.recovery-body').evaluate(el=>el.scrollWidth>el.clientWidth),false);
  await page.locator('.recovery-acknowledgement').click();
  await page.locator('.recovery-primary').click();
  await page.locator('.recovery-words').waitFor(); await shot('10-words-'+locale+'-320');
  assert.equal(await page.locator('.recovery-body').evaluate(el=>el.scrollWidth>el.clientWidth),false);
  await page.locator('.recovery-primary').click();
  await page.locator('.word-chip').first().waitFor(); await shot('11-check-'+locale+'-320');
  for(let i=0;i<11;i++) await page.locator('.word-chip:not([disabled])').filter({hasText:/^abandon$/}).first().click();
  await page.locator('.word-chip:not([disabled])').filter({hasText:/^about$/}).click();
  await finish(); await shot('12-success-'+locale+'-320');
  await page.locator('.backup-success .recovery-primary').click();
  await page.locator('.backup-choices').waitFor();
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,errors,screenshots:out}));
} catch(error){await shot('FAILURE');console.error('Page errors:',errors);throw error;}finally{await browser.close();}
