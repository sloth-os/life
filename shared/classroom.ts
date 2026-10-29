// Classroom mode contract: teachers create classes and assign expeditions; students join with the
// class code and share a summary of how each assignment went (never the conversation itself).
import { z } from "zod";
import { DestinationSchema } from "./schemas.ts";
import { SKILL_IDS, type SkillId } from "./skills.ts";

const text = (max: number) => z.string().trim().max(max);

export const CreateClassRequestSchema = z.object({ name: text(80).min(1), teacherName: text(60).min(1) });
export type CreateClassRequest = z.infer<typeof CreateClassRequestSchema>;

export const JoinClassRequestSchema = z.object({ name: text(40).min(1) });
export type JoinClassRequest = z.infer<typeof JoinClassRequestSchema>;

export const AssignmentInputSchema = z.object({
  title: text(120).min(1),
  destination: DestinationSchema,
  focusSkill: z.enum(SKILL_IDS),
  note: text(400).optional(),
});
export type AssignmentInput = z.infer<typeof AssignmentInputSchema>;

export interface Assignment extends AssignmentInput {
  id: string;
  createdAt: number;
}

/** What a student shares when they finish an assignment: a summary, not the conversation. */
export const ClassResultInputSchema = z.object({
  studentId: text(64).min(8),
  assignmentId: text(40),
  kind: z.enum(["local", "mediation"]),
  with: text(120),
  headline: text(200),
  scores: z.partialRecord(z.enum(SKILL_IDS), z.number().min(0).max(4).nullable()),
  growthSkill: z.enum(SKILL_IDS),
  goalAchieved: z.boolean(),
  selfRating: z.number().int().min(1).max(5),
  calibrationGap: z.number().nullable(),
  xp: z.number().int().min(0).max(10_000),
});
export type ClassResultInput = z.infer<typeof ClassResultInputSchema>;

export interface ClassResult extends Omit<ClassResultInput, "studentId"> {
  studentName: string;
  at: number;
}

export interface StudentClassView {
  code: string;
  name: string;
  teacherName: string;
  assignments: Assignment[];
}

export interface AssignmentSummary {
  assignment: Assignment;
  completed: number;
  /** Percent of results where the learner reached their goal (null until someone finishes). */
  goalRate: number | null;
  averageScores: Record<SkillId, number | null>;
  /** The mentor's growth focus across the class, most common first. */
  commonGrowth: { skill: SkillId; count: number }[];
  /** Self-rating minus the mentor's view, on average: above 0, the class rates itself higher. */
  averageCalibration: number | null;
  results: ClassResult[];
}

export interface ClassDashboard {
  code: string;
  name: string;
  teacherName: string;
  students: { name: string; joinedAt: number }[];
  assignments: AssignmentSummary[];
}
