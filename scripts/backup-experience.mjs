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
const out=new URL('../output/backup-identity-experience', import.meta.url).pathname;
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
async function writeAndCheck(){
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('heading',{name:'Write down each word',exact:true}).waitFor();
 assert.equal(await page.locator('.recovery-words').getByText('abandon',{exact:true}).count(),0,'concealed words absent from DOM');
 await page.getByRole('button',{name:'Show words',exact:true}).click();
 assert.equal(await page.locator('.recovery-words li').count(),12);
 await page.getByRole('button',{name:'Check my backup',exact:true}).click();
 await page.locator('.word-chip:not([disabled])').filter({hasText:/^about$/}).click();
 await page.getByText('Check word 1 on your paper and try again.',{exact:true}).waitFor();
 for(let i=0;i<11;i++)await page.locator('.word-chip:not([disabled])').filter({hasText:/^abandon$/}).first().click();
 await page.locator('.word-chip:not([disabled])').filter({hasText:/^about$/}).click();
}
try {
 await page.goto('http://127.0.0.1:9000/#/wallet');
 await page.locator('.backup-shortcut').waitFor({timeout:60000});
 assert.equal(await page.locator('.backup-banner-wrapper').count(),0);
 await page.locator('.backup-shortcut').click();await page.getByRole('button',{name:/^Bitcoin backup/}).first().waitFor();
 assert.equal(await page.getByRole('button',{name:/^Identity backup/}).count(),1);
 await shot('01-backups-light');
 await page.locator('.backup-choices .backup-choice').filter({hasText:'Spark'}).click();
 await page.getByRole('heading',{name:'Keep a way back'}).waitFor();
 assert.equal(await page.locator('.recovery-card .backup-coverage-item').count(),2);
 await shot('02-wallet-prepare-light');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.locator('.recovery-card').waitFor({state:'hidden'});
 assert.equal(await page.locator('.backup-shortcut-label').count(),1);
 await page.locator('.backup-shortcut').click();await page.locator('.backup-choices .backup-choice').filter({hasText:'Spark'}).click();
 await writeAndCheck();
 // Failure must retain the check and roll back optimistic store flags.
 await page.evaluate(()=>{window.__originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='buhoGO_wallet_store')throw new Error('Simulated full disk');return window.__originalStorageSet.call(this,k,v);};});
 await page.getByRole('button',{name:'Confirm backup',exact:true}).click();
 await page.locator('.recovery-error').waitFor();
 assert.equal(await page.evaluate(()=>window.__audit.app.config.globalProperties.$pinia._s.get('wallet').hasBackedUp),false);
 await page.evaluate(()=>{Storage.prototype.setItem=window.__originalStorageSet;});
 await page.getByRole('button',{name:'Confirm backup',exact:true}).click();
 await page.getByRole('heading',{name:'Backup checked'}).waitFor();
 assert.equal(await page.locator('.recovery-words').count(),0);
 await shot('03-wallet-checked-light');
 await page.getByRole('button',{name:'Back up bitcoin',exact:true}).click();
 await writeAndCheck();await page.getByRole('button',{name:'Confirm backup',exact:true}).click();
 await page.getByRole('heading',{name:'Backup checked'}).waitFor();
 await page.getByRole('button',{name:'Back up identity',exact:true}).click();
 assert.ok((await page.locator('.recovery-subject').innerText()).includes('Identity backup'));
 await shot('04-identity-prepare-light');
 await writeAndCheck();await page.getByRole('button',{name:'Confirm backup',exact:true}).click();
 await page.getByRole('heading',{name:'Backup checked'}).waitFor();
 await shot('05-all-checked-light');
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.locator('.recovery-card').waitFor({state:'hidden'});
 assert.equal(await page.locator('.backup-shortcut-label').count(),0);
 // Settings has one backup destination and no attention banner.
 await route('/settings');
 assert.equal(await page.locator('.settings-attention-strip').count(),0);
 await page.getByRole('button',{name:/^Backups/}).click();
 await page.locator('.backup-choices').waitFor();
 await page.getByRole('button',{name:'Close',exact:true}).click();
 // Exercise optional Android presentation with a mocked transport; no Google writes.
 assert.equal(await page.getByRole('button',{name:/^Google Drive backup/}).count(),0,'Drive is not advertised on web');
 await page.evaluate(()=>{
  const cloud=window.__audit.app.config.globalProperties.$pinia._s.get('cloudBackup');
  cloud.checkAvailability=async()=>true;
  cloud.refresh=async()=>{cloud.signedIn=true;cloud.signedInEmail='test@example.invalid';};
  cloud.backup=async()=>{throw new Error('Simulated offline transport');};
  let owner=document.querySelector('.q-page').__vueParentComponent;
  while(owner && !Object.hasOwn(owner.data,'showCloudBackupSheet')) owner=owner.parent;
  if(!owner) throw new Error('Settings component missing');
  owner.proxy.showCloudBackupSheet=true;
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
 assert.equal(await page.locator('.id-row').filter({hasText:'Identity backup'}).count(),1);
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
 await page.getByRole('heading',{name:'Identity backup',exact:true}).waitFor();await shot('06-identity-backup-page');
 await page.getByRole('tab',{name:/^Bitcoin/}).click();
 await page.getByRole('heading',{name:'Bitcoin backup',exact:true}).waitFor();
 await shot('12-wallet-backup-page');
 await page.getByRole('tab',{name:/^Bitcoin/}).press('ArrowRight');
 assert.equal(await page.getByRole('tab',{name:/^Identity/}).getAttribute('aria-selected'),'true');
 await page.getByRole('button',{name:'View recovery words',exact:true}).click();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('button',{name:'Show words',exact:true}).click();
 // Simulate backgrounding; secrets and check grid must disappear.
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByRole('heading',{name:'View recovery words',exact:true}).waitFor();
 assert.equal(await page.locator('.recovery-words').count(),0);
 await page.evaluate(()=>{delete document.hidden;});
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await route('/identity/advanced');
 assert.equal(await page.getByRole('button',{name:'Show secret key',exact:true}).count(),0);
 assert.equal(await page.locator('.secret-value').count(),0);
 // Identity restore: choose a subject, enter words, then explicit replacement confirmation.
 await route('/identity/words');
 await page.getByRole('button',{name:'Restore from recovery words',exact:true}).click();
 await page.locator('.choice-sheet .id-row').filter({hasText:/^Identity/}).click();
 await page.locator('.restore-dialog').waitFor();
 await page.getByRole('combobox',{name:'Word 1',exact:true}).fill('abandon');
 assert.equal(await page.getByText('Replace your current profile?',{exact:true}).count(),0);
 const testWords=Array(11).fill('abandon').concat('about');
 for(let i=0;i<12;i++) await page.getByRole('combobox',{name:`Word ${i+1}`,exact:true}).fill(testWords[i]);
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByText('Replace your current profile?',{exact:true}).waitFor();
 await shot('07-restore-confirmation');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 // Narrow, translated layouts and large text with no horizontal overflow.
 for(const locale of ['en-US','de','es']){
  await route('/wallet');
  await page.evaluate(l=>{document.querySelector('.q-page').__vueParentComponent.proxy.$i18n.locale=l;window.__audit.setDark(true);},locale);
  await page.setViewportSize({width:320,height:700});
  await page.locator('.backup-shortcut').click();await page.locator('.backup-choices').waitFor();await shot('08-backups-'+locale+'-320');
  await page.locator('.backup-choices .backup-choice').filter({hasText:'Spark'}).click();await page.locator('.recovery-card').waitFor();await shot('09-prepare-'+locale+'-320');
  const overflow=await page.locator('.recovery-body').evaluate(el=>el.scrollWidth>el.clientWidth);assert.equal(overflow,false);
  await page.locator('.recovery-header .recovery-nav').click();
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,errors,screenshots:out}));
} catch(error){await shot('FAILURE');console.error('Page errors:',errors);throw error;}finally{await browser.close();}
