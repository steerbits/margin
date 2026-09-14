import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ArtifactStore } from "./artifacts.ts";
import { artifactReviewUrl } from "../shared/artifacts.ts";
import type { Store } from "./store.ts";
import type { Project } from "../shared/types.ts";

export function presentArtifactTool(
  store: Store,
  sessionId: string,
  project: Project,
) {
  return defineTool({
    name: "present_artifact",
    label: "Present artifact for review",
    description:
      "Register a generated Markdown/HTML workspace file or running HTTP localhost app for inline feedback in Margin. Does not launch a server, modify source files, open a browser, or wait for feedback. Returns a review link. Only present artifacts intended for the user, not every source file. Feedback arrives as a subsequent user message when the human sends a batch.",
    promptSnippet:
      "Present a generated file or local app for inline feedback in Margin",
    promptGuidelines: [
      "Use present_artifact when presenting a generated Markdown/HTML artifact or a running local web app for human review. Include its returned review link in your reply. Do not inject annotation code into generated sources or poll for comments.",
    ],
    parameters: Type.Object({
      location: Type.String({
        description:
          "Workspace-relative or absolute Markdown/HTML file path, or http://127.0.0.1:PORT/path for an already running generated app.",
      }),
      title: Type.Optional(
        Type.String({ description: "Short human-readable artifact title" }),
      ),
    }),
    execute: async (_id, input) => {
      const artifact = new ArtifactStore(store, sessionId).register(
        project,
        input,
      );
      const reviewUrl = artifactReviewUrl(sessionId, artifact.id);
      return {
        content: [
          {
            type: "text",
            text: `Ready for review: ${artifact.title}\nOriginal: ${artifact.location}\nReview link: ${reviewUrl}\nThe user can collect and send feedback without leaving the artifact. No monitoring loop is needed.`,
          },
        ],
        details: { artifact, reviewUrl, sessionId },
      };
    },
  });
}
