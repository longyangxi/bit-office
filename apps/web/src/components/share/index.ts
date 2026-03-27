/**
 * Share module — standalone project recap GIF generator.
 *
 * Data coupling: only depends on the shape of ProjectArchive
 * (project name, agents, events array, token usage).
 *
 * Usage:
 *   import ProjectRecap from "@/components/share";
 *   <ProjectRecap archive={projectData} />
 */

export { default } from "./ProjectRecap";
export { extractRecapData } from "./recap-data";
export type { RecapData, RecapAgent, RecapReviewRound, MilestoneEntry } from "./recap-data";
export { renderRecapFrames, FRAME_W, FRAME_H } from "./recap-renderer";
export { encodeGif } from "./gif-encoder";
