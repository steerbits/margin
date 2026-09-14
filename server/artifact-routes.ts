import type express from "express";
import { z } from "zod";
import { ArtifactStore, ReviewConflict } from "./artifacts.ts";
import type { ArtifactPreviews } from "./artifact-preview.ts";
import type { Store } from "./store.ts";
import type { FeedbackBatch, Project, Snapshot } from "../shared/types.ts";

export function installArtifactRoutes(
  app: express.Express,
  host: {
    store: Store;
    previews: ArtifactPreviews;
    project: (sessionId: string) => Project;
    snapshot: (sessionId: string) => Snapshot;
    send: (
      sessionId: string,
      batch: FeedbackBatch,
    ) => Promise<{ status: string }>;
  },
) {
  const route =
    (
      fn: (
        req: express.Request,
        res: express.Response,
        store: ArtifactStore,
        project: Project,
      ) => unknown,
    ): express.RequestHandler =>
    (req, res, next) => {
      Promise.resolve()
        .then(() => {
          const id = String(req.params.id);
          const project = host.project(id);
          return fn(req, res, new ArtifactStore(host.store, id), project);
        })
        .catch((error) => {
          if (error instanceof ReviewConflict)
            res.status(409).json({ error: error.message, conflict: true });
          else next(error);
        });
    };
  app.get(
    "/api/sessions/:id/artifacts",
    route((req, res, store) => {
      const snapshot = host.snapshot(String(req.params.id));
      res.json({
        ...store.state(),
        busy: snapshot.busy || snapshot.dialogs.length > 0,
      });
    }),
  );
  app.post(
    "/api/sessions/:id/artifacts",
    route((req, res, store, project) =>
      res.json(store.register(project, req.body)),
    ),
  );
  app.put(
    "/api/sessions/:id/artifacts/comments",
    route((req, res, store) => res.json(store.update(req.body))),
  );
  app.post(
    "/api/sessions/:id/artifacts/:artifactId/preview",
    route(async (req, res, store, project) => {
      const input = z
        .object({
          parentOrigin: z.string().max(200),
          original: z.boolean().optional(),
        })
        .parse(req.body);
      const artifact = store.artifact(String(req.params.artifactId));
      res.json(
        await host.previews.open(
          String(req.params.id),
          artifact,
          project.path,
          input.parentOrigin,
          input.original,
        ),
      );
    }),
  );
  app.post(
    "/api/sessions/:id/artifacts/send",
    route(async (req, res, store) => {
      const { id, commentIds } = z
        .object({
          id: z.string().uuid(),
          commentIds: z.array(z.string().uuid()).min(1).max(200),
        })
        .parse(req.body);
      const batch = store.prepareBatch(id, commentIds);
      store.lock(id);
      try {
        const result = await host.send(String(req.params.id), {
          id,
          note: batch.prompt,
          commentIds: [],
        });
        if (["accepted", "rejected"].includes(result.status))
          host.store.markBatch(String(req.params.id), id, result.status);
        res.json(result);
      } catch (error) {
        store.reject(id);
        throw error;
      }
    }),
  );
}
