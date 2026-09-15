import type express from "express";
import { z } from "zod";
import type { Store } from "./store.ts";
import type { AgentBackend } from "./backend-api.ts";
import { AttachmentStore, attachmentState } from "./attachments.ts";

export function installAttachmentRoutes(
  app: express.Express,
  host: {
    store: Store;
    dataDir: string;
    authorize(id: string): void;
    getLive(id: string): AgentBackend;
  },
) {
  const storage = (id: string) => {
    z.string().uuid().parse(id);
    host.authorize(id);
    return new AttachmentStore(host.store, host.dataDir, id);
  };
  app.post("/api/sessions/:id/attachments", (req, res) => {
    const id = String(req.params.id);
    const files = storage(id);
    const session = host.getLive(id);
    if (!session.attachmentsChanged)
      return res
        .status(400)
        .json({ error: "This runtime does not support attachments." });
    files.upload(req.body);
    session.attachmentsChanged();
    res.json(attachmentState(host.store, id));
  });
  app.delete("/api/sessions/:id/attachments/:attachmentId", (req, res) => {
    const id = String(req.params.id);
    const files = storage(id);
    const session = host.getLive(id);
    files.remove(z.string().uuid().parse(req.params.attachmentId));
    session.attachmentsChanged?.();
    res.json(attachmentState(host.store, id));
  });
  app.get(
    "/api/sessions/:id/attachments/:attachmentId/download",
    (req, res) => {
      const { file, bytes } = storage(String(req.params.id)).read(
        z.string().uuid().parse(req.params.attachmentId),
      );
      // Never render arbitrary uploaded HTML/SVG/scripts in Margin's origin.
      res.setHeader("Content-Type", "application/octet-stream");
      const name = encodeURIComponent(file.name).replace(
        /['()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="attachment"; filename*=UTF-8''${name}`,
      );
      res.setHeader(
        "Content-Security-Policy",
        "sandbox; default-src 'none'; frame-ancestors 'none'",
      );
      res.send(bytes);
    },
  );
}
