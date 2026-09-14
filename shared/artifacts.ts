/** Review references are Margin data, never annotations written into project files. */
export interface Artifact {
  id: string;
  title: string;
  kind: "markdown" | "html" | "app";
  location: string;
  createdAt: number;
}
export interface ArtifactAnchor {
  kind: "text" | "element" | "page";
  quote: string;
  prefix: string;
  suffix: string;
  selector: string;
  /** Path/query/hash at selection time, relative to the original app/workspace. */
  route: string;
  /** Fingerprint of the served document, not a claim to capture all live app state. */
  documentRevision: string;
}
export interface ArtifactComment {
  id: string;
  artifactId: string;
  anchor: ArtifactAnchor;
  text: string;
  revision: number;
  mutationId: string;
  createdAt: number;
  deleted?: boolean;
  /** False while composing. Missing means a legacy saved comment. */
  saved?: boolean;
  batchId?: string;
  delivery: "draft" | "submitting" | "sent";
}
export interface ArtifactOverall {
  text: string;
  revision: number;
  mutationId: string;
}
export interface ArtifactReview {
  artifacts: Artifact[];
  comments: ArtifactComment[];
  overall?: ArtifactOverall;
}
export interface PreviewConnection {
  url: string;
  origin: string;
  channel: string;
}
export function artifactReviewUrl(sessionId: string, artifactId?: string) {
  return `/review/${encodeURIComponent(sessionId)}${artifactId ? `?artifact=${encodeURIComponent(artifactId)}` : ""}`;
}
