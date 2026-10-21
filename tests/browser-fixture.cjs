// Local-only UI fixture: all Google/PortOne calls are intercepted before they leave the browser.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const prelude=`<script>
window.mockCalls=[];
const scenario=new URLSearchParams(location.search).get('scenario')||'paid';
function track(kind){mockCalls.push(kind);document.getElementById('mockCalls')?.replaceChildren(document.createTextNode(mockCalls.join(' → ')));}
window.fetch=async(url,options)=>{
 if(String(url).includes('mandayoon-checkout-api.dilec.chatgpt.site')){
  const action=new URL(url).pathname.slice(1);track(action);window.lastMockPayload=JSON.parse(options.body);
  await new Promise(resolve=>setTimeout(resolve,scenario==='slow'?6000:50));
  const result=action==='prepare'?{ok:scenario!=='prepare-error',status:scenario==='prepare-error'?'NOT_FOUND':'결제대기'}:scenario==='unknown'?{ok:false,status:'PENDING',message:'승인 확인 중입니다.'}:scenario==='failed'?{ok:false,status:'FAILED',message:'결제가 완료되지 않았습니다.'}:{ok:true,status:'PAID',orderNo:'UI-TEST-ONLY'};
  return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
 }
 if(String(url).includes('script.google.com')){track('POST');window.lastMockPayload=JSON.parse(options.body);return new Response('');}throw new Error('Unexpected network request');};
const append=document.head.appendChild.bind(document.head);
document.head.appendChild=function(node){if(node.tagName==='SCRIPT'&&node.src.includes('script.google.com')){
 const q=new URL(node.src).searchParams,a=q.get('action'),cb=q.get('callback');track(a);
 setTimeout(()=>window[cb]?.(a==='status'?{ok:scenario!=='prepare-error',status:scenario==='prepare-error'?'NOT_FOUND':'결제대기'}:scenario==='unknown'?{ok:false,status:'PENDING',message:'승인 확인 중입니다.'}:scenario==='failed'?{ok:false,status:'FAILED',message:'결제가 완료되지 않았습니다.'}:{ok:true,status:'PAID',orderNo:'UI-TEST-ONLY'}),scenario==='slow'?6000:50);return node;
 }return append(node);};
window.PortOne={requestPayment:async()=>{track('SDK');return {code:scenario==='failed'?'USER_CANCEL':undefined};}};
window.daum={Postcode:class{constructor(o){this.o=o;}embed(){this.o.oncomplete({zonecode:'12345',roadAddress:'검증용 주소',address:'검증용 주소',userSelectedType:'R',bname:'',buildingName:'',apartment:'N'});}}};
</script>`;
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/mobile'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html lang="ko"><title>모바일 주문 UI 검증</title><body style="margin:24px;background:#ddd"><iframe title="모바일 미리보기" src="/?scenario=paid#order" style="width:390px;height:844px;border:0;background:white"></iframe></body></html>');return;}
 if(url.pathname.startsWith('/images/')){const f=path.join(root,url.pathname);if(fs.existsSync(f)){res.end(fs.readFileSync(f));return;}}
 if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
 let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 html=html.replace(/<script src="https:\/\/(?:cdn\.portone\.io|t1\.daumcdn\.net)[^"]*"><\/script>/g,'');
 html=html.replace('<head>','<head>'+prelude).replace('<body>','<body><div style="position:fixed;left:0;top:0;background:#fff;z-index:9999;padding:4px;font:12px sans-serif" id="mockCalls" aria-label="검증 호출 순서">LOCAL TEST · no real payments</div>');
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);
}).listen(8765,'127.0.0.1',()=>console.log('Local fixture http://127.0.0.1:8765/?scenario=paid#order'));
