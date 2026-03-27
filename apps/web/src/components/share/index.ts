/**
 * Share module — standalone project recap GIF generator.
 *
 * Two integration paths:
 *
 * 1. LIVE (preferred): Feed events to RecapCollector during project execution.
 *    Only records key data points — zero rendering cost until user clicks share.
 *
 *      const collector = new RecapCollector("My Project");
 *      collector.addAgent(id, name, role);
 *      // in event handler:
 *      collector.onEvent(event);
 *      // on share click:
 *      <ProjectRecap data={collector.toRecapData()} />
 *
 * 2. ARCHIVE (fallback): Extract from stored ProjectArchive for historical projects.
 *
 *      <ProjectRecap archive={projectArchiveData} />
 */

export { default } from "./ProjectRecap";
export { RecapCollector, extractRecapData } from "./recap-data";
export type { RecapData, RecapAgent, RecapReviewRound, MilestoneEntry } from "./recap-data";
export { renderRecapFrames, FRAME_W, FRAME_H } from "./recap-renderer";
export { encodeGif } from "./gif-encoder";
