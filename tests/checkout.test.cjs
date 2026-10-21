const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../portone-gas/Code.gs'),'utf8');
class Sheet {
  constructor(name, data=[]){this.name=name;this.data=data;this.hidden=false;}
  getLastRow(){return this.data.length;}
  getMaxRows(){return 1000;}
  insertRowsAfter(){}
  appendRow(v){this.data.push([...v]);return this;}
  deleteRow(r){this.data.splice(r-1,1);}
  setFrozenRows(){return this;}
  hideSheet(){this.hidden=true;return this;}
  getRange(r,c,h=1,w=1){const sh=this;return {
    getValues(){return Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>sh.data[r+i-1]?.[c+j-1]??''));},
    getDisplayValues(){return this.getValues().map(v=>v.map(String));},
    getValue(){return this.getValues()[0][0];},getDisplayValue(){return String(this.getValue());},
    setValues(v){v.forEach((row,i)=>{sh.data[r+i-1]??=[];row.forEach((x,j)=>{sh.data[r+i-1][c+j-1]=x;});});return this;},
    setValue(v){return this.setValues([[v]]);},setNumberFormat(v){sh.format=v;return this;},
    createTextFinder(text){return {matchEntireCell(){return this;},findNext(){for(let i=0;i<h;i++){if(String(sh.data[r+i-1]?.[c-1]??'')===String(text))return {getRow:()=>r+i};}return null;}};}
  };}
}
function env(){
  const main=new Sheet('주문관리',[[],[],[],Array(16).fill('').concat(['결제방식','포트원 결제 ID'])]);
  const queue=new Sheet('_카드결제대기',[['준비일시','결제 ID','주문번호','주문정보','상태','확인일시']]);
  const sheets=new Map([[main.name,main],[queue.name,queue]]),cache=new Map();
  const ss={getSheetByName:n=>sheets.get(n),insertSheet:n=>{const s=new Sheet(n);sheets.set(n,s);return s;},setSpreadsheetTimeZone:z=>{ss.zone=z;}};
  const fixtures=new Map(),calls=[];
  const ctx=vm.createContext({console,Date,JSON,Number,String,Boolean,Array,Math,Error,
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>({PORTONE_API_SECRET:'test-only-placeholder',ORDER_SPREADSHEET_ID:'test-sheet',ORDER_SHEET_NAME:'주문관리'})[k]})},
    SpreadsheetApp:{openById:()=>ss,flush(){}},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    CacheService:{getScriptCache:()=>({put:(k,v)=>cache.set(k,v),get:k=>cache.get(k)||null})},
    ScriptApp:{getProjectTriggers:()=>[],newTrigger:()=>({timeBased(){return this;},everyMinutes(){return this;},create(){}})},
    UrlFetchApp:{fetch:(url,options)=>{assert.equal(options.method,'get');calls.push(url);const id=decodeURIComponent(url.split('/payments/')[1].split('?')[0]);const f=fixtures.get(id)||{code:404};return {getResponseCode:()=>f.code||200,getContentText:()=>JSON.stringify(f.payment)};}}
  });vm.runInContext(code,ctx);
  return {ctx,main,queue,fixtures,calls,cache,ss};
}
const id='mdy-11111111-1111-4111-8111-111111111111';
function order(pid=id){return {paymentId:pid,orderNo:'MDY-20261021-1234abcd',items:[{name:'두피샴푸 건성',volume:'300ml',qty:1}],amount:35000,buyer:{name:'테스트',phone:'01000000000',postcode:'12345',address:'검증 전용 주소'}};}
function paid(pid=id){return {id:pid,storeId:'store-33be0510-ab4b-4791-8b5f-ebce201873cc',status:'PAID',currency:'KRW',amount:{total:35000},method:{type:'PaymentMethodCard'},requestedAt:'2026-10-21T00:15:00Z'};}
test('card preparation is durable and never creates an unpaid main order',()=>{const e=env();e.ctx.createPending_(order());assert.equal(e.main.getLastRow(),4);assert.equal(e.queue.getLastRow(),2);assert.equal(e.ctx.getOrderStatus_(id).status,'결제대기');e.ctx.createPending_(order());assert.equal(e.queue.getLastRow(),2);});
test('order amount validation and duplicate payment identity cannot be overwritten',()=>{const e=env();assert.throws(()=>e.ctx.createPending_({...order(),amount:1}));e.ctx.createPending_(order());const changed=order();changed.buyer.name='변경';assert.throws(()=>e.ctx.createPending_(changed));assert.equal(e.queue.getLastRow(),2);});
test('verified PAID appends one completed order across duplicate webhook/redirect',()=>{const e=env();e.ctx.createPending_(order());e.fixtures.set(id,{payment:paid()});assert.equal(e.ctx.verifyAndSave_(id).status,'PAID');e.ctx.verifyAndSave_(id);assert.equal(e.main.getLastRow(),5);assert.equal(e.main.data[4][11],'입금완료');assert.equal(e.main.data[4][16],'카드결제');assert.equal(e.main.data[4][17],id);assert.equal(e.main.format,'yyyy-mm-dd hh:mm');});
test('wrong store, currency, amount and method are never recorded',()=>{for(const change of [{storeId:'other'},{currency:'USD'},{amount:{total:1}},{method:{type:'PaymentMethodTransfer'}},{method:undefined,paymentMethod:{type:'CARD'}}]){const e=env();e.ctx.createPending_(order());e.fixtures.set(id,{payment:{...paid(),...change}});assert.throws(()=>e.ctx.verifyAndSave_(id));assert.equal(e.main.getLastRow(),4);}});
test('failed and uncreated payments do not create a main row; lookup errors preserve context',()=>{const e=env();e.ctx.createPending_(order());e.fixtures.set(id,{payment:{status:'FAILED'}});assert.equal(e.ctx.verifyAndSave_(id).status,'FAILED');e.fixtures.set(id,{code:500});assert.throws(()=>e.ctx.verifyAndSave_(id));assert.equal(e.main.getLastRow(),4);assert.equal(e.queue.getLastRow(),2);});
test('legacy unpaid rows migrate only after API check and remain recoverable',()=>{const e=env();e.main.appendRow([new Date(),order().orderNo,'','','두피샴푸 건성',1,35000,'테스트','01000000000','테스트 주소','','미입금','미신청','배송전','','포트원 카드결제','카드결제',id]);e.fixtures.set(id,{code:500});assert.equal(e.ctx.migrateLegacyPending_(),0);assert.equal(e.main.getLastRow(),5);e.fixtures.set(id,{payment:{status:'READY'}});assert.equal(e.ctx.migrateLegacyPending_(),1);assert.equal(e.main.getLastRow(),4);assert.equal(e.queue.getLastRow(),2);e.fixtures.set(id,{payment:paid()});e.ctx.verifyAndSave_(id);assert.equal(e.main.data[4][11],'입금완료');});
test('delayed PAID is recovered by reconciliation; unresolved and bank orders remain',()=>{const e=env();e.ctx.createPending_(order());e.queue.data[1][0]=new Date(Date.now()-3600000);e.main.appendRow([new Date(),'BANK-1','','','샴푸',1,35000,'테스트','','','','미입금']);e.fixtures.set(id,{payment:paid()});e.ctx.reconcileCardOrders();assert.equal(e.main.getLastRow(),6);assert.equal(e.main.data[4][11],'미입금');assert.equal(e.main.data[5][11],'입금완료');});
test('setup uses Korea timezone and minute display without replacing history',()=>{const e=env();e.main.appendRow([12345]);e.ctx.setupCheckout();assert.equal(e.ss.zone,'Asia/Seoul');assert.equal(e.main.data[4][0],12345);assert.equal(e.main.format,'yyyy-mm-dd hh:mm');});
test('inline JavaScript compiles',()=>{const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);});
