CREATE TABLE `raw_elaboration_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`elaboration_id` integer NOT NULL,
	`raw_material_id` integer NOT NULL,
	`lot_id` integer NOT NULL,
	`qty_micro` integer NOT NULL,
	`unit_cost_micro` integer NOT NULL,
	`line_cost_micro` integer NOT NULL,
	FOREIGN KEY (`elaboration_id`) REFERENCES `raw_elaborations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `stock_lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `raw_elab_lines_elab_idx` ON `raw_elaboration_lines` (`elaboration_id`);--> statement-breakpoint
CREATE TABLE `raw_elaborations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` integer NOT NULL,
	`elaboration_date` text NOT NULL,
	`output_material_id` integer NOT NULL,
	`output_qty_micro` integer NOT NULL,
	`labor_cost_micro` integer DEFAULT 0 NOT NULL,
	`total_cost_micro` integer DEFAULT 0 NOT NULL,
	`unit_cost_micro` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'confirmada' NOT NULL,
	`notes` text,
	`client_token` text,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	`cancelled_at` text,
	`cancel_reason` text,
	FOREIGN KEY (`output_material_id`) REFERENCES `raw_materials`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_elaborations_number_uq` ON `raw_elaborations` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `raw_elaborations_token_uq` ON `raw_elaborations` (`client_token`);--> statement-breakpoint
CREATE INDEX `raw_elaborations_date_idx` ON `raw_elaborations` (`elaboration_date`);--> statement-breakpoint
ALTER TABLE `raw_materials` ADD `elaborated` integer DEFAULT false NOT NULL;