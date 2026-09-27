import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import {d1,DatabaseError} from './d1.ts';
export function databaseReady(){return !!(process.env.CLOUDFLARE_DATABASE_URL&&process.env.CLOUDFLARE_DATABASE_SECRET)||!!process.env.DATABASE_URL;}
export function db(){if(process.env.CLOUDFLARE_DATABASE_URL)return d1() as unknown as NeonQueryFunction<false,false>;if(!process.env.DATABASE_URL)throw new DatabaseError('Cloud database is not configured.');return neon(process.env.DATABASE_URL);}
export async function ensureUser(id:string,name:string){await db()`INSERT INTO mowr_users(id,display_name) VALUES(${id},${name}) ON CONFLICT(id) DO NOTHING`;}

