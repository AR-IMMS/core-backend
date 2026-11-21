// Runs in a disposable ordinary-network container. Input is supplied on stdin, never logged.
const net=require('node:net'),https=require('node:https');
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',async()=>{
 try{const {technicianToken,targets}=JSON.parse(input);let failed=false;
 const response=await fetch('http://host.docker.internal:8082/health/live',{signal:AbortSignal.timeout(5000)});console.log(JSON.stringify({check:'ordinary-client-Core-API',status:response.status}));if(response.status!==200)failed=true;
 for(const {host,port,label} of targets){const connected=await new Promise(resolve=>{const s=net.connect({host,port});s.setTimeout(1500);s.once('connect',()=>{s.destroy();resolve(true)});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false)});});console.log(JSON.stringify({check:label,result:connected?'BYPASS':'BLOCKED'}));if(connected)failed=true;}
 for(const path of ['/','/api/v1/tickets/10','/graphql','/api/v1/graphql','/ws']){try{const r=await fetch('http://host.docker.internal:8081'+path,{headers:{Authorization:'Token token='+technicianToken},signal:AbortSignal.timeout(1500)});console.log(JSON.stringify({check:'former-port',path,status:r.status,result:'BYPASS'}));failed=true;}catch{console.log(JSON.stringify({check:'former-port',path,result:'BLOCKED'}));}}
 for(const body of [{owner_id:5},{arimms_business_owner:5}]){
 const result=await new Promise(resolve=>{const req=https.request({hostname:'host.docker.internal',port:8444,path:'/api/v1/tickets/10',method:'PUT',rejectUnauthorized:false,headers:{Authorization:'Token token='+technicianToken,'Content-Type':'application/json'},timeout:2000},res=>{res.resume();resolve(res.statusCode)});req.once('error',()=>resolve('TLS_OR_CONNECTION_DENIED'));req.once('timeout',()=>{req.destroy();resolve('TIMEOUT')});req.end(JSON.stringify(body));});
 const blocked=typeof result!=='number'||[400,401,403,496].includes(result);console.log(JSON.stringify({check:'no-maintenance-client-certificate',mutation:Object.keys(body)[0],result,blocked}));if(!blocked)failed=true;
 }
 process.exitCode=failed?1:0;
 }catch{console.error('Network probe failed (redacted)');process.exitCode=1;}
});
