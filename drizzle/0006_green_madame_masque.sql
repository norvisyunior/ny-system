ALTER TABLE `recipe_versions` ADD `yield_method` text DEFAULT 'directo' NOT NULL;--> statement-breakpoint
ALTER TABLE `recipe_versions` ADD `unit_mass_micro` integer;--> statement-breakpoint
ALTER TABLE `recipe_versions` ADD `unit_mass_unit_id` text REFERENCES units(code);--> statement-breakpoint
ALTER TABLE `recipe_versions` ADD `yield_mass_unit_id` text REFERENCES units(code);