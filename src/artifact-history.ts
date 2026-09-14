import type { Artifact, ArtifactComment } from "../shared/artifacts.ts";

/** The same route the preview opens before its live URL is reported. */
export function artifactInitialRoute(artifact: Artifact): string {
  if (artifact.kind === "app") {
    const url = new URL(artifact.location);
    return url.pathname + url.search + url.hash;
  }
  return "/" + artifact.location.split("/").map(encodeURIComponent).join("/");
}

/** Only sent, retained annotations for this artifact; never unsent attachments. */
export function previousArtifactComments(
  comments: ArtifactComment[],
  artifactId: string,
): ArtifactComment[] {
  return comments.filter(
    (comment) =>
      !comment.deleted &&
      comment.delivery === "sent" &&
      comment.artifactId === artifactId,
  );
}

/** Page history is the default; all-artifact history is an explicit escape hatch. */
export function previousPageComments(
  comments: ArtifactComment[],
  artifactId: string,
  route: string,
): ArtifactComment[] {
  return previousArtifactComments(comments, artifactId).filter(
    (comment) => comment.anchor.route === route,
  );
}
