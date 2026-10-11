CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer,
	`summary` text NOT NULL,
	`details_json` text
);
--> statement-breakpoint
CREATE INDEX `audit_logs_date_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `closing_count_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_date` text NOT NULL,
	`item_type` text NOT NULL,
	`item_id` integer NOT NULL,
	`expected_micro` integer NOT NULL,
	`counted_micro` integer NOT NULL,
	`diff_micro` integer NOT NULL,
	`unit_cost_micro` integer DEFAULT 0 NOT NULL,
	`diff_value_micro` integer DEFAULT 0 NOT NULL,
	`reason` text,
	FOREIGN KEY (`business_date`) REFERENCES `daily_closings`(`business_date`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `daily_closings` (
	`business_date` text PRIMARY KEY NOT NULL,
	`sales_total_micro` integer DEFAULT 0 NOT NULL,
	`cogs_micro` integer DEFAULT 0 NOT NULL,
	`expenses_micro` integer DEFAULT 0 NOT NULL,
	`gross_profit_micro` integer DEFAULT 0 NOT NULL,
	`net_result_micro` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'cerrado' NOT NULL,
	`closed_at` text,
	`reopened_at` text,
	`reopen_reason` text,
	`notes` text
);
--> statement-breakpoint
CREATE INDEX `daily_closings_status_idx` ON `daily_closings` (`status`);--> statement-breakpoint
CREATE TABLE `doc_counters` (
	`type` text PRIMARY KEY NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expense_date` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`amount_micro` integer NOT NULL,
	`payment_method` text DEFAULT 'efectivo' NOT NULL,
	`responsible` text,
	`notes` text,
	`status` text DEFAULT 'confirmada' NOT NULL,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	`cancelled_at` text,
	`cancel_reason` text
);
--> statement-breakpoint
CREATE INDEX `expenses_date_idx` ON `expenses` (`expense_date`);--> statement-breakpoint
CREATE TABLE `finished_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`presentation` text,
	`sale_unit_id` text NOT NULL,
	`units_per_package` integer DEFAULT 1 NOT NULL,
	`price_micro` integer DEFAULT 0 NOT NULL,
	`stock_micro` integer DEFAULT 0 NOT NULL,
	`min_stock_micro` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`sale_unit_id`) REFERENCES `units`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finished_products_code_uq` ON `finished_products` (`code`);--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_date` text NOT NULL,
	`item_type` text NOT NULL,
	`item_id` integer NOT NULL,
	`movement_type` text NOT NULL,
	`qty_delta_micro` integer NOT NULL,
	`unit_cost_micro` integer DEFAULT 0 NOT NULL,
	`value_micro` integer DEFAULT 0 NOT NULL,
	`lot_id` integer,
	`ref_type` text,
	`ref_id` integer,
	`reason` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `stock_lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inv_mov_item_idx` ON `inventory_movements` (`item_type`,`item_id`,`id`);--> statement-breakpoint
CREATE INDEX `inv_mov_date_idx` ON `inventory_movements` (`business_date`);--> statement-breakpoint
CREATE INDEX `inv_mov_ref_idx` ON `inventory_movements` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `masses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`unit_id` text NOT NULL,
	`stock_micro` integer DEFAULT 0 NOT NULL,
	`min_stock_micro` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `masses_code_uq` ON `masses` (`code`);--> statement-breakpoint
CREATE TABLE `price_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`price_micro` integer NOT NULL,
	`valid_from` text NOT NULL,
	`reason` text,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `finished_products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `production_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` integer NOT NULL,
	`production_date` text NOT NULL,
	`recipe_version_id` integer NOT NULL,
	`expected_yield_micro` integer NOT NULL,
	`real_yield_micro` integer NOT NULL,
	`yield_unit_id` text NOT NULL,
	`total_cost_micro` integer DEFAULT 0 NOT NULL,
	`unit_cost_micro` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'confirmada' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	`cancelled_at` text,
	`cancel_reason` text,
	FOREIGN KEY (`recipe_version_id`) REFERENCES `recipe_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`yield_unit_id`) REFERENCES `units`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_batches_number_uq` ON `production_batches` (`number`);--> statement-breakpoint
CREATE INDEX `production_batches_date_idx` ON `production_batches` (`production_date`);--> statement-breakpoint
CREATE TABLE `production_consumptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`raw_material_id` integer NOT NULL,
	`lot_id` integer NOT NULL,
	`qty_micro` integer NOT NULL,
	`unit_cost_micro` integer NOT NULL,
	`line_cost_micro` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `production_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `stock_lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `prod_consumptions_batch_idx` ON `production_consumptions` (`batch_id`);--> statement-breakpoint
CREATE TABLE `production_outputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`mass_id` integer NOT NULL,
	`lot_id` integer NOT NULL,
	`qty_micro` integer NOT NULL,
	`unit_cost_micro` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `production_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mass_id`) REFERENCES `masses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `stock_lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`raw_material_id` integer NOT NULL,
	`unit_id` text NOT NULL,
	`qty_micro` integer NOT NULL,
	`qty_base_micro` integer NOT NULL,
	`unit_price_micro` integer NOT NULL,
	`line_total_micro` integer NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` integer NOT NULL,
	`supplier_id` integer NOT NULL,
	`purchase_date` text NOT NULL,
	`doc_number` text,
	`notes` text,
	`total_micro` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'confirmada' NOT NULL,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	`cancelled_at` text,
	`cancel_reason` text,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_number_uq` ON `purchases` (`number`);--> statement-breakpoint
CREATE INDEX `purchases_date_idx` ON `purchases` (`purchase_date`);--> statement-breakpoint
CREATE TABLE `raw_materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
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
CREATE UNIQUE INDEX `raw_materials_code_uq` ON `raw_materials` (`code`);--> statement-breakpoint
CREATE TABLE `recipe_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_version_id` integer NOT NULL,
	`raw_material_id` integer NOT NULL,
	`unit_id` text NOT NULL,
	`qty_micro` integer NOT NULL,
	FOREIGN KEY (`recipe_version_id`) REFERENCES `recipe_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_material_id`) REFERENCES `raw_materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recipe_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_id` integer NOT NULL,
	`version` integer NOT NULL,
	`status` text DEFAULT 'activa' NOT NULL,
	`mass_id` integer NOT NULL,
	`expected_yield_micro` integer NOT NULL,
	`yield_unit_id` text NOT NULL,
	`instructions` text,
	`valid_from` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mass_id`) REFERENCES `masses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`yield_unit_id`) REFERENCES `units`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_versions_uq` ON `recipe_versions` (`recipe_id`,`version`);--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipes_code_uq` ON `recipes` (`code`);--> statement-breakpoint
CREATE TABLE `sale_item_lots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_item_id` integer NOT NULL,
	`lot_id` integer NOT NULL,
	`qty_micro` integer NOT NULL,
	`unit_cost_micro` integer NOT NULL,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `stock_lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`qty_micro` integer NOT NULL,
	`unit_price_micro` integer NOT NULL,
	`unit_cost_micro` integer NOT NULL,
	`line_total_micro` integer NOT NULL,
	`line_cost_micro` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `finished_products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` integer NOT NULL,
	`sale_date` text NOT NULL,
	`payment_method` text NOT NULL,
	`subtotal_micro` integer DEFAULT 0 NOT NULL,
	`discount_micro` integer DEFAULT 0 NOT NULL,
	`total_micro` integer DEFAULT 0 NOT NULL,
	`total_cost_micro` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'confirmada' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	`cancelled_at` text,
	`cancel_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_number_uq` ON `sales` (`number`);--> statement-breakpoint
CREATE INDEX `sales_date_idx` ON `sales` (`sale_date`);--> statement-breakpoint
CREATE TABLE `stock_lots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_type` text NOT NULL,
	`item_id` integer NOT NULL,
	`ref_type` text NOT NULL,
	`ref_id` integer NOT NULL,
	`qty_initial_micro` integer NOT NULL,
	`qty_remaining_micro` integer NOT NULL,
	`unit_cost_micro` integer NOT NULL,
	`business_date` text NOT NULL,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stock_lots_fifo_idx` ON `stock_lots` (`item_type`,`item_id`,`id`);--> statement-breakpoint
CREATE INDEX `stock_lots_ref_idx` ON `stock_lots` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`address` text,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transformation_consumptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transformation_id` integer NOT NULL,
	`lot_id` integer NOT NULL,
	`qty_micro` integer NOT NULL,
	`unit_cost_micro` integer NOT NULL,
	`line_cost_micro` integer NOT NULL,
	FOREIGN KEY (`transformation_id`) REFERENCES `transformations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `stock_lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transformation_outputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transformation_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`lot_id` integer NOT NULL,
	`qty_micro` integer NOT NULL,
	`cost_allocated_micro` integer NOT NULL,
	`unit_cost_micro` integer NOT NULL,
	FOREIGN KEY (`transformation_id`) REFERENCES `transformations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `finished_products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `stock_lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transformations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` integer NOT NULL,
	`transform_date` text NOT NULL,
	`mass_id` integer NOT NULL,
	`total_cost_micro` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'confirmada' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	`cancelled_at` text,
	`cancel_reason` text,
	FOREIGN KEY (`mass_id`) REFERENCES `masses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transformations_number_uq` ON `transformations` (`number`);--> statement-breakpoint
CREATE INDEX `transformations_date_idx` ON `transformations` (`transform_date`);--> statement-breakpoint
CREATE TABLE `units` (
	`code` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`dimension` text NOT NULL,
	`factor` integer NOT NULL,
	`is_base` integer DEFAULT false NOT NULL
);
