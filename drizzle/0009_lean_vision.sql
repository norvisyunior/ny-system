CREATE TABLE `elaboration_template_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`raw_material_id` integer NOT NULL,
	`qty_per_unit_micro` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `elaboration_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `elab_tpl_lines_template_idx` ON `elaboration_template_lines` (`template_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `elab_tpl_lines_material_uq` ON `elaboration_template_lines` (`template_id`,`raw_material_id`);--> statement-breakpoint
CREATE TABLE `elaboration_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`output_material_id` integer NOT NULL,
	`labor_cost_micro` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`output_material_id`) REFERENCES `raw_materials`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `elaboration_templates_output_uq` ON `elaboration_templates` (`output_material_id`);