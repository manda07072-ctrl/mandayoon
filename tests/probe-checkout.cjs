// Read-only payment lookup for a never-created UUID. Diagnostic orders cannot sync.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const origin='https://mandayoon-checkout-api.dilec.chatgpt.site';
async function run(){
 const vars=fs.readFileSync(path.join(__dirname,'../../mandayoon-checkout-api/.dev.vars'),'utf8');
 const secret=vars.match(/^BRIDGE_SECRET=(.+)$/m)[1],headers={'Content-Type':'text/plain;charset=utf-8',Origin:'https://manda07072-ctrl.github.io'};
 const payload={paymentId:'mdy-'+crypto.randomUUID(),checkoutToken:crypto.randomUUID()+crypto.randomUUID(),items:[{name:'두피샴푸 건성',volume:'300ml',qty:1}],amount:35000,buyer:{name:'연결 검증 전용',phone:'01000000000',postcode:'12345',address:'실제 주문이 아닌 연결 검증용 주소'}};
 try {
  const prepared=await(await fetch(origin+'/prepare',{method:'POST',headers:{...headers,Authorization:'Bearer '+secret,'X-Checkout-Benchmark':'verification'},body:JSON.stringify(payload)})).json();
  if(!prepared.ok)throw Error('준비 실패');
  const start=performance.now();
  const confirmed=await(await fetch(origin+'/confirm',{method:'POST',headers,body:JSON.stringify({paymentId:payload.paymentId,checkoutToken:payload.checkoutToken})})).json();
  const result={prepared:true,verification:confirmed.status,verified:confirmed.status==='NOT_FOUND',verificationMs:Math.round(performance.now()-start),charged:false,mainSheetWritten:false};
  fs.writeFileSync(path.join(__dirname,'checkout-probe.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  if(!result.verified)throw Error('새 서버 → 기존 서버 → 포트원 조회 경로 검증 실패');
 } finally {await fetch(origin+'/internal/benchmark-cleanup',{method:'POST',headers:{Authorization:'Bearer '+secret}});}
}run().catch(e=>{console.error(e.message);process.exitCode=1;});
