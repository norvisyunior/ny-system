ALTER TABLE `production_batches` ADD `labor_cost_micro` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transformations` ADD `labor_cost_micro` integer DEFAULT 0 NOT NULL;