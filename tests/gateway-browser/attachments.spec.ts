import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("gateway authenticates uploads, proxies bounded binary downloads, and isolates per-workspace storage", async ({
  page,
  request,
}) => {
  const link = JSON.parse(
    readFileSync(".margin-data/gateway-test-link.json", "utf8"),
  ) as { url: string; root: string };
  const upload = {
    id: randomUUID(),
    name: "report.pdf",
    mimeType: "application/pdf",
    data: Buffer.alloc(3 * 1024 * 1024, 42).toString("base64"),
  };
  expect(
    (
      await request.post(`/api/sessions/${randomUUID()}/attachments`, {
        data: upload,
      })
    ).status(),
  ).toBe(401);
  await page.goto(link.url);
  await expect(
    page.getByRole("heading", { name: "Welcome to Margin", exact: true }),
  ).toBeVisible();
  const folder = mkdtempSync(join(tmpdir(), "margin-attachment-workspace-"));
  try {
    const registration = await page.request.post("/api/projects", {
      data: { path: folder },
    });
    expect(registration.ok()).toBe(true);
    const project = await registration.json();
    const bootstrap = await (
      await page.request.get(`/api/bootstrap?projectId=${project.id}`)
    ).json();
    const model = bootstrap.models.find(
      (model: { backend?: string }) => !model.backend || model.backend === "pi",
    );
    expect(model).toBeTruthy();
    const creation = await page.request.post("/api/sessions", {
      data: { projectId: project.id, model },
    });
    expect(creation.ok(), await creation.text()).toBe(true);
    const id = (await creation.json()).session.id;
    const response = await page.request.post(
      `/api/sessions/${id}/attachments`,
      { data: upload },
    );
    expect(response.ok(), await response.text()).toBe(true);
    expect((await response.json()).composerAttachments[0].name).toBe(
      upload.name,
    );
    const disk = join(
      link.root,
      "data",
      "workspace-data",
      project.id,
      "attachments",
      id,
      `${upload.id}.pdf`,
    );
    expect(readFileSync(disk)).toEqual(Buffer.from(upload.data, "base64"));
    const preview = await (
      await page.request.get(`/api/sessions/${id}/preview`)
    ).json();
    expect(preview.composerAttachments[0].id).toBe(upload.id);
    const download = `/api/sessions/${id}/attachments/${upload.id}/download`;
    expect((await request.get(download)).status()).toBe(401);
    const downloaded = await page.request.get(download);
    expect(downloaded.ok(), await downloaded.text()).toBe(true);
    expect(downloaded.headers()["content-type"]).toContain(
      "application/octet-stream",
    );
    expect(downloaded.headers()["content-disposition"]).toContain(
      "attachment;",
    );
    expect(downloaded.headers()["content-security-policy"]).toContain(
      "sandbox",
    );
    expect(await downloaded.body()).toEqual(Buffer.from(upload.data, "base64"));
    // Other workspace: no registry routing or file-ID bypass into this worker.
    const margin = bootstrap.projects.find(
      (p: { kind: string }) => p.kind === "margin",
    );
    const other = await page.request.post("/api/sessions", {
      data: { projectId: margin.id, model },
    });
    expect(other.ok()).toBe(true);
    const otherId = (await other.json()).session.id;
    expect(
      (
        await page.request.get(
          `/api/sessions/${otherId}/attachments/${upload.id}/download`,
        )
      ).ok(),
    ).toBe(false);
    // The larger upload allowance does not expand ordinary API request limits.
    expect(
      (
        await page.request.put(`/api/sessions/${id}/composer`, {
          data: { text: "x".repeat(3 * 1024 * 1024) },
        })
      ).ok(),
    ).toBe(false);
    expect(
      (await page.request.delete(`/api/sessions/${id}`, { data: {} })).ok(),
    ).toBe(true);
    expect(existsSync(disk)).toBe(false);
    expect((await page.request.get(download)).ok()).toBe(false);
    await page.request.delete(`/api/sessions/${otherId}`, { data: {} });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
