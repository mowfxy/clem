/**
 * Course organizer.
 *
 * A simple, deterministic model of a user's curriculum. The organizer is
 * the user-facing container for ingested documents, generated artifacts,
 * and assessment history. It supports:
 *
 *   - Programs (degrees) containing semesters
 *   - Semesters containing courses
 *   - Courses containing topics with prerequisite relationships
 *   - Topics containing imported documents and generated artifacts
 *
 * The data model is plain JSON and round-trips through the artifact
 * framework for persistence.
 */

import { KinetraError } from "../errors.js";
import { sha256 } from "../utils/hash.js";
import { newPrefixedId } from "../utils/id.js";

export interface TopicNode {
  id: string;
  name: string;
  description?: string;
  /** Prerequisite topic ids within the same course. */
  prerequisites: string[];
  /** Document sourceIds imported under this topic. */
  documents: string[];
  /** Artifact ids generated under this topic. */
  artifacts: string[];
}

export interface Course {
  id: string;
  name: string;
  code?: string;
  description?: string;
  topics: TopicNode[];
}

export interface Semester {
  id: string;
  label: string;
  courses: Course[];
}

export interface Program {
  id: string;
  name: string;
  semesters: Semester[];
}

export interface CourseGraph {
  programs: Program[];
  /** Top-level courses by id for fast lookup. */
  courses: Record<string, Course>;
  /** Top-level topics by id for fast lookup. */
  topics: Record<string, TopicNode>;
}

export function emptyCourseGraph(): CourseGraph {
  return { programs: [], courses: {}, topics: {} };
}

export function makeTopic(name: string, description?: string): TopicNode {
  if (!name) throw new KinetraError("validation", "Topic name required");
  return {
    id: newPrefixedId("topic"),
    name,
    description,
    prerequisites: [],
    documents: [],
    artifacts: [],
  };
}

export function makeCourse(name: string, code?: string): Course {
  if (!name) throw new KinetraError("validation", "Course name required");
  return {
    id: newPrefixedId("course"),
    name,
    code,
    topics: [],
  };
}

export function makeSemester(label: string): Semester {
  if (!label) throw new KinetraError("validation", "Semester label required");
  return { id: newPrefixedId("semester"), label, courses: [] };
}

export function makeProgram(name: string): Program {
  if (!name) throw new KinetraError("validation", "Program name required");
  return { id: newPrefixedId("program"), name, semesters: [] };
}

export function addProgram(g: CourseGraph, p: Program): CourseGraph {
  return { ...g, programs: [...g.programs, p] };
}

export function addSemester(g: CourseGraph, programId: string, sem: Semester): CourseGraph {
  return mapProgram(g, programId, (p) => ({ ...p, semesters: [...p.semesters, sem] }));
}

export function addCourse(g: CourseGraph, programId: string, semesterId: string, course: Course): CourseGraph {
  const idx: Record<string, Course> = { ...g.courses, [course.id]: course };
  return {
    ...g,
    courses: idx,
    topics: { ...g.topics, ...topicMap(course) },
    programs: g.programs.map((p) =>
      p.id !== programId
        ? p
        : { ...p, semesters: p.semesters.map((s) => (s.id !== semesterId ? s : { ...s, courses: [...s.courses, course] })) }
    ),
  };
}

export function addTopic(g: CourseGraph, courseId: string, topic: TopicNode): CourseGraph {
  const course = g.courses[courseId];
  if (!course) throw new KinetraError("missing", "Course not found", { courseId });
  const updatedCourse = { ...course, topics: [...course.topics, topic] };
  return {
    ...g,
    courses: { ...g.courses, [courseId]: updatedCourse },
    topics: { ...g.topics, [topic.id]: topic },
  };
}

export function addPrerequisite(g: CourseGraph, topicId: string, prereqId: string): CourseGraph {
  const topic = g.topics[topicId];
  const prereq = g.topics[prereqId];
  if (!topic) throw new KinetraError("missing", "Topic not found", { topicId });
  if (!prereq) throw new KinetraError("missing", "Prerequisite topic not found", { prereqId });
  if (topic.prerequisites.includes(prereqId)) return g;
  if (createsCycle(g, topicId, prereqId)) {
    throw new KinetraError("conflict", "Adding prerequisite would create a cycle", { topicId, prereqId });
  }
  return {
    ...g,
    topics: { ...g.topics, [topicId]: { ...topic, prerequisites: [...topic.prerequisites, prereqId] } },
  };
}

export function attachDocument(g: CourseGraph, topicId: string, sourceId: string): CourseGraph {
  const topic = g.topics[topicId];
  if (!topic) throw new KinetraError("missing", "Topic not found", { topicId });
  if (topic.documents.includes(sourceId)) return g;
  return { ...g, topics: { ...g.topics, [topicId]: { ...topic, documents: [...topic.documents, sourceId] } } };
}

export function attachArtifact(g: CourseGraph, topicId: string, artifactId: string): CourseGraph {
  const topic = g.topics[topicId];
  if (!topic) throw new KinetraError("missing", "Topic not found", { topicId });
  if (topic.artifacts.includes(artifactId)) return g;
  return { ...g, topics: { ...g.topics, [topicId]: { ...topic, artifacts: [...topic.artifacts, artifactId] } } };
}

export function detachDocument(g: CourseGraph, topicId: string, sourceId: string): CourseGraph {
  const topic = g.topics[topicId];
  if (!topic) return g;
  return {
    ...g,
    topics: { ...g.topics, [topicId]: { ...topic, documents: topic.documents.filter((d) => d !== sourceId) } },
  };
}

export function findTopic(g: CourseGraph, topicId: string): TopicNode | null {
  return g.topics[topicId] ?? null;
}

export function findCourse(g: CourseGraph, courseId: string): Course | null {
  return g.courses[courseId] ?? null;
}

export function topicsByCourse(g: CourseGraph, courseId: string): TopicNode[] {
  const c = g.courses[courseId];
  return c ? c.topics.slice() : [];
}

export function serializeCourseGraph(g: CourseGraph): string {
  return JSON.stringify(g, null, 2);
}

export function deserializeCourseGraph(raw: string): CourseGraph {
  const obj = JSON.parse(raw);
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.programs)) {
    throw new KinetraError("parse", "Invalid course graph");
  }
  return obj as CourseGraph;
}

export function courseGraphHash(g: CourseGraph): string {
  return sha256(serializeCourseGraph(g));
}

function mapProgram(g: CourseGraph, programId: string, f: (p: Program) => Program): CourseGraph {
  return { ...g, programs: g.programs.map((p) => (p.id === programId ? f(p) : p)) };
}

function topicMap(course: Course): Record<string, TopicNode> {
  const out: Record<string, TopicNode> = {};
  for (const t of course.topics) out[t.id] = t;
  return out;
}

function createsCycle(g: CourseGraph, fromId: string, toId: string): boolean {
  // Adding edge from -> to. Cycle exists if `to` can already reach `from`.
  const stack = [toId];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === fromId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const t = g.topics[cur];
    if (!t) continue;
    for (const p of t.prerequisites) stack.push(p);
  }
  return false;
}