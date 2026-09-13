import 'dotenv/config';import dotenv from 'dotenv';import fs from 'node:fs';import {Pool} from '@neondatabase/serverless';
dotenv.config({path:'.env.local',quiet:true});if(!process.env.DATABASE_URL)throw Error('Add DATABASE_URL to .env.local before running migrations.');
const pool=new Pool({connectionString:process.env.DATABASE_URL});try{for(const file of fs.readdirSync('database').filter(x=>x.endsWith('.sql')).sort()){await pool.query(fs.readFileSync(`database/${file}`,'utf8'));console.log(`Applied ${file}`);}}finally{await pool.end();}
