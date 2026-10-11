CREATE TABLE `production_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` integer NOT NULL,
	`plan_date` text NOT NULL,
	`recipe_version_id` integer NOT NULL,
	`target_packages_micro` integer NOT NULL,
	`expected_yield_micro` integer NOT NULL,
	`planned_masses_micro` integer NOT NULL,
	`preview_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'planificada' NOT NULL,
	`notes` text,
	`client_token` text,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	`cancelled_at` text,
	`cancel_reason` text,
	FOREIGN KEY (`recipe_version_id`) REFERENCES `recipe_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_plans_number_uq` ON `production_plans` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `production_plans_token_uq` ON `production_plans` (`client_token`);--> statement-breakpoint
CREATE INDEX `production_plans_date_idx` ON `production_plans` (`plan_date`);--> statement-breakpoint
CREATE TABLE `transformation_material_consumptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transformation_id` integer NOT NULL,
	`raw_material_id` integer NOT NULL,
	`lot_id` integer NOT NULL,
	`qty_micro` integer NOT NULL,
	`unit_cost_micro` integer NOT NULL,
	`line_cost_micro` integer NOT NULL,
	FOREIGN KEY (`transformation_id`) REFERENCES `transformations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `stock_lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tf_mat_consumptions_tf_idx` ON `transformation_material_consumptions` (`transformation_id`);--> statement-breakpoint
ALTER TABLE `production_batches` ADD `plan_id` integer REFERENCES production_plans(id);--> statement-breakpoint
ALTER TABLE `production_batches` ADD `responsible` text;--> statement-breakpoint
ALTER TABLE `production_batches` ADD `client_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `production_batches_token_uq` ON `production_batches` (`client_token`);--> statement-breakpoint
ALTER TABLE `recipe_items` ADD `phase` text DEFAULT 'masa' NOT NULL;--> statement-breakpoint
ALTER TABLE `recipes` ADD `product_id` integer REFERENCES finished_products(id);--> statement-breakpoint
CREATE UNIQUE INDEX `recipes_product_uq` ON `recipes` (`product_id`);--> statement-breakpoint
ALTER TABLE `transformations` ADD `recipe_version_id` integer REFERENCES recipe_versions(id);--> statement-breakpoint
ALTER TABLE `transformations` ADD `plan_id` integer REFERENCES production_plans(id);--> statement-breakpoint
ALTER TABLE `transformations` ADD `expected_packages_micro` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transformations` ADD `deviation_micro` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transformations` ADD `client_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transformations_token_uq` ON `transformations` (`client_token`);