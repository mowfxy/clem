import test from "node:test";
import assert from "node:assert/strict";
import { draftPlan, executePlan } from "../core/orchestration.ts";
import {
  resumeWorkflow,
  workflowSignature,
} from "../core/workflow-checkpoint.ts";
import { documentBlocks, slidePages } from "../core/document-blocks.ts";
const models = [
  {
    id: "a",
    name: "A",
    provider: "OpenAI" as const,
    connected: true,
    context: 32000,
    specialties: [],
    tools: [],
  },
];
test("workflow resumes completed checkpoints, and changes invalidate stale results", async () => {
  const plan = { ...draftPlan("Report", "a"), approved: true };
  const signature = await workflowSignature(plan, "source v1");
  const tasks = plan.tasks.map((t, i) => ({
    ...t,
    status: i < 2 ? ("complete" as const) : ("running" as const),
    result: i < 2 ? "saved " + i : undefined,
  }));
  const checkpoint = { signature, tasks, updatedAt: Date.now() };
  const resumed = resumeWorkflow(plan, signature, checkpoint);
  let calls = 0;
  await executePlan(
    resumed,
    models,
    async () => {
      calls++;
      return "next";
    },
    new AbortController().signal,
    async () => {},
  );
  assert.equal(calls, 3);
  const changed = await workflowSignature(plan, "source v2");
  assert.ok(
    resumeWorkflow(plan, changed, checkpoint).tasks.every(
      (t) => t.status === "pending" && !t.result,
    ),
  );
  plan.tasks[0].instructions = "new";
  assert.notEqual(await workflowSignature(plan, "source v1"), signature);
});
test("workflow does not run a dependent step until its output is durably saved", async () => {
  const plan = { ...draftPlan("Report", "a"), approved: true };
  let calls = 0;
  await assert.rejects(
    executePlan(
      plan,
      models,
      async () => {
        calls++;
        return "done";
      },
      new AbortController().signal,
      async (t) => {
        if (t.status === "complete") throw Error("disk full");
      },
    ),
    /disk full/,
  );
  assert.equal(calls, 1);
});
test("document structure and slide pagination retain complete content", () => {
  const blocks = documentBlocks(
    "# Heading\n**Bold** paragraph\n- Item\n1. Numbered\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```js\nconst a = 1;\n```",
  );
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["heading", "paragraph", "bullet", "number", "table", "code"],
  );
  const pages = slidePages(
    Array.from({ length: 50 }, (_, i) => "Row " + i).join("\n"),
  );
  assert.equal(pages.length, 4);
  assert.match(pages.at(-1)!, /Row 49/);
  assert.ok(pages.every((p) => p.split("\n").length <= 15));
});

 test('source retrieval keeps relevant late evidence within the context budget',async()=>{const {sourceExcerpts}=await import('../core/source-context.ts');const source='Background. '.repeat(5000)+'UNIQUE experiment result is 42 newtons.';const result=sourceExcerpts([{name:'lab.txt',text:source}],'UNIQUE experiment result',5000);assert.match(result,/42 newtons/);assert.match(result,/Selected excerpts/);assert.ok(result.length<5200);});
test('sources that fit are sent whole, and focus files keep more room when they do not',async()=>{const {sourceExcerpts,namedSources}=await import('../core/source-context.ts');
  const lectures=[1,2,3].map(n=>({name:`Lecture_0${n}.pdf`,text:`Lecture ${n} topic. `.repeat(1000)+`END OF LECTURE ${n}`}));
  const whole=sourceExcerpts(lectures,'explain each lecture fully',200000);
  assert.doesNotMatch(whole,/Selected excerpts/);for(const n of [1,2,3])assert.match(whole,new RegExp(`END OF LECTURE ${n}`));
  assert.deepEqual(namedSources(lectures.map(l=>l.name),'make a pdf for lecture 2'),[1]);
  const tight=sourceExcerpts([...lectures,{name:'big.txt',text:'Other. '.repeat(40000)}],'explain lecture 2',90000,[0]);
  // Only the unrelated file is cut; every lecture still arrives whole.
  assert.match(tight,/big\.txt: selected excerpts, about \d+% of it/);assert.doesNotMatch(tight,/Lecture_0\d\.pdf: selected/);for(const n of [1,2,3])assert.match(tight,new RegExp(`\\[Source: Lecture_0${n}\\.pdf; complete file\\][\\s\\S]*END OF LECTURE ${n}`));assert.ok(tight.length<=90000);});
test('files are indexed, and the ones matching the request get more room',async()=>{const {sourceExcerpts}=await import('../core/source-context.ts');
  const files=[{name:'Thermodynamics.pdf',text:'entropy enthalpy heat engine. '.repeat(3000)},{name:'Optics.pdf',text:'lens mirror refraction. '.repeat(3000)},{name:'Circuits.pdf',text:'resistor capacitor voltage. '.repeat(3000)}];
  const out=sourceExcerpts(files,'How does refraction in a lens work?',60000);
  assert.match(out,/^\[Files available \(3\):\n1\. /);
  const share=(name:string)=>Number(out.split("\n").find(l=>l.includes(name+': selected'))?.match(/about (\d+)%/)?.[1]??100);
  assert.ok(share('Optics.pdf')>share('Thermodynamics.pdf'));assert.ok(out.length<=60000);});
