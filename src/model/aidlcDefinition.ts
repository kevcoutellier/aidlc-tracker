/**
 * Canonical definition of the AI-DLC phases and stages.
 *
 * Source: AWS "AI-Driven Development Life Cycle" methodology
 * (Inception -> Construction -> Operations). Construction stages run once per
 * unit of work; Operations is a placeholder in v1 (represented, not orchestrated).
 */

import { PhaseDefinition, PhaseId, StageDefinition } from "./types";

export const PHASES: PhaseDefinition[] = [
  {
    id: "inception",
    name: "Inception",
    description: "Establish WHAT to build and WHY.",
    stages: [
      {
        id: "workspace-detection",
        name: "Workspace Detection",
        phase: "inception",
        description: "Analyze the workspace and gather codebase context.",
        artifact: "inception/workspace-analysis.md",
      },
      {
        id: "reverse-engineering",
        name: "Reverse Engineering",
        phase: "inception",
        description: "Recover existing architecture, services and dependencies.",
        artifact: "inception/reverse-engineering.md",
      },
      {
        id: "requirements-analysis",
        name: "Requirements Analysis",
        phase: "inception",
        description: "Clarify requirements and resolve ambiguity.",
        artifact: "inception/requirements.md",
      },
      {
        id: "user-stories",
        name: "User Stories",
        phase: "inception",
        description: "Derive user stories mapped to system components.",
        artifact: "inception/user-stories.md",
      },
      {
        id: "workflow-planning",
        name: "Workflow Planning",
        phase: "inception",
        description: "Plan the development workflow and break work into units.",
        artifact: "inception/workflow-plan.md",
      },
      {
        id: "application-design",
        name: "Application Design",
        phase: "inception",
        description: "High-level architecture: components and their interactions.",
        artifact: "inception/application-design.md",
      },
    ],
  },
  {
    id: "construction",
    name: "Construction",
    description: "Establish HOW to build it, one unit of work at a time.",
    stages: [
      {
        id: "functional-design",
        name: "Functional Design",
        phase: "construction",
        description: "Functional design specification for the unit.",
        artifact: "construction/{unit}/functional-design.md",
        perUnit: true,
      },
      {
        id: "nfr-requirements",
        name: "NFR Requirements",
        phase: "construction",
        description: "Non-functional requirements assessment.",
        artifact: "construction/{unit}/nfr-requirements.md",
        perUnit: true,
      },
      {
        id: "nfr-design",
        name: "NFR Design",
        phase: "construction",
        description: "NFR-driven architecture and technology selections.",
        artifact: "construction/{unit}/nfr-design.md",
        perUnit: true,
      },
      {
        id: "infrastructure-design",
        name: "Infrastructure Design",
        phase: "construction",
        description: "Infrastructure requirements for the unit.",
        artifact: "construction/{unit}/infrastructure-design.md",
        perUnit: true,
      },
      {
        id: "code-generation",
        name: "Code Generation",
        phase: "construction",
        description: "Plan, then (after approval) generate source code.",
        artifact: "construction/{unit}/code-plan.md",
        perUnit: true,
      },
      {
        id: "build-test",
        name: "Build & Test",
        phase: "construction",
        description: "Build validation and testing.",
        artifact: "construction/{unit}/build-test.md",
        perUnit: true,
      },
    ],
  },
  {
    id: "operations",
    name: "Operations",
    description: "Deploy, monitor and maintain (placeholder in v1).",
    stages: [
      {
        id: "deployment",
        name: "Deployment",
        phase: "operations",
        description: "Deployment configuration and rollout.",
        artifact: "operations/deployment.md",
      },
      {
        id: "monitoring",
        name: "Monitoring",
        phase: "operations",
        description: "Observability and monitoring setup.",
        artifact: "operations/monitoring.md",
      },
    ],
  },
];

const STAGE_INDEX = new Map<string, StageDefinition>();
const PHASE_INDEX = new Map<PhaseId, PhaseDefinition>();
for (const phase of PHASES) {
  PHASE_INDEX.set(phase.id, phase);
  for (const stage of phase.stages) {
    STAGE_INDEX.set(stage.id, stage);
  }
}

/** All stages across all phases, in methodology order. */
export const ALL_STAGES: StageDefinition[] = PHASES.flatMap((p) => p.stages);

export function phaseById(id: PhaseId): PhaseDefinition | undefined {
  return PHASE_INDEX.get(id);
}

export function stageById(id: string): StageDefinition | undefined {
  return STAGE_INDEX.get(id);
}

export function stagesForPhase(id: PhaseId): StageDefinition[] {
  return phaseById(id)?.stages ?? [];
}

/** Inception + Operations stages (the non-per-unit ones). */
export function projectLevelStages(): StageDefinition[] {
  return ALL_STAGES.filter((s) => !s.perUnit);
}

/** Construction stages that run once per unit of work. */
export function unitStages(): StageDefinition[] {
  return stagesForPhase("construction").filter((s) => s.perUnit);
}

/** Resolve an artifact path template against a unit id (if per-unit). */
export function artifactPath(
  stage: StageDefinition,
  unitId?: string
): string | undefined {
  if (!stage.artifact) {
    return undefined;
  }
  return unitId ? stage.artifact.replace("{unit}", unitId) : stage.artifact;
}
