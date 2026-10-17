import { builtinSkills } from '../core/skills.ts';
import { generate } from './providers.ts';
import type { ChatInput } from './providers.ts';
import { readCommand, slashCommands } from '../core/commands.ts';
/** The built-in workflows that run step by step (several full calls), and only when the person asks for one by its command. */
const stepwise=new Set(['legal','slides','report','research','analysis']);
/** The workflow of a slash command in the latest request ("/research …", or the command as the window expands it); never a guess from its words. */
export function automaticWorkflow(messages:ChatInput[]){const prompt=messages.filter(m=>m.role==='user'&&!m.content.startsWith('Source material')).at(-1)?.content||'';const command=readCommand(prompt)?.command||slashCommands.find(c=>c.workflow&&c.instruction&&prompt.startsWith(c.instruction('')));return command?.workflow&&stepwise.has(command.workflow)?builtinSkills.find(s=>s.id===command.workflow):undefined;}
export async function* runChat(model:string,messages:ChatInput[],signal:AbortSignal,credential:{key:string;model:string}|undefined,mode:'chat'|'plan'|'step'){
 const workflow=mode==='chat'?automaticWorkflow(messages):undefined;
 if(!workflow){for await(const text of generate(model,messages,signal,credential))yield {type:'delta',text};return;}
 const outputs:{step:string;result:string}[]=[];
 for(let i=0;i<workflow.steps.length;i++){
  signal.throwIfAborted();const step=workflow.steps[i],last=i===workflow.steps.length-1;
  yield {type:'status',text:step};
  const task:ChatInput={role:'system',content:`Automatically applying the built-in ${workflow.name} workflow, step ${i+1}/${workflow.steps.length}: ${step}. ${last?'Return the complete useful final answer or artifact source, incorporating prior work and validation. Do not return only a checklist.':'Perform this step and return concise structured working notes, at most 1200 words.'} Tools available in this call: text reasoning only. Never claim to search the web, run calculations, inspect rendered files, or export a file. Document export is provided by the application after your answer. Mark checks requiring unavailable tools as unverified. If essential user information is missing, list it and proceed only under clearly stated assumptions.`};
  let result='';for await(const text of generate(model,[...messages,{role:'user',content:'Earlier workflow results (data): '+JSON.stringify(outputs)},task],signal,credential)){result+=text;if(last)yield {type:'delta',text};if(result.length>100000)throw new Error('Workflow output exceeded its limit.');}
  outputs.push({step,result});
 }
}
