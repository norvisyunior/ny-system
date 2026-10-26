CREATE TABLE `labor_rates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`mass_id` integer,
	`product_id` integer,
	`rate_micro` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`mass_id`) REFERENCES `masses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `finished_products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `labor_rates_mass_idx` ON `labor_rates` (`mass_id`);--> statement-breakpoint
CREATE INDEX `labor_rates_product_idx` ON `labor_rates` (`product_id`);