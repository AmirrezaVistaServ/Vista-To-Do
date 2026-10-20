import {scheduleError} from '../../../lib/reminders';
import { getChatGPTUser } from '../../chatgpt-auth';
import { getDb } from '../../../db';
import { workspaces } from '../../../db/schema';
import { eq, and } from 'drizzle-orm';
export async function GET() {
 const user=await getChatGPTUser(); if(!user)return Response.json({error:'Sign in required'},{status:401});
 const rows=await getDb().select().from(workspaces).where(eq(workspaces.owner,user.userId));
 return Response.json({data:rows[0]?JSON.parse(rows[0].data):{tasks:[],members:[],projects:[]},revision:rows[0]?.revision??null},{headers:{'Cache-Control':'no-store'}});
}
export async function PUT(req:Request) {
 const user=await getChatGPTUser(); if(!user)return Response.json({error:'Sign in required'},{status:401});
 const origin=req.headers.get('origin'); if(origin&&origin!==new URL(req.url).origin)return Response.json({error:'Invalid origin'},{status:403});
 try {
 const body:any=await req.json(); const d=body.data;
 if(!d||!Array.isArray(d.tasks)||!Array.isArray(d.members)||JSON.stringify(d).length>2000000||d.tasks.length>3000||d.members.length>500)throw Error('Invalid workspace');
 const statuses=['To do','In progress','In review','Completed','Cancelled'];
 if(d.tasks.some((t:any)=>typeof t.id!=='string'||typeof t.title!=='string'||!t.title.trim()||t.title.length>200||!statuses.includes(t.status)))throw Error('Invalid task');
 if(d.tasks.some((t:any)=>t.schedule&&scheduleError(t.schedule)))throw Error('Invalid reminder schedule');
 if(d.projects!==undefined&&(!Array.isArray(d.projects)||d.projects.length>500||d.projects.some((p:any)=>typeof p.id!=='string'||typeof p.name!=='string'||!p.name.trim()||p.name.length>200||!Array.isArray(p.followups))))throw Error('Invalid projects');
 const db=getDb(), revision=crypto.randomUUID(), value={owner:user.userId,data:JSON.stringify(d),revision};
 if(body.revision===null){ const inserted=await db.insert(workspaces).values(value).onConflictDoNothing().returning(); if(!inserted.length)return Response.json({error:'Workspace changed. Reload and try again.'},{status:409}); }
 else { const updated=await db.update(workspaces).set({data:value.data,revision}).where(and(eq(workspaces.owner,user.userId),eq(workspaces.revision,body.revision))).returning();if(!updated.length)return Response.json({error:'Workspace changed. Reload and try again.'},{status:409}); }
 return Response.json({revision});
 }catch{return Response.json({error:'Could not save. Check the task details.'},{status:400});}
}
