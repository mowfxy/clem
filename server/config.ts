import {databaseReady} from './db.ts';
import dotenv from 'dotenv';
if(!process.env.NODE_TEST_CONTEXT)dotenv.config({path:'.env.local',quiet:true});
export function capabilities(){return {database:databaseReady(),auth:!!(process.env.SUPABASE_URL&&process.env.SUPABASE_PUBLISHABLE_KEY)||!!process.env.SESSION_SECRET&&(databaseReady()||!!process.env.CLEM_ACCESS_PASSWORD),storage:!!(process.env.SUPABASE_URL&&process.env.SUPABASE_PUBLISHABLE_KEY),drive:!!(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.APP_URL),scheduler:!!process.env.CRON_SECRET};}
