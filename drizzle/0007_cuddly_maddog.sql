CREATE TABLE `fixed_asset_depreciations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` integer NOT NULL,
	`period` text NOT NULL,
	`amount_micro` integer NOT NULL,
	`expense_id` integer,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `fixed_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fixed_asset_depreciations_asset_period_uq` ON `fixed_asset_depreciations` (`asset_id`,`period`);--> statement-breakpoint
CREATE INDEX `fixed_asset_depreciations_period_idx` ON `fixed_asset_depreciations` (`period`);--> statement-breakpoint
CREATE TABLE `fixed_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`acquired_at` text NOT NULL,
	`cost_micro` integer NOT NULL,
	`residual_micro` integer DEFAULT 0 NOT NULL,
	`useful_life_months` integer NOT NULL,
	`method` text DEFAULT 'lineal' NOT NULL,
	`supplier_id` integer,
	`location` text,
	`notes` text,
	`status` text DEFAULT 'en_uso' NOT NULL,
	`disposed_at` text,
	`dispose_type` text,
	`recovery_value_micro` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fixed_assets_code_uq` ON `fixed_assets` (`code`);--> statement-breakpoint
CREATE INDEX `fixed_assets_status_idx` ON `fixed_assets` (`status`);--> statement-breakpoint
CREATE INDEX `fixed_assets_category_idx` ON `fixed_assets` (`category`);--> statement-breakpoint
CREATE INDEX `fixed_assets_acquired_idx` ON `fixed_assets` (`acquired_at`);--> statement-breakpoint
CREATE TABLE `supplies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category` text,
	`unit_id` text NOT NULL,
	`stock_micro` integer DEFAULT 0 NOT NULL,
	`min_stock_micro` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplies_name_uq` ON `supplies` (`name`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_purchase_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`raw_material_id` integer,
	`supply_id` integer,
	`unit_id` text NOT NULL,
	`qty_micro` integer NOT NULL,
	`qty_base_micro` integer NOT NULL,
	`unit_price_micro` integer NOT NULL,
	`line_total_micro` integer NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supply_id`) REFERENCES `supplies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_purchase_items`("id", "purchase_id", "raw_material_id", "unit_id", "qty_micro", "qty_base_micro", "unit_price_micro", "line_total_micro") SELECT "id", "purchase_id", "raw_material_id", "unit_id", "qty_micro", "qty_base_micro", "unit_price_micro", "line_total_micro" FROM `purchase_items`;--> statement-breakpoint
DROP TABLE `purchase_items`;--> statement-breakpoint
ALTER TABLE `__new_purchase_items` RENAME TO `purchase_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;