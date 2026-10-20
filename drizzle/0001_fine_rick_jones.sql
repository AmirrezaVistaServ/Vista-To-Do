CREATE TABLE `outlook_imports` (
	`source_key` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`owner` text NOT NULL,
	`imported_at` text NOT NULL
);
