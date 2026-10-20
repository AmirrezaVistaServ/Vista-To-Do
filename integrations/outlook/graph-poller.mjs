// Exchange Online adapter. Run one pass from an OSS-controlled scheduler.
import {pathToFileURL} from 'node:url';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function fetchRetry(url,options,fetcher=fetch){
 for(let attempt=0;attempt<4;attempt++){
  const r=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});
  if((r.status===429||r.status>=500)&&attempt<3){const value=r.headers.get('retry-after');const seconds=value?Number(value):NaN;const wait=Number.isFinite(seconds)?seconds*1000:1000*2**attempt;if(wait>60000)throw Error('Server requested a longer backoff; retry on a later scheduled run.');await delay(Math.max(wait,1000));continue;}
  return r;
 }
}
export function dueToISO(value){
 if(!value)return '';
 let date=value.dateTime;if(typeof date!=='string')throw Error('Invalid Outlook deadline');
 date=date.replace(/(\.\d{3})\d+/, '$1');
 if(!/(Z|[+-]\d{2}:\d{2})$/.test(date)){
  if(['UTC','Etc/UTC'].includes(value.timeZone))date+='Z';
  else if(['Iran Standard Time','Asia/Tehran'].includes(value.timeZone)&&Number(date.slice(0,4))>=2023)date+='+03:30';
  else throw Error('Unsupported deadline timezone; normalize to UTC in the Exchange adapter.');
 }
 if(!Number.isFinite(Date.parse(date)))throw Error('Invalid Outlook deadline');
 return new Date(date).toISOString();
}
export function toPayload(mailbox,m){return {mailbox,messageId:m.id,flagStatus:m.flag?.flagStatus,subject:(m.subject||'').slice(0,1000),bodyText:(m.body?.contentType?.toLowerCase()==='text'?m.body.content:m.bodyPreview||'').slice(0,12000),sender:(m.from?.emailAddress?.address||'').slice(0,500),due:dueToISO(m.flag?.dueDateTime),webLink:m.webLink||''}}
export async function run(config=process.env,fetcher=fetch){
 const required=['MS_TENANT_ID','MS_CLIENT_ID','MS_CLIENT_SECRET','OUTLOOK_MAILBOXES','VISTA_IMPORT_URL','OUTLOOK_IMPORT_TOKEN'];for(const key of required)if(!config[key])throw Error('Missing '+key);
 if(config.OUTLOOK_IMPORT_TOKEN.length<32)throw Error('Import token must contain at least 32 characters.');
 const target=new URL(config.VISTA_IMPORT_URL);if(target.protocol!=='https:'||target.username||target.password)throw Error('Use an HTTPS import endpoint without URL credentials.');
 if(config.OUTLOOK_SYNC_ENABLED!=='true'){console.log('Disabled: set OUTLOOK_SYNC_ENABLED=true after OSS review.');return;}
 const boxes=config.OUTLOOK_MAILBOXES.split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);if(!boxes.length)throw Error('No mailboxes configured.');
 const response=await fetchRetry('https://login.microsoftonline.com/'+encodeURIComponent(config.MS_TENANT_ID)+'/oauth2/v2.0/token',{method:'POST',body:new URLSearchParams({client_id:config.MS_CLIENT_ID,client_secret:config.MS_CLIENT_SECRET,scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'})},fetcher);
 if(!response.ok)throw Error('Microsoft token request failed: HTTP '+response.status);
 const token=await response.json();if(!token.access_token)throw Error('Microsoft token missing');
 let processed=0,failures=0;const dry=config.OUTLOOK_DRY_RUN!=='false';
 for(const mailbox of boxes){
  let url=new URL('https://graph.microsoft.com/v1.0/users/'+encodeURIComponent(mailbox)+'/messages');
  url.searchParams.set('$filter',"flag/flagStatus eq 'flagged'");url.searchParams.set('$select','id,subject,body,bodyPreview,from,webLink,flag');url.searchParams.set('$top','50');
  while(url){
   if(url.origin!=='https://graph.microsoft.com'||!url.pathname.startsWith('/v1.0/'))throw Error('Unexpected Graph pagination target');
   const r=await fetchRetry(url,{headers:{Authorization:'Bearer '+token.access_token,Prefer:'IdType="ImmutableId", outlook.body-content-type="text", outlook.timezone="UTC"'}},fetcher);
   if(!r.ok)throw Error('Mailbox query failed: HTTP '+r.status);
   const page=await r.json();if(!Array.isArray(page.value))throw Error('Invalid Graph response');
   for(const message of page.value){
    if(message.flag?.flagStatus!=='flagged')continue;
    try{const payload=toPayload(mailbox,message);if(!dry){const result=await fetchRetry(target,{method:'POST',headers:{Authorization:'Bearer '+config.OUTLOOK_IMPORT_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(payload)},fetcher);if(!result.ok)throw Error('Import returned HTTP '+result.status);}processed++;}
    catch(e){failures++;console.error('One email could not be imported: '+e.message);}
   }
   url=page['@odata.nextLink']?new URL(page['@odata.nextLink']):null;
  }
 }
 console.log(JSON.stringify({mode:dry?'dry-run':'import',processed,failures}));if(failures)throw Error('Some imports failed; inspect errors and retry.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(e=>{console.error(e.message);process.exitCode=1});
