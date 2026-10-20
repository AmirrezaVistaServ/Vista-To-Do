export type MetricTask = {projectId?:string;id:string;title:string;status:string;owner:string;due:string;priority:string};
export const taskStatuses=['To do','In progress','In review','Completed','Cancelled'];
export function matchesTask(t:MetricTask,filter:string,now:number){
 const pending=!['Completed','Cancelled'].includes(t.status),due=Date.parse(t.due);
 if(filter==='All tasks')return true;
 if(filter==='Pending')return pending;
 if(filter==='Overdue')return pending&&Number.isFinite(due)&&due<now;
 if(filter==='Due in 7 days')return pending&&due>=now&&due<=now+7*86400000;
 if(filter==='No deadline')return pending&&!t.due;
 if(filter==='High priority')return pending&&['High','Urgent'].includes(t.priority);
 return t.status===filter;
}
export function taskMetrics(tasks:MetricTask[],members:{id:string;name:string}[],now:number){
 const count=(filter:string)=>tasks.filter(t=>matchesTask(t,filter,now)).length;
 const completed=count('Completed'),pending=count('Pending');
 const groups=[...members,{id:'__unassigned__',name:'Unassigned'}].map(m=>{
 const assigned=tasks.filter(t=>m.id==='__unassigned__'?!members.some(x=>x.id===t.owner):t.owner===m.id);
 return {...m,total:assigned.length,pending:assigned.filter(t=>!['Completed','Cancelled'].includes(t.status)).length,cancelled:assigned.filter(t=>t.status==='Cancelled').length,completed:assigned.filter(t=>t.status==='Completed').length,overdue:assigned.filter(t=>matchesTask(t,'Overdue',now)).length};
 }).sort((a,b)=>b.pending-a.pending||b.total-a.total||a.name.localeCompare(b.name));
 return {total:tasks.length,completed,pending,cancelled:count('Cancelled'),overdue:count('Overdue'),upcoming:count('Due in 7 days'),noDeadline:count('No deadline'),highPriority:count('High priority'),unassigned:groups.find(g=>g.id==='__unassigned__')!.pending,rate:tasks.length?Math.round(completed/tasks.length*100):null,statuses:taskStatuses.map(status=>({status,count:count(status)})),groups};
}
