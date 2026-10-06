import { sql } from "drizzle-orm";
import {
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Literal (not imported from config) so drizzle-kit can read this file on its own.
// Must match `instance.dbSchema`.
export const appSchema = pgSchema("matzpen");

export const spaces = appSchema.table("spaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  view: text("view").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tasks = appSchema.table(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("new"),
    dueDate: date("due_date", { mode: "string" }),
    position: doublePrecision("position").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_space_idx").on(t.spaceId),
    index("tasks_due_idx").on(t.dueDate),
    index("tasks_status_idx").on(t.status),
  ],
);

export const settings = appSchema.table("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Agent actions that wait for the user's "yes". Executed exactly as stored. */
export const pendingActions = appSchema.table("pending_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // "add" | "update" | "delete"
  payload: jsonb("payload").notNull(),
  taskIds: jsonb("task_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  scope: jsonb("scope").$type<string[]>().notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull().default("pending"), // pending | confirmed | cancelled | expired
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const loginAttempts = appSchema.table("login_attempts", {
  ip: text("ip").primaryKey(),
  count: integer("count").notNull().default(0),
  firstAt: timestamp("first_at", { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});
