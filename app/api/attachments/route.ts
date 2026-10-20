import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {workspaces} from '../../../db/schema';
import {eq} from 'drizzle-orm';
const MAX=20*1024*1024;
const fail=(error:string,status=400)=>Response.json({error},{status});
async function context(req:Request){
 const user=await getChatGPTUser();if(!user)return fail('Sign in required',401);
 const url=new URL(req.url),task=url.searchParams.get('task');
 if(!task||task.length>200)return fail('Invalid task');
 if(req.method!=='GET'&&req.headers.get('origin')!==url.origin)return fail('Invalid origin',403);
 const rows=await getDb().select().from(workspaces).where(eq(workspaces.owner,user.userId));
 if(!rows[0]||!JSON.parse(rows[0].data).tasks.some((t:{id:string})=>t.id===task))return fail('Save this task before adding attachments.',404);
 if(!env.BUCKET)return fail('File storage is unavailable. Please try again later.',503);
 return {bucket:env.BUCKET,prefix:`attachments/${encodeURIComponent(user.userId)}/${encodeURIComponent(task)}/`,url};
}
export async function GET(req:Request){
 const c=await context(req);if(c instanceof Response)return c;
 const id=c.url.searchParams.get('id');
 if(id){
  if(!/^[\da-f-]{36}$/.test(id))return fail('Invalid attachment');
  const file=await c.bucket.get(c.prefix+id);if(!file)return fail('Attachment not found',404);
  return new Response(file.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.customMetadata?.name||'download').replace(/'/g,'%27')}`,'Content-Length':String(file.size),'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});
 }
 const files=[];let cursor:string|undefined;
 do{const page=await c.bucket.list({prefix:c.prefix,include:['customMetadata'],cursor} as R2ListOptions & {include:string[]});files.push(...page.objects.map(f=>({id:f.key.slice(c.prefix.length),name:f.customMetadata?.name||'File',size:f.size,uploaded:f.uploaded.toISOString()})));cursor=page.truncated?page.cursor:undefined;}while(cursor);
 return Response.json({files:files.sort((a,b)=>b.uploaded.localeCompare(a.uploaded))},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:Request){
 const c=await context(req);if(c instanceof Response)return c;
 const name=(c.url.searchParams.get('name')||'').replace(/[\x00-\x1f\x7f/\\]/g,'_').trim();
 if(!name||name.length>200)return fail('Use a filename of 1–200 characters.');
 if(Number(req.headers.get('content-length'))>MAX)return fail('Each file must be 20 MB or smaller.',413);
 if(!req.body)return fail('Choose a file.');
 const reader=req.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX){await reader.cancel();return fail('Each file must be 20 MB or smaller.',413)}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const id=crypto.randomUUID();await c.bucket.put(c.prefix+id,bytes,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{name}});
 return Response.json({id,name,size,uploaded:new Date().toISOString()},{status:201});
}
export async function DELETE(req:Request){
 const c=await context(req);if(c instanceof Response)return c;
 const id=c.url.searchParams.get('id');if(!id||!/^[\da-f-]{36}$/.test(id))return fail('Invalid attachment');
 await c.bucket.delete(c.prefix+id);return Response.json({ok:true});
}
