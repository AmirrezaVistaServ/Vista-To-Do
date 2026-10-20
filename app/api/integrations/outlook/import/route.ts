import {env} from 'cloudflare:workers';
import {handleImport} from '../../../../../integrations/outlook/import-service.mjs';
// Machine-to-machine endpoint; bearer authentication is enforced by handleImport.
export async function POST(req:Request){return handleImport(req,env)}
