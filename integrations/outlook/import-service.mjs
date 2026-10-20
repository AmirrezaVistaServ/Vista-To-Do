// Shared core; receives the D1 binding and server-only configuration.
export async function tokenMatches(actual, expected) {
 const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 const [a,b]=await Promise.all([digest(actual),digest(expected)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export function normalizeEmail(input){
 if(!input||typeof input!=='object')throw Error('Expected a JSON object.');
 const str=(key,max,required=false)=>{const v=input[key];if(v===undefined&&!required)return '';if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw Error('Invalid '+key);return v.trim()};
 const mailbox=str('mailbox',254,true).toLowerCase(),messageId=str('messageId',1024,true);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox))throw Error('Invalid mailbox');
 if(input.flagStatus!=='flagged')throw Error('Only active follow-up flags may be imported.');
 const due=str('due',50);if(due&&(!/(Z|[+-]\d{2}:\d{2})$/.test(due)||!Number.isFinite(Date.parse(due))))throw Error('due must be ISO 8601 with an explicit timezone.');
 const webLink=str('webLink',4096);if(webLink){const u=new URL(webLink);if(u.protocol!=='https:'||u.username||u.password)throw Error('webLink must be HTTPS.');}
 return {mailbox,messageId,subject:str('subject',1000)||'(No subject)',bodyText:str('bodyText',12000),sender:str('sender',500),due:due?new Date(due).toISOString():'',webLink};
}
export async function importEmail(db,mapping,email){
 const sourceKey=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([mapping.owner,email.mailbox,email.messageId])))),b=>b.toString(16).padStart(2,'0')).join('');
 for(let attempt=0;attempt<5;attempt++){
  const old=await db.prepare('SELECT task_id FROM outlook_imports WHERE source_key = ?').bind(sourceKey).first();
  if(old)return {status:'already_imported',taskId:old.task_id};
  const row=await db.prepare('SELECT data, revision FROM workspaces WHERE owner = ?').bind(mapping.owner).first();
  if(!row)throw Error('Configured workspace does not exist. Save the workspace first.');
  const data=JSON.parse(row.data);
  if(!data.members.some(m=>m.id===mapping.assignee))throw Error('Configured assignee does not exist in the workspace.');
  if(data.tasks.length>=3000)throw Error('Workspace task limit reached.');
  const id=crypto.randomUUID(),at=new Date().toISOString();
  const task={id,title:email.subject.slice(0,200),description:['Imported from Outlook follow-up flag.',email.sender?'From: '+email.sender:'',email.bodyText,email.webLink?'Original email: '+email.webLink:''].filter(Boolean).join('\n\n'),owner:mapping.assignee,status:'To do',priority:'Normal',due:email.due,reminder:'',notes:[],history:[{text:'Created from Outlook follow-up flag',at}],outlook:{mailbox:email.mailbox,sourceKey,webLink:email.webLink}};
  data.tasks.unshift(task);const serialized=JSON.stringify(data);if(serialized.length>2000000)throw Error('Workspace storage limit reached.');
  const revision=crypto.randomUUID();
  // D1 batch is transactional. Insert only against the revision read above;
  // changes() gates the immediately following update on that successful insert.
  const results=await db.batch([
   db.prepare('INSERT INTO outlook_imports (source_key, task_id, owner, imported_at) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE owner = ? AND revision = ?) ON CONFLICT(source_key) DO NOTHING').bind(sourceKey,id,mapping.owner,at,mapping.owner,row.revision),
   db.prepare('UPDATE workspaces SET data = ?, revision = ? WHERE owner = ? AND revision = ? AND changes() = 1').bind(serialized,revision,mapping.owner,row.revision)
  ]);
  if(results[0].meta.changes===1&&results[1].meta.changes===1)return {status:'created',taskId:id};
 }
 throw Error('Workspace busy. Retry the import.');
}
export async function handleImport(req,env){
 if(!env.OUTLOOK_IMPORT_TOKEN||env.OUTLOOK_IMPORT_TOKEN.length<32||!env.OUTLOOK_MAILBOX_MAP)return reply({error:'Outlook integration is not configured.'},503);
 const auth=req.headers.get('authorization')||'';
 if(!auth.startsWith('Bearer ')||!await tokenMatches(auth.slice(7),env.OUTLOOK_IMPORT_TOKEN))return reply({error:'Unauthorized'},401);
 if(!env.DB)return reply({error:'Database unavailable'},503);
 let input;
 try{
  if(!req.headers.get('content-type')?.includes('application/json'))return reply({error:'Use application/json'},415);
  if(!req.body)return reply({error:'Missing body'},400);
  const reader=req.body.getReader(),chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>65536){await reader.cancel();return reply({error:'Payload too large'},413)}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const v of chunks){bytes.set(v,offset);offset+=v.length;}input=normalizeEmail(JSON.parse(new TextDecoder().decode(bytes)));
 }catch(e){return reply({error:e.message||'Invalid payload'},400)}
 let mapping;
 try{const all=JSON.parse(env.OUTLOOK_MAILBOX_MAP);mapping=Object.hasOwn(all,input.mailbox)?all[input.mailbox]:null;if(mapping&&(typeof mapping.owner!=='string'||!mapping.owner||typeof mapping.assignee!=='string'||!mapping.assignee))throw Error();}
 catch{return reply({error:'Invalid server mailbox mapping'},503)}
 if(!mapping)return reply({error:'Mailbox is not enabled for import.'},403);
 try{const result=await importEmail(env.DB,mapping,input);return reply(result,result.status==='created'?201:200)}
 catch(e){if(/Configured|Workspace/.test(e.message))return reply({error:e.message},409);return reply({error:'Import storage failed. Check migrations and retry.'},503)}
}
