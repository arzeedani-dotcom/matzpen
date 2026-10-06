/**
 * Shared fixtures: a typed client for the app's REST API (riding on the signed-in browser
 * context), a factory for throw-away "E2E …" spaces that are always deleted afterwards,
 * date helpers in the owner's time zone, dnd-kit friendly drags and screenshots.
 */
import { test as base, expect, type APIRequestContext, type APIResponse, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { addDays, todayIn } from "../../../src/lib/dates";
import type { Priority, Space, SpaceColor, Status, Task, View } from "../../../src/lib/domain";
import { SHOTS_DIR } from "./env";

export { expect };

export const TZ = "Asia/Jerusalem";
/** Every name this suite creates starts with this, so leftovers are easy to find and sweep. */
export const PREFIX = "E2E ";

export const today = () => todayIn(TZ);
export const inDays = (n: number) => addDays(today(), n);
export { addDays };

export interface TaskSeed {
  title: string;
  priority?: Priority;
  status?: Status;
  dueDate?: string | null;
  notes?: string | null;
}

async function body<T>(res: APIResponse): Promise<T> {
  if (!res.ok()) throw new Error(`${res.url()} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

/** The app's REST API as the signed-in owner. */
export class AppApi {
  constructor(private readonly req: APIRequestContext) {}

  spaces = async () => body<Space[]>(await this.req.get("/api/spaces"));

  createSpace = async (input: { name: string; color?: SpaceColor; view?: View }) =>
    body<Space>(await this.req.post("/api/spaces", { data: { color: "slate", view: "list", ...input } }));

  updateSpace = async (id: string, patch: Partial<Pick<Space, "name" | "color" | "view">>) =>
    body<Space>(await this.req.patch(`/api/spaces/${id}`, { data: patch }));

  /** Deletes a space and its tasks; a space that is already gone is fine. */
  deleteSpace = async (id: string) => {
    const res = await this.req.delete(`/api/spaces/${id}`);
    if (!res.ok() && res.status() !== 404) throw new Error(`DELETE space → ${res.status()}`);
  };

  tasks = async (spaceId: string) => body<Task[]>(await this.req.get(`/api/tasks?spaceId=${spaceId}`));

  task = async (id: string): Promise<Task | null> => {
    const res = await this.req.get(`/api/tasks/${id}`);
    if (res.status() === 404) return null;
    return body<Task>(res);
  };

  createTask = async (spaceId: string, seed: TaskSeed) =>
    body<Task>(await this.req.post("/api/tasks", { data: { spaceId, ...seed } }));

  /** Creates tasks one after another (so creation and completion order is deterministic). */
  createTasks = async (spaceId: string, seeds: TaskSeed[]) => {
    const out: Task[] = [];
    for (const s of seeds) out.push(await this.createTask(spaceId, s));
    return out;
  };

  updateTask = async (id: string, patch: Partial<Task>) => body<Task>(await this.req.patch(`/api/tasks/${id}`, { data: patch }));

  dashboardSelection = async () => (await body<{ spaceIds: string[] | null }>(await this.req.get("/api/settings/dashboard"))).spaceIds;

  setDashboardSelection = async (spaceIds: string[] | null) =>
    body<{ spaceIds: string[] | null }>(await this.req.put("/api/settings/dashboard", { data: { spaceIds } }));
}

function suffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

type Fixtures = {
  api: AppApi;
  /** Creates a throw-away space (optionally with tasks). Every space made here is deleted after the test. */
  makeSpace: (opts?: { label?: string; color?: SpaceColor; view?: View; tasks?: TaskSeed[] }) => Promise<{ space: Space; tasks: Task[] }>;
  /** Registers a space created through the UI so it is deleted after the test as well. */
  track: (spaceId: string) => void;
  /** Restores the dashboard space selection to what it was before the test. */
  keepDashboardSelection: void;
  shot: (name: string, opts?: { fullPage?: boolean; target?: Page | Locator }) => Promise<string>;
};

export const test = base.extend<Fixtures>({
  api: async ({ page }, provide) => {
    await provide(new AppApi(page.request));
  },

  track: [
    async ({ api }, provide) => {
      const ids = new Set<string>();
      await provide((id) => ids.add(id));
      for (const id of ids) await api.deleteSpace(id);
    },
    { scope: "test" },
  ],

  makeSpace: async ({ api, track }, provide) => {
    await provide(async ({ label = "space", color = "slate", view = "list", tasks = [] } = {}) => {
      const space = await api.createSpace({ name: `${PREFIX}${label} ${suffix()}`.slice(0, 40), color, view });
      track(space.id);
      const created = await api.createTasks(space.id, tasks);
      return { space, tasks: created };
    });
  },

  keepDashboardSelection: [
    async ({ api }, provide) => {
      const before = await api.dashboardSelection();
      await provide();
      await api.setDashboardSelection(before);
    },
    { auto: false },
  ],

  shot: async ({ page }, provide, testInfo) => {
    mkdirSync(SHOTS_DIR, { recursive: true });
    await provide(async (name, { fullPage = false, target } = {}) => {
      const file = path.join(SHOTS_DIR, `${testInfo.project.name}-${name}.png`);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      // Let entrance animations (animate-pop) settle so the picture shows the resting state.
      await page.waitForTimeout(350);
      if (target && "screenshot" in target && !("goto" in target)) await (target as Locator).screenshot({ path: file });
      else await page.screenshot({ path: file, fullPage });
      return file;
    });
  },
});

// ── Page helpers ──────────────────────────────────────────────────────────

/** Opens a space page and waits until its tasks are on screen (the "loading" line is gone). */
export async function openSpace(page: Page, spaceId: string, query = "") {
  await page.goto(`/spaces/${spaceId}${query}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("טוען…")).toHaveCount(0);
}

/**
 * Drag with a real mouse the way dnd-kit expects it: press, move past the activation
 * distance, glide to the target in small steps, settle, release.
 */
export async function mouseDrag(page: Page, source: Locator, target: Locator, offset: { x?: number; y?: number } = {}) {
  await source.scrollIntoViewIfNeeded();
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  if (!s || !t) throw new Error("drag source or target is not visible");
  const sx = s.x + s.width / 2;
  const sy = s.y + s.height / 2;
  const tx = t.x + t.width / 2 + (offset.x ?? 0);
  const ty = t.y + t.height / 2 + (offset.y ?? 0);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 4, sy + 8, { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 20 });
  await page.mouse.move(tx + 1, ty + 1, { steps: 2 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

/** No sideways scrolling of the page itself (inner scrollers like the kanban are fine). */
export async function expectNoPageHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollWidth - window.innerWidth;
  });
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

/** The font the browser actually used to paint a node's text (Chromium only, via the DevTools protocol). */
export async function renderedFonts(page: Page, target: Locator): Promise<string[]> {
  const handle = await target.elementHandle();
  if (!handle) throw new Error("no element");
  // Mark the node so it can be found through the protocol's DOM tree.
  const marker = `e2e-font-${Math.random().toString(36).slice(2)}`;
  await handle.evaluate((el, m) => el.setAttribute("data-e2e-font", m), marker);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: `[data-e2e-font="${marker}"]` });
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    return fonts.sort((a, b) => b.glyphCount - a.glyphCount).map((f) => f.familyName);
  } finally {
    await cdp.detach();
  }
}

/**
 * WCAG contrast between an element's text color and the first opaque background behind it.
 * Enough to catch "white on white" and unreadable dark-mode text.
 */
export async function contrastRatio(target: Locator): Promise<number> {
  return target.evaluate((el) => {
    // "rgb(r, g, b)" / "rgba(…)" in 0–255, or "color(srgb r g b / a)" (what color-mix() computes to) in 0–1.
    const parse = (c: string) => {
      const n = (c.match(/[\d.]+/g) ?? []).map(Number);
      return c.startsWith("color(") ? [...n.slice(0, 3).map((v) => v * 255), ...n.slice(3)] : n;
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const fg = parse(getComputedStyle(el).color);
    let node: Element | null = el;
    let bg = [255, 255, 255];
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.length >= 3 && (c.length === 3 || c[3] > 0.5)) {
        bg = c;
        break;
      }
      node = node.parentElement;
    }
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
}
