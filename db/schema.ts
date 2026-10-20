import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const workspaces = sqliteTable('workspaces', { owner: text('owner').primaryKey(), data: text('data').notNull(), revision: text('revision').notNull() });
export const outlookImports = sqliteTable('outlook_imports', {
 sourceKey:text('source_key').primaryKey(),
 taskId:text('task_id').notNull(),
 owner:text('owner').notNull(),
 importedAt:text('imported_at').notNull()
});
