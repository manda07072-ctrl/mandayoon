// Safe timing only: dummy pending orders, no SDK, approval, charge or main-sheet writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const baseline='https://script.google.com/macros/s/AKfycbwjuo24uk_N87K3IMwDTDHzxTBt5XmT_8IQTWJmPpmeUA7YiKc8Q0Mm2UJ-Ce8mrbgw/exec';
const fast='https://mandayoon-checkout-api.dilec.chatgpt.site';
const mode=process.argv[2];
async function run(){
 const stats=[];
 const vars=mode==='after'?fs.readFileSync(path.join(__dirname,'../../mandayoon-checkout-api/.dev.vars'),'utf8'):'';
 const secret=vars.match(/^BRIDGE_SECRET=(.+)$/m)?.[1];
 for(let i=0;i<5;i++){
  const id='mdy-'+crypto.randomUUID();
  const payload={action:'createPending',paymentId:id,orderNo:'MDY-20261021-'+crypto.randomUUID().slice(0,8),checkoutToken:crypto.randomUUID()+crypto.randomUUID(),items:[{name:'두피샴푸 건성',volume:'300ml',qty:1}],amount:35000,buyer:{name:'속도측정 전용',phone:'01000000000',postcode:'12345',address:'속도 측정용 가상 주소'}};
  const start=performance.now();
  const response=await fetch(mode==='before'?baseline:fast+'/prepare',{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8',...(mode==='after'?{Authorization:'Bearer '+secret,'X-Checkout-Benchmark':'1'}:{})},body:JSON.stringify(payload)});
  const first=await response.json(),prepared=performance.now();
  const ack=mode==='before'?await(await fetch(baseline+'?action=status&paymentId='+id)).json():first;
  if(!first.ok||!ack.ok||ack.status!=='결제대기')throw Error(JSON.stringify({first,ack}));
  const result={paymentId:id,prepareMs:Math.round(prepared-start),ackMs:Math.round(performance.now()-prepared),totalMs:Math.round(performance.now()-start)};
  stats.push(result);console.log(JSON.stringify(result));
 }
 const sorted=stats.map(x=>x.totalMs).sort((a,b)=>a-b);
 const summary={mode,count:stats.length,medianMs:sorted[2],meanMs:Math.round(sorted.reduce((a,b)=>a+b,0)/5),minMs:sorted[0],maxMs:sorted[4],samples:stats};
 fs.writeFileSync(path.join(__dirname,'checkout-timing-'+mode+'.json'),JSON.stringify(summary,null,2)+'\n');
 if(mode==='after')await fetch(fast+'/internal/benchmark-cleanup',{method:'POST',headers:{Authorization:'Bearer '+secret}});
 console.log(JSON.stringify({mode,medianMs:summary.medianMs,meanMs:summary.meanMs,minMs:summary.minMs,maxMs:summary.maxMs}));
}run().catch(e=>{console.error(e.message);process.exitCode=1;});
