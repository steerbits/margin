import type { Artifact, ArtifactComment } from "../shared/artifacts.ts";

/** The same route the preview opens before its live URL is reported. */
export function artifactInitialRoute(artifact: Artifact): string {
  if (artifact.kind === "app") {
    const url = new URL(artifact.location);
    return url.pathname + url.search + url.hash;
  }
  return "/" + artifact.location.split("/").map(encodeURIComponent).join("/");
}

/** Sent history follows the page; unsent attachments are deliberately not scoped here. */
export function previousPageComments(
  comments: ArtifactComment[],
  artifactId: string,
  route: string,
): ArtifactComment[] {
  return comments.filter(
    (comment) =>
      !comment.deleted &&
      comment.delivery === "sent" &&
      comment.artifactId === artifactId &&
      comment.anchor.route === route,
  );
}
