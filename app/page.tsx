import { requireChatGPTUser } from './chatgpt-auth';
import Desk from './desk';
export const dynamic='force-dynamic';
export default async function Page(){const user=await requireChatGPTUser('/');return <Desk name={user.displayName}/>;}
